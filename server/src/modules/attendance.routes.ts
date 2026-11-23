import { Router } from 'express';
import { z } from 'zod';
import {
  attendanceSubmitSchema, correctionRequestSchema, correctionReviewSchema, canSubmitForDate, countStatuses,
  schoolDate, isoDate, type AttendanceStatus
} from '@sms/shared';
import { AttendanceAudit, AttendanceCorrection, AttendanceRecord, AttendanceSheet, Classroom, SchoolSettings, Student, User, TeacherAssignment } from '../models/index.js';
import { lastWhatsappSent, parentContacts } from '../services/parent-contacts.js';
import { can, canAny } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { withTransaction } from '../config/db.js';
import { assertClassroomAccess, classroomScopeFilter } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { getSettings, holidayDates, invalidateSettings } from '../services/settings.js';
import { enqueueAttendanceAlerts } from '../services/notifications.js';
import { AppError, badRequest, conflict, forbidden, h, notFound, ok, parse } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';

export const attendanceRouter = Router();

// ------------------------------------------------------------------ Absent / late: free WhatsApp messages to parents
/**
 * Students marked absent or late on a date, with the parent's WhatsApp number (click-to-chat; the
 * message is opened in WhatsApp on the staff member's device, nothing is sent from the server).
 */
attendanceRouter.get('/alerts', can('attendance.view_all'), h(async (req, res) => {
  const settings = await getSettings();
  const q = parse(z.object({ date: isoDate.optional(), classroomId: z.string().uuid().optional(), status: z.enum(['absent', 'late']).optional() }), req.query);
  const date = q.date ?? schoolDate(new Date(), settings.timeZone);
  const filter: Record<string, unknown> = { date, deletedAt: null, status: q.status ?? $in(['absent', 'late']) };
  if (q.classroomId) filter.classroomId = q.classroomId;
  const records = await AttendanceRecord.find(filter).select('studentId classroomId status arrivalTime remark').lean();
  const studentIds = [...new Set(records.map((r) => r.studentId))];
  const [students, rooms, contacts, sent] = await Promise.all([
    Student.find({ _id: $in(studentIds), deletedAt: null }).select('fullName admissionNumber').lean(),
    Classroom.find({ _id: $in([...new Set(records.map((r) => r.classroomId))]) }).select('name').lean(),
    parentContacts(studentIds, settings.defaultCountryCode ?? '92'),
    lastWhatsappSent('attendance.whatsapp_alert', studentIds, date)
  ]);
  const rows = records.flatMap((r) => {
    const s = students.find((x) => x._id === r.studentId);
    if (!s) return [];
    const c = contacts.get(s._id);
    return [{
      studentId: s._id, fullName: s.fullName, admissionNumber: s.admissionNumber,
      classroomId: r.classroomId, classroomName: rooms.find((x) => x._id === r.classroomId)?.name ?? '',
      status: r.status as 'absent' | 'late', arrivalTime: r.arrivalTime ?? null, remark: r.remark ?? null,
      parentName: c?.parentName ?? '', phone: c?.phone ?? null, whatsapp: c?.whatsapp ?? null,
      lastSentAt: sent.get(s._id) ?? null
    }];
  }).sort((a, b) => a.classroomName.localeCompare(b.classroomName) || a.status.localeCompare(b.status) || a.fullName.localeCompare(b.fullName));
  ok(res, {
    date, schoolName: settings.name,
    templates: { absent: settings.attendanceMessages?.absent ?? null, late: settings.attendanceMessages?.late ?? null },
    totals: { absent: rows.filter((r) => r.status === 'absent').length, late: rows.filter((r) => r.status === 'late').length, noPhone: rows.filter((r) => !r.whatsapp).length },
    rows
  });
}));

/** Records that the parent's WhatsApp chat was opened for this student and date ("Sent today"). */
attendanceRouter.post('/alerts/:studentId/whatsapp', can('attendance.view_all'), h(async (req, res) => {
  const studentId = z.string().uuid().parse(req.params.studentId);
  const b = parse(z.object({ date: isoDate, status: z.enum(['absent', 'late']) }), req.body);
  if (!(await Student.exists({ _id: studentId, deletedAt: null }))) throw notFound('Student not found');
  await audit(req, 'attendance.whatsapp_alert', 'student', studentId, b);
  ok(res, { at: new Date() });
}));

/** The school's own wording for the absent / late messages (null = use the default). */
attendanceRouter.patch('/alerts/templates', can('settings.manage'), h(async (req, res) => {
  const b = parse(z.object({ absent: z.string().trim().max(1000).nullable().optional(), late: z.string().trim().max(1000).nullable().optional() }), req.body);
  const s = await getSettings();
  const next = { ...(s.attendanceMessages ?? {}), ...b };
  await updateVersioned(SchoolSettings, 'school', { attendanceMessages: next });
  invalidateSettings();
  await audit(req, 'attendance.message_templates_updated', 'settings', 'school');
  ok(res, next);
}));

const REASON_TEXT: Record<string, string> = {
  future_date: 'Attendance cannot be submitted for a future date.',
  not_working_day: 'This date is not a school working day.',
  holiday: 'This date is a holiday.',
  after_cutoff: 'The attendance submission window for this date has closed. Ask an administrator.'
};

/** Roster for marking: active students + any existing submission for the date. */
attendanceRouter.get('/roster', canAny('attendance.mark', 'attendance.view_all'), h(async (req, res) => {
  const q = parse(z.object({ classroomId: z.string().uuid(), date: isoDate.optional() }), req.query);
  await assertClassroomAccess(req.user!, q.classroomId);
  const s = await getSettings();
  const date = q.date ?? schoolDate(new Date(), s.timeZone);
  const [room, students, sheet, holidays] = await Promise.all([
    Classroom.findOne({ _id: q.classroomId, deletedAt: null }).lean(),
    Student.find({ classroomId: q.classroomId, status: 'active', deletedAt: null }).sort({ fullName: 1 }).select('fullName admissionNumber photoPath gender version').lean(),
    AttendanceSheet.findOne({ classroomId: q.classroomId, date, deletedAt: null }).lean(),
    holidayDates(date, date)
  ]);
  if (!room) throw notFound('Classroom not found');
  const records = sheet ? await AttendanceRecord.find({ sheetId: sheet._id, deletedAt: null }).lean() : [];
  const check = canSubmitForDate({ date, now: new Date(), timeZone: s.timeZone, workingDays: s.policy.workingDays, holidays, cutoffTime: s.policy.cutoffTime, allowBackdatedDays: s.policy.allowBackdatedDays });
  ok(res, {
    classroom: room, date, students, sheet, records,
    canSubmit: !sheet && check.ok, blockedReason: sheet ? 'already_submitted' : check.ok ? null : check.reason,
    policy: { lateThresholdTime: s.policy.lateThresholdTime, cutoffTime: s.policy.cutoffTime }
  });
}));

/**
 * Submit a classroom's attendance for a date. Idempotent on (user, Idempotency-Key) and on clientOpId.
 * The (classroomId, date) unique index makes a second, different submission impossible.
 */
attendanceRouter.post('/submit', can('attendance.mark'), idempotent(true), h(async (req, res) => {
  const b = parse(attendanceSubmitSchema, req.body);
  await assertClassroomAccess(req.user!, b.classroomId);
  const replay = await AttendanceSheet.findOne({ clientOpId: b.clientOpId }).lean();
  if (replay) return ok(res, { sheet: replay, replayed: true });

  const s = await getSettings();
  const now = new Date();
  // Offline-created submissions are judged against the time they were made on the device, but a
  // device clock is never trusted beyond `now` or beyond the backdating allowance.
  const offline = req.headers['x-offline-origin'] === '1';
  const effectiveNow = offline && b.clientCreatedAt && new Date(b.clientCreatedAt) < now ? new Date(b.clientCreatedAt) : now;
  const holidays = await holidayDates(b.date, b.date);
  const check = canSubmitForDate({ date: b.date, now: effectiveNow, timeZone: s.timeZone, workingDays: s.policy.workingDays, holidays, cutoffTime: s.policy.cutoffTime, allowBackdatedDays: s.policy.allowBackdatedDays });
  if (!check.ok) {
    const recheck = canSubmitForDate({ date: b.date, now, timeZone: s.timeZone, workingDays: s.policy.workingDays, holidays, cutoffTime: null, allowBackdatedDays: s.policy.allowBackdatedDays });
    if (!(offline && recheck.ok && check.reason === 'after_cutoff')) throw new AppError(422, check.reason.toUpperCase(), REASON_TEXT[check.reason]!);
  }

  const existing = await AttendanceSheet.findOne({ classroomId: b.classroomId, date: b.date, deletedAt: null }).lean();
  if (existing) throw conflict('Attendance for this classroom and date has already been submitted. Use a correction request to change it.', { sheetId: existing._id, code: 'ALREADY_SUBMITTED' });

  const active = await Student.find({ classroomId: b.classroomId, status: 'active', deletedAt: null }).select('_id').lean();
  const activeIds = new Set(active.map((x) => x._id));
  const entryIds = new Set(b.entries.map((e) => e.studentId));
  if (entryIds.size !== b.entries.length) throw badRequest('A student appears more than once');
  const unknown = [...entryIds].filter((id) => !activeIds.has(id));
  const missing = [...activeIds].filter((id) => !entryIds.has(id));
  if (unknown.length || missing.length) {
    throw new AppError(409, 'ROSTER_CHANGED', 'The class list changed since it was loaded. Review the highlighted students and submit again.', { missing, unknown });
  }

  const counts = countStatuses(b.entries.map((e) => e.status));
  const source = offline ? 'offline_browser' : 'online';
  const sheet = await withTransaction(async (session) => {
    const sh = await createVersioned(AttendanceSheet, { classroomId: b.classroomId, date: b.date, submittedBy: req.user!.id, submittedAt: now, clientOpId: b.clientOpId, source, counts }, { session });
    for (const e of b.entries) {
      const rec = await createVersioned(AttendanceRecord, {
        sheetId: sh._id, classroomId: b.classroomId, studentId: e.studentId, date: b.date,
        status: e.status, originalStatus: e.status, remark: e.remark ?? null, arrivalTime: e.arrivalTime ?? null, markedBy: req.user!.id
      }, { session });
      await createVersioned(AttendanceAudit, { recordId: rec._id, sheetId: sh._id, studentId: e.studentId, classroomId: b.classroomId, date: b.date, action: 'submitted', to: e.status, by: req.user!.id, at: now }, { session });
    }
    return sh;
  });
  await audit(req, 'attendance.submitted', 'attendance_sheet', sheet._id, { classroomId: b.classroomId, date: b.date, counts, source });
  const alerts = await enqueueAttendanceAlerts(sheet._id, req.user!.id).catch(() => ({ queued: 0, skipped: 0, reason: 'error' }));
  ok(res, { sheet, alerts }, undefined, 201);
}));

/** Submission status per classroom for a date — detects missing attendance. */
attendanceRouter.get('/status', canAny('attendance.view_all', 'attendance.view_own'), h(async (req, res) => {
  const s = await getSettings();
  const date = isoDate.optional().parse(req.query.date) ?? schoolDate(new Date(), s.timeZone);
  const scope = await classroomScopeFilter(req.user!);
  const rooms = await Classroom.find({ deletedAt: null, archived: false, ...(scope.classroomId ? { _id: scope.classroomId } : {}) }).lean();
  const [sheets, assignments, holidays] = await Promise.all([
    AttendanceSheet.find({ date, classroomId: $in(rooms.map((r) => r._id)), deletedAt: null }).lean(),
    TeacherAssignment.find({ classroomId: $in(rooms.map((r) => r._id)), endedAt: null, deletedAt: null }).lean(),
    holidayDates(date, date)
  ]);
  const users = await User.find({ _id: $in([...assignments.map((a) => a.teacherId), ...sheets.map((x) => x.submittedBy)]) }).select('fullName').lean();
  const name = (id?: string) => users.find((u) => u._id === id)?.fullName;
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const schoolDay = s.policy.workingDays.includes(dow) && !holidays.includes(date);
  ok(res, {
    date, schoolDay,
    classrooms: rooms.map((r) => {
      const sh = sheets.find((x) => x.classroomId === r._id);
      return {
        classroomId: r._id, classroomName: r.name, submitted: Boolean(sh), sheetId: sh?._id, submittedAt: sh?.submittedAt,
        submittedBy: name(sh?.submittedBy), source: sh?.source, counts: sh?.counts,
        teachers: assignments.filter((a) => a.classroomId === r._id).map((a) => name(a.teacherId))
      };
    }).sort((a, b) => a.classroomName.localeCompare(b.classroomName))
  });
}));

attendanceRouter.get('/sheets/:id', canAny('attendance.view_all', 'attendance.view_own'), h(async (req, res) => {
  const sheet = await AttendanceSheet.findOne({ _id: z.string().uuid().parse(req.params.id), deletedAt: null }).lean();
  if (!sheet) throw notFound();
  await assertClassroomAccess(req.user!, sheet.classroomId);
  const records = await AttendanceRecord.find({ sheetId: sheet._id, deletedAt: null }).lean();
  const students = await Student.find({ _id: $in(records.map((r) => r.studentId)) }).select('fullName admissionNumber').lean();
  ok(res, { sheet, records: records.map((r) => ({ ...r, student: students.find((s) => s._id === r.studentId) })).sort((a, b) => String(a.student?.fullName).localeCompare(String(b.student?.fullName))) });
}));

/** Attendance history: teachers see their own classrooms; admins see all. */
attendanceRouter.get('/history', canAny('attendance.view_all', 'attendance.view_own'), h(async (req, res) => {
  const q = parse(z.object({ classroomId: z.string().uuid().optional(), from: isoDate, to: isoDate }), req.query);
  if (q.from > q.to) throw badRequest('from must be <= to');
  const scope = await classroomScopeFilter(req.user!);
  if (q.classroomId) await assertClassroomAccess(req.user!, q.classroomId);
  const filter: Record<string, unknown> = { date: $cmp({ gte: q.from, lte: q.to }), deletedAt: null, ...scope };
  if (q.classroomId) filter.classroomId = q.classroomId;
  const sheets = await AttendanceSheet.find(filter).sort({ date: -1 }).limit(1000).lean();
  const rooms = await Classroom.find({ _id: $in([...new Set(sheets.map((s) => s.classroomId))]) }).select('name').lean();
  ok(res, sheets.map((s) => ({ ...s, classroomName: rooms.find((r) => r._id === s.classroomId)?.name })));
}));

// ------------------------------------------------------------------ Corrections
attendanceRouter.post('/corrections', can('corrections.request'), idempotent(false), h(async (req, res) => {
  const b = parse(correctionRequestSchema, req.body);
  if (b.clientOpId) {
    const prev = await AttendanceCorrection.findOne({ clientOpId: b.clientOpId }).lean();
    if (prev) return ok(res, prev);
  }
  const rec = await AttendanceRecord.findOne({ _id: b.attendanceId, studentId: b.studentId, deletedAt: null }).lean();
  if (!rec) throw notFound('Attendance record not found');
  await assertClassroomAccess(req.user!, rec.classroomId);
  if (rec.status === b.newStatus) throw badRequest('The new status is the same as the current status');
  if (await AttendanceCorrection.exists({ attendanceId: rec._id, status: 'pending', deletedAt: null })) throw conflict('A correction for this record is already pending review');
  const c = await withTransaction(async (session) => {
    const doc = await createVersioned(AttendanceCorrection, {
      attendanceId: rec._id, studentId: rec.studentId, classroomId: rec.classroomId, date: rec.date,
      oldStatus: rec.status, newStatus: b.newStatus, reason: b.reason, requestedBy: req.user!.id, requestedAt: new Date(), status: 'pending', clientOpId: b.clientOpId
    }, { session });
    await createVersioned(AttendanceAudit, { recordId: rec._id, studentId: rec.studentId, classroomId: rec.classroomId, date: rec.date, action: 'correction_requested', from: rec.status, to: b.newStatus, correctionId: doc._id, by: req.user!.id, reason: b.reason, at: new Date() }, { session });
    return doc;
  });
  await audit(req, 'attendance.correction_requested', 'correction', c._id);
  ok(res, c, undefined, 201);
}));

attendanceRouter.get('/corrections', canAny('corrections.review', 'corrections.request'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.status) filter.status = q.status;
  if (!req.user!.permissions.includes('corrections.review')) filter.requestedBy = req.user!.id;
  const list = await AttendanceCorrection.find(filter).sort({ requestedAt: -1 }).limit(500).lean();
  const [students, users, rooms] = await Promise.all([
    Student.find({ _id: $in(list.map((c) => c.studentId)) }).select('fullName admissionNumber').lean(),
    User.find({ _id: $in([...list.map((c) => c.requestedBy), ...list.map((c) => c.reviewedBy).filter(Boolean)]) }).select('fullName').lean(),
    Classroom.find({ _id: $in(list.map((c) => c.classroomId)) }).select('name').lean()
  ]);
  ok(res, list.map((c) => ({
    ...c, student: students.find((s) => s._id === c.studentId), classroomName: rooms.find((r) => r._id === c.classroomId)?.name,
    requestedByName: users.find((u) => u._id === c.requestedBy)?.fullName, reviewedByName: users.find((u) => u._id === c.reviewedBy)?.fullName
  })));
}));

/** Principal/admin decision. Original status is preserved on the record and in the audit trail. */
attendanceRouter.post('/corrections/:id/review', can('corrections.review'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = parse(correctionReviewSchema, req.body);
  const c = await AttendanceCorrection.findOne({ _id: id, deletedAt: null }).lean();
  if (!c) throw notFound();
  if (c.status !== 'pending') throw conflict(`This request was already ${c.status}`);
  if (c.requestedBy === req.user!.id && req.user!.role !== 'principal') throw forbidden('You cannot approve your own correction request');
  const now = new Date();
  await withTransaction(async (session) => {
    await updateVersioned(AttendanceCorrection, id, { status: b.decision, reviewedBy: req.user!.id, reviewedAt: now, reviewNote: b.reviewNote ?? null }, { session });
    if (b.decision === 'approved') {
      const rec = await AttendanceRecord.findById(c.attendanceId).session(session ?? null).lean();
      if (!rec) throw notFound('Attendance record no longer exists');
      if (rec.status !== c.oldStatus) throw conflict('The record changed after this request was made; reject it and ask for a new request.');
      await updateVersioned(AttendanceRecord, rec._id, { status: c.newStatus, corrected: true }, { session });
      const sheet = await AttendanceSheet.findById(rec.sheetId).session(session ?? null).lean();
      if (sheet) {
        const all = await AttendanceRecord.find({ sheetId: sheet._id, deletedAt: null }).session(session ?? null).select('status').lean();
        await updateVersioned(AttendanceSheet, sheet._id, { counts: countStatuses(all.map((r) => r.status as AttendanceStatus)) }, { session });
      }
    }
    await createVersioned(AttendanceAudit, { recordId: c.attendanceId, studentId: c.studentId, classroomId: c.classroomId, date: c.date, action: b.decision === 'approved' ? 'correction_approved' : 'correction_rejected', from: c.oldStatus, to: c.newStatus, correctionId: id, by: req.user!.id, reason: b.reviewNote ?? undefined, at: now }, { session });
  });
  await audit(req, `attendance.correction_${b.decision}`, 'correction', id);
  if (b.decision === 'approved') await enqueueAttendanceAlerts(undefined, req.user!.id, [c.attendanceId]).catch(() => undefined);
  ok(res, { id, status: b.decision });
}));

attendanceRouter.get('/audit/:recordId', canAny('attendance.view_all', 'audit.view'), h(async (req, res) => {
  const entries = await AttendanceAudit.find({ recordId: z.string().uuid().parse(req.params.recordId) }).sort({ at: 1 }).lean();
  const users = await User.find({ _id: $in(entries.map((e) => e.by ?? undefined)) }).select('fullName').lean();
  ok(res, entries.map((e) => ({ ...e, byName: users.find((u) => u._id === e.by)?.fullName })));
}));
