import { Router } from 'express';
import { analyticsQuerySchema, attendancePercent, countStatuses, percentOf, PASS_PERCENT, schoolDate, type AttendanceStatus } from '@sms/shared';
import { AttendanceRecord, Classroom, Exam, ExamResult, FeePayment, FeeVoucher, SchoolClass, Student, User } from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { h, ok, parse } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';

/**
 * School analytics computed from live records (no cached or sample figures). Every number can be
 * traced back to attendancerecords, feevouchers, feepayments, examresults or students.
 * Installations are single-school, so the database itself is the school boundary; the optional
 * classId narrows every figure to one class.
 */
export const analyticsRouter = Router();
analyticsRouter.use(requireFeature('analytics'));

const DAY = 86_400_000;
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
const shiftYear = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`.replace(/-02-29$/, '-02-28');
const startOf = (iso: string) => new Date(iso + 'T00:00:00Z');
const endOf = (iso: string) => new Date(iso + 'T23:59:59.999Z');

interface Scope { roomIds: string[] | null; classId?: string }

function roomMatch(scope: Scope) { return scope.roomIds ? { classroomId: $in(scope.roomIds) } : {}; }

async function attendanceCounts(from: string, to: string, scope: Scope) {
  const agg = await AttendanceRecord.aggregate<{ _id: AttendanceStatus; n: number }>([
    { $match: { deletedAt: null, date: $cmp({ gte: from, lte: to }), ...roomMatch(scope) } },
    { $group: { _id: '$status', n: { $sum: 1 } } }
  ]);
  const c = countStatuses([]);
  for (const a of agg) { c[a._id] = a.n; c.total += a.n; }
  return c;
}

async function voucherIdsFor(scope: Scope): Promise<string[] | null> {
  if (!scope.classId) return null;
  return (await FeeVoucher.find({ classId: scope.classId, deletedAt: null }).select('_id').lean()).map((v) => v._id);
}

async function collected(from: string, to: string, scope: Scope, voucherIds: string[] | null) {
  const r = await FeePayment.aggregate<{ _id: null; amount: number; n: number }>([
    { $match: { deletedAt: null, paidAt: $cmp({ gte: startOf(from), lte: endOf(to) }), ...(voucherIds ? { voucherId: $in(voucherIds) } : {}) } },
    { $group: { _id: null, amount: { $sum: '$amountMinor' }, n: { $sum: 1 } } }
  ]);
  void scope;
  return { amountMinor: r[0]?.amount ?? 0, payments: r[0]?.n ?? 0 };
}

async function issued(from: string, to: string, scope: Scope) {
  const r = await FeeVoucher.aggregate<{ _id: null; amount: number; n: number }>([
    { $match: { deletedAt: null, status: $in(['unpaid', 'partial', 'paid']), issueDate: $cmp({ gte: from, lte: to }), ...(scope.classId ? { classId: scope.classId } : {}) } },
    { $group: { _id: null, amount: { $sum: '$totalMinor' }, n: { $sum: 1 } } }
  ]);
  return { amountMinor: r[0]?.amount ?? 0, vouchers: r[0]?.n ?? 0 };
}

async function admissions(from: string, to: string, scope: Scope) {
  return Student.countDocuments({ deletedAt: null, admissionDate: $cmp({ gte: from, lte: to }), ...(scope.classId ? { classId: scope.classId } : {}) });
}

async function periodMetrics(from: string, to: string, scope: Scope, voucherIds: string[] | null, policy: Parameters<typeof attendancePercent>[1]) {
  const [att, col, iss, adm] = await Promise.all([attendanceCounts(from, to, scope), collected(from, to, scope, voucherIds), issued(from, to, scope), admissions(from, to, scope)]);
  return { from, to, attendancePercent: attendancePercent(att, policy), attendanceRecords: att.total, collectedMinor: col.amountMinor, issuedMinor: iss.amountMinor, admissions: adm };
}

analyticsRouter.get('/summary', can('analytics.view'), h(async (req, res) => {
  const q = parse(analyticsQuerySchema, req.query);
  const s = await getSettings();
  const today = schoolDate(new Date(), s.timeZone);
  const rooms = await Classroom.find({ deletedAt: null, ...(q.classId ? { classId: q.classId } : {}) }).select('name classId archived').lean();
  const scope: Scope = { roomIds: q.classId ? rooms.map((r) => r._id) : null, classId: q.classId };
  const voucherIds = await voucherIdsFor(scope);
  const spanDays = Math.round((Date.parse(q.to) - Date.parse(q.from)) / DAY) + 1;
  const monthly = spanDays > 92;
  const studentScope = { deletedAt: null, ...(q.classId ? { classId: q.classId } : {}) };

  const [
    activeStudents, studentsByStatus, staffByRole, attTrend, attByRoom, outstanding, overdue, payTrend, payByMethod, enrollTrend, exams
  ] = await Promise.all([
    Student.countDocuments({ ...studentScope, status: 'active' }),
    Student.aggregate<{ _id: string; n: number }>([{ $match: studentScope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.aggregate<{ _id: string; n: number }>([{ $match: { deletedAt: null, status: 'active', role: $in(['principal', 'admin', 'teacher', 'staff']) } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
    AttendanceRecord.aggregate<{ _id: { k: string; s: AttendanceStatus }; n: number }>([
      { $match: { deletedAt: null, date: $cmp({ gte: q.from, lte: q.to }), ...roomMatch(scope) } },
      { $group: { _id: { k: monthly ? { $substrBytes: ['$date', 0, 7] } : '$date', s: '$status' }, n: { $sum: 1 } } }
    ]),
    AttendanceRecord.aggregate<{ _id: { r: string; s: AttendanceStatus }; n: number }>([
      { $match: { deletedAt: null, date: $cmp({ gte: q.from, lte: q.to }), ...roomMatch(scope) } },
      { $group: { _id: { r: '$classroomId', s: '$status' }, n: { $sum: 1 } } }
    ]),
    FeeVoucher.aggregate<{ _id: null; due: number; n: number }>([
      { $match: { deletedAt: null, status: $in(['unpaid', 'partial']), ...(q.classId ? { classId: q.classId } : {}) } },
      { $group: { _id: null, due: { $sum: { $subtract: ['$totalMinor', '$paidMinor'] } }, n: { $sum: 1 } } }
    ]),
    FeeVoucher.aggregate<{ _id: null; due: number; n: number }>([
      { $match: { deletedAt: null, status: $in(['unpaid', 'partial']), dueDate: $cmp({ lt: today }), ...(q.classId ? { classId: q.classId } : {}) } },
      { $group: { _id: null, due: { $sum: { $subtract: ['$totalMinor', '$paidMinor'] } }, n: { $sum: 1 } } }
    ]),
    FeePayment.aggregate<{ _id: string; amount: number }>([
      { $match: { deletedAt: null, paidAt: $cmp({ gte: startOf(q.from), lte: endOf(q.to) }), ...(voucherIds ? { voucherId: $in(voucherIds) } : {}) } },
      { $group: { _id: { $dateToString: { format: monthly ? '%Y-%m' : '%Y-%m-%d', date: '$paidAt', timezone: s.timeZone } }, amount: { $sum: '$amountMinor' } } },
      { $sort: { _id: 1 } }
    ]),
    FeePayment.aggregate<{ _id: string; amount: number; n: number }>([
      { $match: { deletedAt: null, paidAt: $cmp({ gte: startOf(q.from), lte: endOf(q.to) }), ...(voucherIds ? { voucherId: $in(voucherIds) } : {}) } },
      { $group: { _id: '$method', amount: { $sum: '$amountMinor' }, n: { $sum: 1 } } }
    ]),
    Student.aggregate<{ _id: string; n: number }>([
      { $match: { ...studentScope, admissionDate: $cmp({ gte: shift(q.to, -730), lte: q.to }) } },
      { $group: { _id: { $substrBytes: ['$admissionDate', 0, 7] }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }
    ]),
    Exam.find({ deletedAt: null, startDate: $cmp({ gte: q.from, lte: q.to }) }).sort({ startDate: 1 }).select('name startDate published').lean()
  ]);

  // Attendance trend (per day, or per month for long ranges)
  const keys = [...new Set(attTrend.map((t) => t._id.k))].sort();
  const attendanceTrend = keys.map((k) => {
    const c = countStatuses([]);
    for (const t of attTrend.filter((x) => x._id.k === k)) { c[t._id.s] = t.n; c.total += t.n; }
    return { period: k, ...c, percent: attendancePercent(c, s.policy) };
  });
  const totals = countStatuses([]);
  for (const t of attTrend) { totals[t._id.s] += t.n; totals.total += t.n; }

  const classNames = await SchoolClass.find({ _id: $in(rooms.map((r) => r.classId)) }).select('name order').lean();
  const classroomAttendance = rooms.map((r) => {
    const c = countStatuses([]);
    for (const a of attByRoom.filter((x) => x._id.r === r._id)) { c[a._id.s] = a.n; c.total += a.n; }
    return { classroomId: r._id, classroomName: r.name, className: classNames.find((x) => x._id === r.classId)?.name ?? '', ...c, percent: attendancePercent(c, s.policy) };
  }).filter((r) => r.total > 0).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0));

  // Exam performance
  const results = exams.length ? await ExamResult.find({ examId: $in(exams.map((e) => e._id)), deletedAt: null, ...roomMatch(scope) }).select('examId studentId maxMarks marksObtained absent').lean() : [];
  const examPerformance = exams.map((e) => {
    const rows = results.filter((r) => r.examId === e._id);
    const perStudent = new Map<string, { max: number; got: number; subjects: number; failed: number }>();
    for (const r of rows) {
      const got = r.absent ? 0 : r.marksObtained ?? 0;
      const cur = perStudent.get(r.studentId) ?? { max: 0, got: 0, subjects: 0, failed: 0 };
      cur.max += r.maxMarks; cur.got += got; cur.subjects++;
      if ((percentOf(got, r.maxMarks) ?? 0) < PASS_PERCENT) cur.failed++;
      perStudent.set(r.studentId, cur);
    }
    const pcts = [...perStudent.values()].map((v) => percentOf(v.got, v.max) ?? 0);
    const passed = [...perStudent.values()].filter((v) => v.failed === 0).length;
    return {
      examId: e._id, name: e.name, startDate: e.startDate, published: e.published, students: perStudent.size,
      averagePercent: pcts.length ? Math.round((pcts.reduce((a, x) => a + x, 0) / pcts.length) * 10) / 10 : null,
      passRate: perStudent.size ? Math.round((passed / perStudent.size) * 1000) / 10 : null
    };
  });

  // Comparisons: the previous period of equal length, and the same dates last year.
  const prevTo = shift(q.from, -1); const prevFrom = shift(prevTo, -(spanDays - 1));
  const [current, previous, lastYear] = await Promise.all([
    periodMetrics(q.from, q.to, scope, voucherIds, s.policy),
    periodMetrics(prevFrom, prevTo, scope, voucherIds, s.policy),
    periodMetrics(shiftYear(q.from, -1), shiftYear(q.to, -1), scope, voucherIds, s.policy)
  ]);

  const role = (r: string) => staffByRole.find((x) => x._id === r)?.n ?? 0;
  ok(res, {
    range: { from: q.from, to: q.to, granularity: monthly ? 'month' : 'day', classId: q.classId ?? null },
    currency: s.fees?.currency ?? 'PKR',
    totals: {
      activeStudents, studentsByStatus: Object.fromEntries(studentsByStatus.map((x) => [x._id, x.n])),
      teachers: role('teacher'), staff: role('staff') + role('admin') + role('principal'), staffByRole: Object.fromEntries(staffByRole.map((x) => [x._id, x.n])),
      classrooms: rooms.filter((r) => !r.archived).length
    },
    attendance: { ...totals, percent: attendancePercent(totals, s.policy), trend: attendanceTrend, byClassroom: classroomAttendance },
    fees: {
      collectedMinor: current.collectedMinor, issuedMinor: current.issuedMinor,
      outstandingMinor: outstanding[0]?.due ?? 0, outstandingVouchers: outstanding[0]?.n ?? 0,
      overdueMinor: overdue[0]?.due ?? 0, overdueVouchers: overdue[0]?.n ?? 0,
      collectionTrend: payTrend.map((p) => ({ period: p._id, amountMinor: p.amount })),
      byMethod: payByMethod.map((m) => ({ method: m._id, amountMinor: m.amount, payments: m.n }))
    },
    exams: examPerformance,
    enrollment: { trend: enrollTrend.map((e) => ({ month: e._id, admissions: e.n })), admissionsInRange: current.admissions },
    comparison: { current, previous, lastYear }
  });
}));
