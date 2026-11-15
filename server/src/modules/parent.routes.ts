import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { attendancePercent, balanceMinor, countStatuses, isoDate, schoolDate, summariseMarks, type AttendanceStatus } from '@sms/shared';
import { isTest } from '../config/env.js';
import {
  Announcement, AttendanceRecord, Classroom, Exam, ExamResult, FeePayment, FeeVoucher, Guardian, Homework, NotificationJob,
  PaymentIntent, SchoolClass, Section, AcademicSession, Student, StudentFeedback, StudentGuardian, TeacherAssignment, User, WebsiteItem
} from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { getPaymentConfig, paymentProblems, reconcileIntent, startCheckout } from '../services/payments.js';
import { renderReceiptPdf, renderReportCardPdf, renderVoucherPdf } from '../services/documents.js';
import { audit } from '../services/audit.js';
import { classroomTimetable, noticesFor } from '../services/timetable.js';
import { badRequest, forbidden, h, notFound, ok, parse } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';
import { logger } from '../utils/logger.js';

/**
 * Parent portal API. Every endpoint is scoped to the children linked to the signed-in parent's
 * guardian record. Anything else answers 404 (not 403), so a parent cannot even learn whether a
 * student id exists (no IDOR, no enumeration).
 */
export const parentRouter = Router();
parentRouter.use(requireFeature('parent_portal'), can('parent.portal'), (req, _res, next) => {
  if (req.user?.role !== 'parent') return next(forbidden('The parent portal is for parent accounts'));
  next();
});

const uuidOr404 = (v: unknown) => {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw notFound();
  return r.data;
};

/** Ids of the active children linked to this parent's guardian record. */
export async function parentChildIds(req: Request): Promise<string[]> {
  const gid = req.user?.guardianId;
  if (!gid || !(await Guardian.exists({ _id: gid, deletedAt: null }))) return [];
  const links = await StudentGuardian.find({ guardianId: gid, deletedAt: null }).select('studentId').lean();
  const students = await Student.find({ _id: $in(links.map((l) => l.studentId)), deletedAt: null }).select('_id').lean();
  return students.map((s) => s._id);
}

async function childId(req: Request, raw: unknown): Promise<string> {
  const id = uuidOr404(raw);
  if (!(await parentChildIds(req)).includes(id)) throw notFound('Student not found');
  return id;
}

async function placementNames(classroomIds: string[]) {
  const rooms = await Classroom.find({ _id: $in(classroomIds) }).select('name classId sectionId sessionId').lean();
  const [classes, sections, sessions] = await Promise.all([
    SchoolClass.find({ _id: $in(rooms.map((r) => r.classId)) }).select('name').lean(),
    Section.find({ _id: $in(rooms.map((r) => r.sectionId)) }).select('name').lean(),
    AcademicSession.find({ _id: $in(rooms.map((r) => r.sessionId)) }).select('name').lean()
  ]);
  return (id: string) => {
    const r = rooms.find((x) => x._id === id);
    return {
      classroomName: r?.name ?? '', className: classes.find((c) => c._id === r?.classId)?.name ?? '',
      sectionName: sections.find((c) => c._id === r?.sectionId)?.name ?? '', sessionName: sessions.find((c) => c._id === r?.sessionId)?.name ?? ''
    };
  };
}

/** Only fields a parent needs. Internal notes, custom fields and sync metadata are never sent. */
const PUBLIC_STUDENT = 'fullName admissionNumber dateOfBirth gender photoPath classroomId status admissionDate';

async function attendanceSummary(studentId: string, from: string, to: string) {
  const s = await getSettings();
  const agg = await AttendanceRecord.aggregate<{ _id: AttendanceStatus; n: number }>([
    { $match: { studentId, deletedAt: null, date: $cmp({ gte: from, lte: to }) } },
    { $group: { _id: '$status', n: { $sum: 1 } } }
  ]);
  const c = countStatuses([]);
  for (const a of agg) { c[a._id] = a.n; c.total += a.n; }
  return { ...c, percent: attendancePercent(c, s.policy) };
}

async function publishedResults(studentId: string) {
  const results = await ExamResult.find({ studentId, deletedAt: null }).lean();
  const exams = await Exam.find({ _id: $in([...new Set(results.map((r) => r.examId))]), published: true, deletedAt: null }).sort({ startDate: -1 }).lean();
  return exams.map((e) => {
    const rows = results.filter((r) => r.examId === e._id).sort((a, b) => a.subject.localeCompare(b.subject))
      .map((r) => ({ subject: r.subject, maxMarks: r.maxMarks, marksObtained: r.marksObtained ?? null, absent: r.absent, remarks: r.remarks ?? null }));
    return { examId: e._id, name: e.name, term: e.term ?? null, startDate: e.startDate, publishedAt: e.publishedAt, rows, summary: summariseMarks(rows) };
  });
}

const today = async () => schoolDate(new Date(), (await getSettings()).timeZone);
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ Children & dashboard
parentRouter.get('/children', h(async (req, res) => {
  const ids = await parentChildIds(req);
  const students = await Student.find({ _id: $in(ids) }).select(PUBLIC_STUDENT).sort({ fullName: 1 }).lean();
  const names = await placementNames(students.map((s) => s.classroomId));
  ok(res, students.map((s) => ({ ...s, ...names(s.classroomId) })));
}));

parentRouter.get('/dashboard', h(async (req, res) => {
  const ids = await parentChildIds(req);
  const t = await today();
  const from30 = shift(t, -29);
  const students = await Student.find({ _id: $in(ids) }).select(PUBLIC_STUDENT).sort({ fullName: 1 }).lean();
  const names = await placementNames(students.map((s) => s.classroomId));
  const [vouchers, homework] = await Promise.all([
    FeeVoucher.find({ studentId: $in(ids), deletedAt: null, status: $in(['unpaid', 'partial']) }).sort({ dueDate: 1 }).lean(),
    Homework.find({ classroomId: $in(students.map((s) => s.classroomId)), deletedAt: null, dueDate: $cmp({ gte: t }) }).sort({ dueDate: 1 }).limit(50).lean()
  ]);
  const children = await Promise.all(students.map(async (s) => {
    const mine = vouchers.filter((v) => v.studentId === s._id);
    const results = await publishedResults(s._id);
    return {
      ...s, ...names(s.classroomId),
      attendance: await attendanceSummary(s._id, from30, t),
      latestResult: results[0] ? { examId: results[0].examId, name: results[0].name, percent: results[0].summary.percent, grade: results[0].summary.grade, passed: results[0].summary.passed } : null,
      fees: {
        outstandingMinor: mine.reduce((a, v) => a + balanceMinor(v.totalMinor, v.paidMinor), 0),
        currency: mine[0]?.currency ?? (await getSettings()).fees?.currency ?? 'PKR',
        overdue: mine.filter((v) => v.dueDate < t).length,
        nextDue: mine[0] ? { voucherId: mine[0]._id, dueDate: mine[0].dueDate, balanceMinor: balanceMinor(mine[0].totalMinor, mine[0].paidMinor), title: mine[0].title } : null
      },
      homework: homework.filter((hw) => hw.classroomId === s.classroomId).slice(0, 5).map((hw) => ({ _id: hw._id, subject: hw.subject, title: hw.title, dueDate: hw.dueDate }))
    };
  }));
  const gid = req.user!.guardianId;
  const [announcements, notifications, eventItems] = await Promise.all([
    Announcement.find({ deletedAt: null, publishedAt: $cmp({ ne: null, lte: new Date() }) }).sort({ pinned: -1, publishedAt: -1 }).limit(10).select('title body publishedAt pinned').lean(),
    gid ? NotificationJob.find({ guardianId: gid, deletedAt: null, studentId: $in(ids) }).sort({ createdAt: -1 }).limit(10).select('event channel status body createdAt sentAt deliveredAt studentId').lean() : [],
    WebsiteItem.find({ type: 'event', status: 'published', deletedAt: null, date: $cmp({ gte: new Date(Date.parse(t + 'T00:00:00Z') - 86_400_000) }) }).sort({ date: 1 }).limit(6).select('slug date data').lean()
  ]);
  const pick = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' ? (v as Record<string, string>).en ?? Object.values(v as Record<string, string>)[0] ?? '' : '');
  const events = eventItems.map((e) => {
    const d = (e.data ?? {}) as Record<string, unknown>;
    return { _id: e._id, slug: e.slug, date: e.date, title: pick(d.title), location: pick(d.location) };
  });
  ok(res, { today: t, children, announcements, notifications, events });
}));

// ------------------------------------------------------------------ One child
parentRouter.get('/children/:id', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const s = await Student.findById(id).select(PUBLIC_STUDENT).lean();
  if (!s) throw notFound();
  const names = await placementNames([s.classroomId]);
  const teachersIds = (await TeacherAssignment.find({ classroomId: s.classroomId, endedAt: null, deletedAt: null }).select('teacherId isHomeroom').lean());
  const teachers = await User.find({ _id: $in(teachersIds.map((t) => t.teacherId)), status: 'active', deletedAt: null }).select('fullName').lean();
  ok(res, { ...s, ...names(s.classroomId), teachers: teachers.map((t) => ({ fullName: t.fullName, isHomeroom: Boolean(teachersIds.find((a) => a.teacherId === t._id)?.isHomeroom) })) });
}));

/** The child's published class timetable (subject, teacher, period timing, room) plus timetable notices. */
parentRouter.get('/children/:id/timetable', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const s = await Student.findById(id).select('classroomId').lean();
  if (!s) throw notFound();
  const q = parse(z.object({ date: isoDate.optional() }), req.query);
  const [tt, notices] = await Promise.all([classroomTimetable(s.classroomId, q.date), noticesFor({ classroomIds: [s.classroomId] })]);
  ok(res, { ...tt, notices });
}));

parentRouter.get('/children/:id/attendance', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const t = await today();
  const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
  const to = q.to ?? t; const from = q.from ?? shift(to, -59);
  if (from > to) throw badRequest('from must be <= to');
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw badRequest('Range is limited to about one year');
  const records = await AttendanceRecord.find({ studentId: id, deletedAt: null, date: $cmp({ gte: from, lte: to }) }).sort({ date: -1 }).select('date status remark arrivalTime corrected').lean();
  ok(res, { from, to, summary: await attendanceSummary(id, from, to), records });
}));

parentRouter.get('/children/:id/results', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  ok(res, await publishedResults(id));
}));

parentRouter.get('/children/:id/report-card/:examId', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const examId = uuidOr404(req.params.examId);
  const exam = await Exam.findOne({ _id: examId, published: true, deletedAt: null }).lean();
  if (!exam) throw notFound('Report card not available');
  const rows = (await ExamResult.find({ examId, studentId: id, deletedAt: null }).sort({ subject: 1 }).lean())
    .map((r) => ({ subject: r.subject, maxMarks: r.maxMarks, marksObtained: r.marksObtained ?? null, absent: r.absent, remarks: r.remarks ?? null }));
  if (!rows.length) throw notFound('Report card not available');
  const st = (await Student.findById(id).lean())!;
  const names = await placementNames([st.classroomId]);
  const pdf = await renderReportCardPdf({ exam, student: st, className: names(st.classroomId).classroomName, sessionName: names(st.classroomId).sessionName, rows }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-card-${st.admissionNumber.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`);
  res.send(pdf);
}));

parentRouter.get('/children/:id/homework', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const q = parse(z.object({ scope: z.enum(['upcoming', 'past', 'all']).default('upcoming') }), req.query);
  const st = (await Student.findById(id).select('classroomId').lean())!;
  const t = await today();
  const filter: Record<string, unknown> = { classroomId: st.classroomId, deletedAt: null };
  if (q.scope === 'upcoming') filter.dueDate = $cmp({ gte: t });
  if (q.scope === 'past') filter.dueDate = $cmp({ lt: t });
  ok(res, await Homework.find(filter).sort({ dueDate: q.scope === 'upcoming' ? 1 : -1 }).limit(100).select('subject title description assignedDate dueDate').lean());
}));

parentRouter.get('/children/:id/feedback', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const items = await StudentFeedback.find({ studentId: id, visibleToParents: true, deletedAt: null }).sort({ createdAt: -1 }).limit(100).lean();
  const authors = await User.find({ _id: $in(items.map((i) => i.authorId)) }).select('fullName').lean();
  ok(res, items.map((i) => ({ _id: i._id, category: i.category, body: i.body, createdAt: i.createdAt, authorName: authors.find((a) => a._id === i.authorId)?.fullName ?? '' })));
}));

parentRouter.get('/children/:id/fees', h(async (req, res) => {
  const id = await childId(req, req.params.id);
  const [vouchers, payments] = await Promise.all([
    FeeVoucher.find({ studentId: id, deletedAt: null }).sort({ dueDate: -1 }).limit(200).select('-createdBy -cancelledBy -updatedByNode').lean(),
    FeePayment.find({ studentId: id, deletedAt: null }).sort({ paidAt: -1 }).limit(200).select('receiptNumber voucherId amountMinor overpaidMinor currency method provider paidAt').lean()
  ]);
  const t = await today();
  ok(res, {
    vouchers: vouchers.map((v) => ({ ...v, balanceMinor: balanceMinor(v.totalMinor, v.paidMinor), overdue: v.status !== 'paid' && v.status !== 'cancelled' && v.dueDate < t })),
    payments,
    outstandingMinor: vouchers.filter((v) => v.status === 'unpaid' || v.status === 'partial').reduce((a, v) => a + balanceMinor(v.totalMinor, v.paidMinor), 0)
  });
}));

// ------------------------------------------------------------------ Documents
async function ownVoucher(req: Request, raw: unknown) {
  const v = await FeeVoucher.findOne({ _id: uuidOr404(raw), deletedAt: null }).lean();
  if (!v || !(await parentChildIds(req)).includes(v.studentId)) throw notFound('Voucher not found');
  return v;
}

parentRouter.get('/vouchers/:id/pdf', h(async (req, res) => {
  const v = await ownVoucher(req, req.params.id);
  const st = (await Student.findById(v.studentId).lean())!;
  const names = await placementNames([v.classroomId]);
  const pdf = await renderVoucherPdf({ voucher: v, student: st, className: names(v.classroomId).classroomName }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="voucher-${v.voucherNumber}.pdf"`);
  res.send(pdf);
}));

parentRouter.get('/receipts/:id/pdf', h(async (req, res) => {
  const p = await FeePayment.findOne({ _id: uuidOr404(req.params.id), deletedAt: null }).lean();
  if (!p || !(await parentChildIds(req)).includes(p.studentId)) throw notFound('Receipt not found');
  const v = (await FeeVoucher.findById(p.voucherId).lean())!;
  const st = (await Student.findById(p.studentId).lean())!;
  const names = await placementNames([v.classroomId]);
  const pdf = await renderReceiptPdf({ payment: p, voucher: v, student: st, className: names(v.classroomId).classroomName }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${p.receiptNumber}.pdf"`);
  res.send(pdf);
}));

// ------------------------------------------------------------------ Online payment
const payLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `${req.user?.id ?? req.ip}` });

const statusLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 300, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `${req.user?.id ?? req.ip}` });

parentRouter.get('/payments/availability', h(async (_req, res) => {
  const cfg = await getPaymentConfig();
  const problems = paymentProblems(cfg);
  // Parents are told only whether online payment is available, never configuration details.
  ok(res, { available: problems.length === 0, provider: problems.length ? null : cfg.provider, currency: cfg.currency.toUpperCase() });
}));

parentRouter.post('/vouchers/:id/checkout', payLimiter, h(async (req, res) => {
  const v = await ownVoucher(req, req.params.id);
  const b = parse(z.object({ amountMinor: z.number().int().positive().optional() }), req.body);
  const intent = await startCheckout({ voucherId: v._id, userId: req.user!.id, amountMinor: b.amountMinor });
  await audit(req, 'payment.checkout_started', 'fee_voucher', v._id, { intentId: intent._id, amountMinor: intent.amountMinor });
  ok(res, { intentId: intent._id, checkoutUrl: intent.checkoutUrl, amountMinor: intent.amountMinor, currency: intent.currency, expiresAt: intent.expiresAt }, undefined, 201);
}));

/**
 * Status after returning from the provider. The return itself proves nothing: the server asks the
 * provider's API (reconcileIntent) and only a verified payment is shown as paid.
 */
parentRouter.get('/payments/:intentId', statusLimiter, h(async (req, res) => {
  const intent = await PaymentIntent.findOne({ _id: uuidOr404(req.params.intentId), userId: req.user!.id }).lean();
  if (!intent || !(await parentChildIds(req)).includes(intent.studentId)) throw notFound('Payment not found');
  let status: string = intent.status; let paymentId = intent.paymentId ?? null;
  if (['created', 'pending', 'failed'].includes(intent.status)) {
    try { const r = await reconcileIntent(intent._id, 'parent_return'); status = r.status; paymentId = r.paymentId; } catch (err) { logger.warn({ err: (err as Error).message }, 'payment reconcile failed'); }
  }
  const v = await FeeVoucher.findById(intent.voucherId).select('voucherNumber title totalMinor paidMinor status currency studentId').lean();
  const receipt = paymentId ? await FeePayment.findById(paymentId).select('receiptNumber amountMinor paidAt').lean() : null;
  ok(res, { intentId: intent._id, status, amountMinor: intent.amountMinor, currency: intent.currency, voucher: v, receipt: receipt ?? null });
}));

// ------------------------------------------------------------------ Notifications
parentRouter.get('/notifications', h(async (req, res) => {
  const gid = req.user!.guardianId;
  if (!gid) return ok(res, []);
  const ids = await parentChildIds(req);
  const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1) }), req.query);
  const items = await NotificationJob.find({ guardianId: gid, studentId: $in(ids), deletedAt: null }).sort({ createdAt: -1 }).skip((q.page - 1) * 25).limit(25)
    .select('event channel status body createdAt sentAt deliveredAt studentId').lean();
  ok(res, items);
}));
