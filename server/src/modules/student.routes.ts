import { Router, type Request } from 'express';
import { z } from 'zod';
import { balanceMinor, isoDate, packageHasFeature, studentAccountSchema } from '@sms/shared';
import {
  AcademicSession, Announcement, AttendanceRecord, Classroom, Exam, ExamResult, FeePayment, FeeVoucher, Homework,
  SchoolClass, Section, Student, TeacherAssignment, User, WebsiteItem
} from '../models/index.js';
import { env } from '../config/env.js';
import { can, requireFeature } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { renderIdCardsPdf, renderReceiptPdf, renderReportCardPdf, renderVoucherPdf } from '../services/documents.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { classroomTimetable, noticesFor } from '../services/timetable.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { revokeAllForUser } from '../security/sessions.js';
import { badRequest, conflict, forbidden, h, notFound, ok, parse } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';
import { attendanceSummary, placementNames, PUBLIC_STUDENT, publishedResults, shift, today } from './parent.routes.js';
import { cardInputs } from './idcards.routes.js';

/**
 * Student portal API. A student account is created FROM a student record (users.studentId), so it can
 * only ever see that student's own records: timetable, attendance, results, homework, fees (read
 * only), announcements and ID card. There is no id in any URL to tamper with. Anything else answers 404.
 * The portal fence (middleware/auth.ts) also keeps student sessions out of every other /api route.
 */
export const studentRouter = Router();
studentRouter.use(requireFeature('student_portal'), can('student.portal'), (req, _res, next) => {
  if (req.user?.role !== 'student') return next(forbidden('The student portal is for student accounts'));
  next();
});

async function me(req: Request) {
  const id = req.user?.studentId;
  if (!id) throw notFound('No student record is linked to this account');
  const s = await Student.findOne({ _id: id, deletedAt: null }).select('fullName admissionNumber classroomId status photoPath').lean();
  if (!s) throw notFound('Student not found');
  return s;
}

studentRouter.get('/me', h(async (req, res) => {
  const s = await me(req);
  const room = await Classroom.findById(s.classroomId).select('name classId sectionId sessionId').lean();
  const [cls, sec, ses] = await Promise.all([
    room ? SchoolClass.findById(room.classId).select('name').lean() : null,
    room ? Section.findById(room.sectionId).select('name').lean() : null,
    room ? AcademicSession.findById(room.sessionId).select('name').lean() : null
  ]);
  ok(res, { fullName: s.fullName, admissionNumber: s.admissionNumber, status: s.status, photoPath: s.photoPath ?? null, classroomName: room?.name ?? '', className: cls?.name ?? '', sectionName: sec?.name ?? '', sessionName: ses?.name ?? '' });
}));

studentRouter.get('/timetable', h(async (req, res) => {
  const s = await me(req);
  const q = parse(z.object({ date: isoDate.optional() }), req.query);
  const [tt, notices] = await Promise.all([classroomTimetable(s.classroomId, q.date), noticesFor({ classroomIds: [s.classroomId] })]);
  ok(res, { ...tt, notices });
}));

// ------------------------------------------------------------------ Own records (read only)
// Same data and rules as the parent portal, always for the signed-in student's own record.
// Fees are view/download only: online payment stays with the parent portal and the school office.

const uuidOr404 = (v: unknown) => { const r = z.string().uuid().safeParse(v); if (!r.success) throw notFound(); return r.data; };
const sendPdf = (res: import('express').Response, pdf: Buffer, name: string) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
};
const pick = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v as Record<string, string>).en ?? Object.values(v as Record<string, string>)[0] ?? '' : '');

studentRouter.get('/dashboard', h(async (req, res) => {
  const s = await me(req);
  const t = await today();
  const names = await placementNames([s.classroomId]);
  const [vouchers, homework, results, attendance, announcements, eventItems, settings] = await Promise.all([
    FeeVoucher.find({ studentId: s._id, deletedAt: null, status: $in(['unpaid', 'partial']) }).sort({ dueDate: 1 }).lean(),
    Homework.find({ classroomId: s.classroomId, deletedAt: null, dueDate: $cmp({ gte: t }) }).sort({ dueDate: 1 }).limit(6).select('subject title dueDate').lean(),
    publishedResults(s._id),
    attendanceSummary(s._id, shift(t, -29), t),
    Announcement.find({ deletedAt: null, publishedAt: $cmp({ ne: null, lte: new Date() }) }).sort({ pinned: -1, publishedAt: -1 }).limit(8).select('title body publishedAt pinned').lean(),
    WebsiteItem.find({ type: 'event', status: 'published', deletedAt: null, date: $cmp({ gte: new Date(Date.parse(t + 'T00:00:00Z') - 86_400_000) }) }).sort({ date: 1 }).limit(5).select('slug date data').lean(),
    getSettings()
  ]);
  const r = results[0];
  ok(res, {
    today: t,
    student: { _id: s._id, fullName: s.fullName, admissionNumber: s.admissionNumber, photoPath: s.photoPath ?? null, status: s.status, ...names(s.classroomId) },
    attendance,
    latestResult: r ? { examId: r.examId, name: r.name, percent: r.summary.percent, grade: r.summary.grade, passed: r.summary.passed } : null,
    fees: {
      outstandingMinor: vouchers.reduce((a, v) => a + balanceMinor(v.totalMinor, v.paidMinor), 0),
      currency: vouchers[0]?.currency ?? settings.fees?.currency ?? 'PKR',
      overdue: vouchers.filter((v) => v.dueDate < t).length,
      nextDue: vouchers[0] ? { dueDate: vouchers[0].dueDate, title: vouchers[0].title } : null
    },
    homework,
    announcements,
    events: eventItems.map((e) => { const d = (e.data ?? {}) as Record<string, unknown>; return { _id: e._id, date: e.date, title: pick(d.title), location: pick(d.location) }; }),
    idCards: packageHasFeature(env.PACKAGE, 'id_cards')
  });
}));

studentRouter.get('/profile', h(async (req, res) => {
  const { _id } = await me(req);
  const s = (await Student.findById(_id).select(PUBLIC_STUDENT).lean())!;
  const names = await placementNames([s.classroomId]);
  const assigned = await TeacherAssignment.find({ classroomId: s.classroomId, endedAt: null, deletedAt: null }).select('teacherId isHomeroom').lean();
  const teachers = await User.find({ _id: $in(assigned.map((a) => a.teacherId)), status: 'active', deletedAt: null }).select('fullName').lean();
  ok(res, { ...s, ...names(s.classroomId), teachers: teachers.map((x) => ({ fullName: x.fullName, isHomeroom: Boolean(assigned.find((a) => a.teacherId === x._id)?.isHomeroom) })) });
}));

studentRouter.get('/attendance', h(async (req, res) => {
  const s = await me(req);
  const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
  const to = q.to ?? await today(); const from = q.from ?? shift(to, -59);
  if (from > to) throw badRequest('from must be <= to');
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw badRequest('Range is limited to about one year');
  const records = await AttendanceRecord.find({ studentId: s._id, deletedAt: null, date: $cmp({ gte: from, lte: to }) }).sort({ date: -1 }).select('date status remark arrivalTime corrected').lean();
  ok(res, { from, to, summary: await attendanceSummary(s._id, from, to), records });
}));

studentRouter.get('/results', h(async (req, res) => {
  ok(res, await publishedResults((await me(req))._id));
}));

studentRouter.get('/report-card/:examId', h(async (req, res) => {
  const s = await me(req);
  const examId = uuidOr404(req.params.examId);
  const exam = await Exam.findOne({ _id: examId, published: true, deletedAt: null }).lean();
  if (!exam) throw notFound('Report card not available');
  const rows = (await ExamResult.find({ examId, studentId: s._id, deletedAt: null }).sort({ subject: 1 }).lean())
    .map((r) => ({ subject: r.subject, maxMarks: r.maxMarks, marksObtained: r.marksObtained ?? null, absent: r.absent, remarks: r.remarks ?? null }));
  if (!rows.length) throw notFound('Report card not available');
  const names = (await placementNames([s.classroomId]))(s.classroomId);
  sendPdf(res, await renderReportCardPdf({ exam, student: s, className: names.classroomName, sessionName: names.sessionName, rows }, await getSettings()), `report-card-${s.admissionNumber}.pdf`);
}));

studentRouter.get('/homework', h(async (req, res) => {
  const s = await me(req);
  const q = parse(z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming') }), req.query);
  const t = await today();
  const filter: Record<string, unknown> = { classroomId: s.classroomId, deletedAt: null };
  if (q.scope === 'upcoming') filter.dueDate = $cmp({ gte: t });
  if (q.scope === 'past') filter.dueDate = $cmp({ lt: t });
  ok(res, await Homework.find(filter).sort({ dueDate: q.scope === 'upcoming' ? 1 : -1 }).limit(100).select('subject title description assignedDate dueDate').lean());
}));

studentRouter.get('/fees', h(async (req, res) => {
  const s = await me(req);
  const [vouchers, payments] = await Promise.all([
    FeeVoucher.find({ studentId: s._id, deletedAt: null }).sort({ dueDate: -1 }).limit(200).select('-createdBy -cancelledBy -updatedByNode').lean(),
    FeePayment.find({ studentId: s._id, deletedAt: null }).sort({ paidAt: -1 }).limit(200).select('receiptNumber voucherId amountMinor overpaidMinor currency method provider paidAt').lean()
  ]);
  const t = await today();
  ok(res, {
    vouchers: vouchers.map((v) => ({ ...v, balanceMinor: balanceMinor(v.totalMinor, v.paidMinor), overdue: v.status !== 'paid' && v.status !== 'cancelled' && v.dueDate < t })),
    payments,
    outstandingMinor: vouchers.filter((v) => v.status === 'unpaid' || v.status === 'partial').reduce((a, v) => a + balanceMinor(v.totalMinor, v.paidMinor), 0)
  });
}));

studentRouter.get('/vouchers/:id/pdf', h(async (req, res) => {
  const s = await me(req);
  const v = await FeeVoucher.findOne({ _id: uuidOr404(req.params.id), studentId: s._id, deletedAt: null }).lean();
  if (!v) throw notFound('Voucher not found');
  const names = (await placementNames([v.classroomId]))(v.classroomId);
  sendPdf(res, await renderVoucherPdf({ voucher: v, student: s, className: names.classroomName }, await getSettings()), `voucher-${v.voucherNumber}.pdf`);
}));

studentRouter.get('/receipts/:id/pdf', h(async (req, res) => {
  const s = await me(req);
  const p = await FeePayment.findOne({ _id: uuidOr404(req.params.id), studentId: s._id, deletedAt: null }).lean();
  if (!p) throw notFound('Receipt not found');
  const v = (await FeeVoucher.findById(p.voucherId).lean())!;
  const names = (await placementNames([v.classroomId]))(v.classroomId);
  sendPdf(res, await renderReceiptPdf({ payment: p, voucher: v, student: s, className: names.classroomName }, await getSettings()), `receipt-${p.receiptNumber}.pdf`);
}));

/** The student's own ID card (same card and QR token the school prints). */
studentRouter.get('/id-card', requireFeature('id_cards'), h(async (req, res) => {
  const s = await me(req);
  const cards = await cardInputs([s._id]);
  if (!cards.length) throw notFound('Student not found');
  sendPdf(res, await renderIdCardsPdf(cards, await getSettings(), 'card'), `id-card-${s.admissionNumber}.pdf`);
}));

// ------------------------------------------------------------------ Admin: student portal accounts
/** Mounted under /api/students (staff side). */
export const studentAccountsRouter = Router();
const idParam = (v: unknown) => { const r = z.string().uuid().safeParse(v); if (!r.success) throw notFound(); return r.data; };

studentAccountsRouter.get('/:id/portal-account', requireFeature('student_portal'), can('students.view'), h(async (req, res) => {
  const id = idParam(req.params.id);
  ok(res, await User.findOne({ studentId: id, role: 'student', deletedAt: null }).select('username status lastLoginAt createdAt').lean() ?? null);
}));

studentAccountsRouter.post('/:id/portal-account', requireFeature('student_portal'), can('students.manage'), can('users.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(studentAccountSchema, req.body);
  const s = await Student.findOne({ _id: id, deletedAt: null }).lean();
  if (!s) throw notFound('Student not found');
  if (await User.exists({ studentId: id, deletedAt: null })) throw conflict('This student already has a portal account');
  if (await User.exists({ username: b.username })) throw conflict('That username is already taken');
  const password = b.password ?? generatePassword();
  const u = await createVersioned(User, {
    username: b.username, fullName: s.fullName, role: 'student', studentId: id,
    passwordHash: await hashPassword(password), mustChangePassword: !b.password
  });
  await audit(req, 'student_account.created', 'user', u._id, { studentId: id, username: b.username });
  // A generated password is shown ONCE to the administrator to hand over; it is never stored in clear.
  ok(res, { userId: u._id, username: u.username, ...(b.password ? {} : { temporaryPassword: password }) }, undefined, 201);
}));

studentAccountsRouter.patch('/:id/portal-account', requireFeature('student_portal'), can('students.manage'), can('users.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ status: z.enum(['active', 'inactive', 'suspended']) }), req.body);
  const u = await User.findOne({ studentId: id, role: 'student', deletedAt: null }).lean();
  if (!u) throw notFound('No portal account for this student');
  await updateVersioned(User, u._id, { status: b.status });
  if (b.status !== 'active') await revokeAllForUser(u._id, `status_${b.status}`);
  await audit(req, 'student_account.updated', 'user', u._id, { status: b.status });
  ok(res, { status: b.status });
}));
