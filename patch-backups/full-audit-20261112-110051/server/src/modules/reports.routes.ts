import { Router, type Response } from 'express';
import { z } from 'zod';
import { attendancePercent, countStatuses, isoDate, workingDatesBetween, type AttendanceStatus } from '@sms/shared';
import { AttendanceRecord, AttendanceSheet, Classroom, NotificationJob, Student, TeacherAssignment, User } from '../models/index.js';
import { canAny } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { classroomScopeFilter, assertClassroomAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { getSettings, holidayDates } from '../services/settings.js';
import { renderPdf } from '../services/pdf.js';
import { toCsv, toXlsx } from '../services/spreadsheet.js';
import { AppError, badRequest, h, ok, parse } from '../utils/http.js';

export const reportsRouter = Router();

const REPORT_TYPES = ['summary', 'register', 'student', 'absentees', 'late', 'leave', 'percentage', 'submissions', 'notifications'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const qSchema = z.object({
  from: isoDate, to: isoDate, classroomId: z.string().uuid().optional(), classId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(), format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  q: z.string().max(100).optional(), sort: z.string().max(40).optional()
}).refine((v) => v.from <= v.to, { message: 'from must be <= to' })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 400, { message: 'Range limited to 400 days' });

type Col = { header: string; key: string; width: number; align?: 'left' | 'right' | 'center' };
interface Built { title: string; columns: Col[]; rows: Record<string, unknown>[]; summary?: string[] }

reportsRouter.get('/:type', canAny('reports.view', 'attendance.view_own'), h(async (req, res) => {
  const type = z.enum(REPORT_TYPES).parse(req.params.type) as ReportType;
  const q = parse(qSchema, req.query);
  // Teachers (attendance.view_own) are limited to their classrooms and cannot see school-wide reports.
  const teacherScope = !req.user!.permissions.includes('reports.view');
  if (teacherScope && ['submissions', 'notifications'].includes(type)) throw new AppError(403, 'FORBIDDEN', 'Not available for your role');
  if (type === 'notifications' && env.PACKAGE !== 'standard') throw new AppError(403, 'PACKAGE', 'Requires the Standard package');
  if (q.classroomId) await assertClassroomAccess(req.user!, q.classroomId);
  const scope = await classroomScopeFilter(req.user!);
  const s = await getSettings();

  const roomFilter: Record<string, unknown> = { deletedAt: null, ...(scope.classroomId ? { _id: scope.classroomId } : {}) };
  if (q.classroomId) roomFilter._id = q.classroomId;
  if (q.classId) roomFilter.classId = q.classId;
  const rooms = await Classroom.find(roomFilter).lean();
  const roomIds = rooms.map((r) => r._id);
  const roomName = (id: string) => rooms.find((r) => r._id === id)?.name ?? '';
  const recFilter: Record<string, unknown> = { date: { $gte: q.from, $lte: q.to }, classroomId: { $in: roomIds }, deletedAt: null };
  if (q.studentId) recFilter.studentId = q.studentId;

  const studentsFor = async (ids: string[]) => Student.find({ _id: { $in: ids } }).select('fullName admissionNumber').lean();
  let built: Built;

  switch (type) {
    case 'summary': {
      const agg = await AttendanceRecord.aggregate<{ _id: { c: string; s: AttendanceStatus }; n: number }>([
        { $match: recFilter }, { $group: { _id: { c: '$classroomId', s: '$status' }, n: { $sum: 1 } } }
      ]);
      const sheets = await AttendanceSheet.aggregate<{ _id: string; n: number }>([
        { $match: { date: recFilter.date, classroomId: recFilter.classroomId, deletedAt: null } },
        { $group: { _id: '$classroomId', n: { $sum: 1 } } }
      ]);
      const rows = rooms.map((r) => {
        const c = countStatuses([]);
        for (const a of agg.filter((x) => x._id.c === r._id)) { c[a._id.s] = a.n; c.total += a.n; }
        return { classroom: r.name, days: sheets.find((x) => x._id === r._id)?.n ?? 0, ...c, percent: fmtPct(attendancePercent(c, s.policy)) };
      }).sort((a, b) => a.classroom.localeCompare(b.classroom));
      const tot = rows.reduce((t, r) => ({ present: t.present + r.present, absent: t.absent + r.absent, late: t.late + r.late, leave: t.leave + r.leave }), { present: 0, absent: 0, late: 0, leave: 0 });
      built = {
        title: 'Attendance summary by classroom',
        columns: [{ header: 'Classroom', key: 'classroom', width: 140 }, { header: 'Days', key: 'days', width: 40, align: 'right' }, { header: 'Present', key: 'present', width: 55, align: 'right' }, { header: 'Absent', key: 'absent', width: 55, align: 'right' }, { header: 'Late', key: 'late', width: 50, align: 'right' }, { header: 'Leave', key: 'leave', width: 50, align: 'right' }, { header: 'Attendance %', key: 'percent', width: 70, align: 'right' }],
        rows, summary: [`Overall attendance: ${fmtPct(attendancePercent(tot, s.policy))}  (present ${tot.present}, absent ${tot.absent}, late ${tot.late}, leave ${tot.leave})`]
      };
      break;
    }
    case 'register':
    case 'absentees':
    case 'late':
    case 'leave':
    case 'student': {
      if (type === 'student' && !q.studentId) throw badRequest('studentId is required');
      const statusFilter = type === 'absentees' ? 'absent' : type === 'late' ? 'late' : type === 'leave' ? 'leave' : undefined;
      const recs = await AttendanceRecord.find({ ...recFilter, ...(statusFilter ? { status: statusFilter } : {}) }).sort({ date: -1 }).limit(50_000).lean();
      const st = await studentsFor([...new Set(recs.map((r) => String(r.studentId)))]);
      let rows = recs.map((r) => {
        const x = st.find((y) => y._id === r.studentId);
        return { date: r.date, classroom: roomName(r.classroomId), admissionNumber: x?.admissionNumber, student: x?.fullName, status: r.status, original: r.corrected ? r.originalStatus : '', arrival: r.arrivalTime ?? '', remark: r.remark ?? '' };
      });
      if (q.q) { const t = q.q.toLowerCase(); rows = rows.filter((r) => String(r.student).toLowerCase().includes(t) || String(r.admissionNumber).toLowerCase().includes(t)); }
      rows.sort((a, b) => b.date.localeCompare(a.date) || a.classroom.localeCompare(b.classroom) || String(a.student).localeCompare(String(b.student)));
      const c = countStatuses(recs.map((r) => r.status as AttendanceStatus));
      const titles: Record<string, string> = { register: 'Attendance register', absentees: 'Absent students', late: 'Late students', leave: 'Leave records', student: `Student attendance history — ${st[0]?.fullName ?? ''}` };
      built = {
        title: titles[type]!,
        columns: [{ header: 'Date', key: 'date', width: 62 }, { header: 'Classroom', key: 'classroom', width: 90 }, { header: 'Adm. No', key: 'admissionNumber', width: 60 }, { header: 'Student', key: 'student', width: 140 }, { header: 'Status', key: 'status', width: 50 }, { header: 'Corrected from', key: 'original', width: 60 }, { header: 'Arrival', key: 'arrival', width: 45 }, { header: 'Remark', key: 'remark', width: 110 }],
        rows, summary: [`Records: ${c.total}  ·  present ${c.present}, absent ${c.absent}, late ${c.late}, leave ${c.leave}  ·  attendance ${fmtPct(attendancePercent(c, s.policy))}`]
      };
      break;
    }
    case 'percentage': {
      const agg = await AttendanceRecord.aggregate<{ _id: { st: string; s: AttendanceStatus }; n: number }>([{ $match: recFilter }, { $group: { _id: { st: '$studentId', s: '$status' }, n: { $sum: 1 } } }]);
      const activeStudents = await Student.find({ classroomId: { $in: roomIds }, deletedAt: null, ...(q.studentId ? { _id: q.studentId } : {}) }).select('fullName admissionNumber classroomId status').lean();
      const ids = new Set([...activeStudents.map((x) => x._id), ...agg.map((a) => a._id.st)]);
      const st = await studentsFor([...ids]);
      const rows = [...ids].map((id) => {
        const c = countStatuses([]);
        for (const a of agg.filter((x) => x._id.st === id)) { c[a._id.s] = a.n; c.total += a.n; }
        const x = st.find((y) => y._id === id); const a = activeStudents.find((y) => y._id === id);
        const pct = attendancePercent(c, s.policy);
        return { student: x?.fullName, admissionNumber: x?.admissionNumber, classroom: a ? roomName(a.classroomId) : '', ...c, percentValue: pct ?? -1, percent: fmtPct(pct) };
      }).sort((a, b) => (q.sort === 'percent' ? a.percentValue - b.percentValue : String(a.student).localeCompare(String(b.student))));
      built = {
        title: 'Attendance percentage by student',
        columns: [{ header: 'Adm. No', key: 'admissionNumber', width: 60 }, { header: 'Student', key: 'student', width: 150 }, { header: 'Classroom', key: 'classroom', width: 90 }, { header: 'Present', key: 'present', width: 45, align: 'right' }, { header: 'Absent', key: 'absent', width: 45, align: 'right' }, { header: 'Late', key: 'late', width: 40, align: 'right' }, { header: 'Leave', key: 'leave', width: 40, align: 'right' }, { header: '%', key: 'percent', width: 50, align: 'right' }],
        rows
      };
      break;
    }
    case 'submissions': {
      const holidays = await holidayDates(q.from, q.to);
      const dates = workingDatesBetween(q.from, q.to, s.policy.workingDays, holidays);
      if (dates.length * rooms.length > 20_000) throw badRequest('Range too large for this report; narrow the dates or classrooms');
      const sheets = await AttendanceSheet.find({ date: { $in: dates }, classroomId: { $in: roomIds }, deletedAt: null }).lean();
      const assignments = await TeacherAssignment.find({ classroomId: { $in: roomIds }, deletedAt: null }).lean();
      const users = await User.find({ _id: { $in: [...assignments.map((a) => a.teacherId), ...sheets.map((x) => x.submittedBy)] } }).select('fullName').lean();
      const uname = (id?: string) => users.find((u) => u._id === id)?.fullName ?? '';
      const rows: Record<string, unknown>[] = [];
      for (const d of dates) for (const r of rooms) {
        if (r.createdAt && new Date(r.createdAt).toISOString().slice(0, 10) > d) continue;
        const sh = sheets.find((x) => x.date === d && x.classroomId === r._id);
        const assigned = assignments.filter((a) => a.classroomId === r._id && new Date(a.startedAt).toISOString().slice(0, 10) <= d && (!a.endedAt || new Date(a.endedAt).toISOString().slice(0, 10) >= d)).map((a) => uname(a.teacherId));
        rows.push({ date: d, classroom: r.name, teachers: assigned.join(', '), status: sh ? 'Submitted' : 'MISSING', submittedBy: uname(sh?.submittedBy), submittedAt: sh ? new Date(sh.submittedAt).toLocaleString('en-GB', { timeZone: s.timeZone }) : '', source: sh?.source ?? '' });
      }
      const missing = rows.filter((r) => r.status === 'MISSING').length;
      built = {
        title: 'Teacher attendance submission status',
        columns: [{ header: 'Date', key: 'date', width: 62 }, { header: 'Classroom', key: 'classroom', width: 90 }, { header: 'Assigned teachers', key: 'teachers', width: 130 }, { header: 'Status', key: 'status', width: 60 }, { header: 'Submitted by', key: 'submittedBy', width: 100 }, { header: 'Submitted at', key: 'submittedAt', width: 95 }, { header: 'Source', key: 'source', width: 70 }],
        rows: rows.sort((a, b) => String(b.date).localeCompare(String(a.date))),
        summary: [`Expected submissions: ${rows.length}  ·  submitted ${rows.length - missing}  ·  missing ${missing}`]
      };
      break;
    }
    case 'notifications': {
      const jobs = await NotificationJob.find({ date: { $gte: q.from, $lte: q.to }, deletedAt: null }).sort({ createdAt: -1 }).limit(50_000).lean();
      const st = await studentsFor([...new Set(jobs.map((j) => String(j.studentId ?? '')).filter(Boolean))]);
      const rows = jobs.map((j) => ({ date: j.date, student: st.find((x) => x._id === j.studentId)?.fullName, to: j.to, event: j.event, status: j.status, attempts: j.attempts, sentAt: j.sentAt ? new Date(j.sentAt).toISOString() : '', deliveredAt: j.deliveredAt ? new Date(j.deliveredAt).toISOString() : '', error: j.lastError ?? '' }));
      const by = (st2: string) => jobs.filter((j) => j.status === st2).length;
      built = {
        title: 'Parent notification log',
        columns: [{ header: 'Date', key: 'date', width: 60 }, { header: 'Student', key: 'student', width: 120 }, { header: 'To', key: 'to', width: 85 }, { header: 'Event', key: 'event', width: 45 }, { header: 'Status', key: 'status', width: 65 }, { header: 'Tries', key: 'attempts', width: 35, align: 'right' }, { header: 'Sent', key: 'sentAt', width: 105 }, { header: 'Delivered', key: 'deliveredAt', width: 105 }, { header: 'Error', key: 'error', width: 110 }],
        rows, summary: [`Total ${jobs.length}  ·  delivered ${by('delivered')}  ·  sent (awaiting receipt) ${by('sent')}  ·  pending ${by('pending')}  ·  failed ${by('failed') + by('dead') + by('undelivered')}  ·  blocked by configuration ${by('blocked_config')}`]
      };
      break;
    }
  }
  const subtitle = `${q.from} to ${q.to}${q.classroomId ? ' · ' + roomName(q.classroomId) : ''}`;
  await audit(req, 'report.generated', 'report', type, { from: q.from, to: q.to, format: q.format });
  return send(res, q.format, built, subtitle, s);
}));

function fmtPct(p: number | null) { return p === null ? '—' : `${p}%`; }

async function send(res: Response, format: string, b: Built, subtitle: string, s: Awaited<ReturnType<typeof getSettings>>) {
  const base = b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  if (format === 'json') return ok(res, { title: b.title, subtitle, columns: b.columns, rows: b.rows, summary: b.summary ?? [] });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(b.columns, b.rows));
  }
  if (format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(await toXlsx(b.title, b.columns.map((c) => ({ ...c, width: Math.round(c.width / 5) })), b.rows, `${s.name} — ${b.title} (${subtitle})`));
  }
  const pdf = await renderPdf({ title: b.title, subtitle, columns: b.columns, rows: b.rows, summary: b.summary }, { schoolName: s.name, logoPath: s.logoPath, header: s.reportHeader, footer: s.reportFooter, primaryColor: s.primaryColor });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
  return res.send(pdf);
}
