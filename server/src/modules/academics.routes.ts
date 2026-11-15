import { Router } from 'express';
import { z } from 'zod';
import { examSchema, feedbackSchema, homeworkSchema, homeworkUpdateSchema, resultsSaveSchema, summariseMarks, percentOf, PASS_PERCENT } from '@sms/shared';
import { AcademicSession, Classroom, Exam, ExamResult, Homework, Student, StudentFeedback, User } from '../models/index.js';
import { can, canAny, requireFeature } from '../middleware/auth.js';
import { withTransaction } from '../config/db.js';
import { assertClassroomAccess, classroomScopeFilter } from '../services/access.js';
import { audit } from '../services/audit.js';
import { renderReportCardPdf } from '../services/documents.js';
import { enqueueStudentEvent } from '../services/notifications.js';
import { createVersioned, softDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { badRequest, conflict, forbidden, h, notFound, ok, parse } from '../utils/http.js';
import { $in } from '../utils/query.js';
import { logger } from '../utils/logger.js';

const idParam = (v: unknown) => z.string().uuid().parse(v);

// ================================================================== Exams & results
export const examsRouter = Router();
examsRouter.use(requireFeature('exams'));

examsRouter.get('/', canAny('exams.view', 'results.enter', 'exams.manage'), h(async (req, res) => {
  const q = parse(z.object({ sessionId: z.string().uuid().optional() }), req.query);
  const s = await getSettings();
  const sessionId = q.sessionId ?? s.defaultSessionId;
  ok(res, await Exam.find({ deletedAt: null, ...(sessionId ? { sessionId } : {}) }).sort({ startDate: -1 }).limit(200).lean());
}));

examsRouter.post('/', can('exams.manage'), h(async (req, res) => {
  const b = parse(examSchema, req.body);
  const s = await getSettings();
  if (!s.defaultSessionId) throw badRequest('Set a default academic session first (Classrooms → Sessions)');
  const e = await createVersioned(Exam, { ...b, sessionId: s.defaultSessionId, createdBy: req.user!.id });
  await audit(req, 'exam.created', 'exam', e._id);
  ok(res, e, undefined, 201);
}));

examsRouter.patch('/:id', can('exams.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ name: z.string().trim().min(1).max(120), term: z.string().trim().max(60).nullable(), startDate: z.string(), endDate: z.string().nullable() }).partial(), req.body);
  ok(res, await updateVersioned(Exam, id, b));
}));

examsRouter.delete('/:id', can('exams.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const e = await Exam.findOne({ _id: id, deletedAt: null }).lean();
  if (!e) throw notFound();
  if (e.published) throw conflict('Unpublish the exam before deleting it');
  if (await ExamResult.exists({ examId: id, deletedAt: null })) throw conflict('This exam has results. Remove them first.');
  await softDeleteVersioned(Exam, id);
  await audit(req, 'exam.deleted', 'exam', id);
  ok(res, { deleted: true });
}));

/** Marks sheet for one classroom: every active student, with any marks already entered. */
examsRouter.get('/:id/results', canAny('exams.view', 'results.enter', 'exams.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const q = parse(z.object({ classroomId: z.string().uuid(), subject: z.string().trim().max(80).optional() }), req.query);
  await assertClassroomAccess(req.user!, q.classroomId);
  const exam = await Exam.findOne({ _id: id, deletedAt: null }).lean();
  if (!exam) throw notFound('Exam not found');
  const [students, results] = await Promise.all([
    Student.find({ classroomId: q.classroomId, status: 'active', deletedAt: null }).select('fullName admissionNumber').sort({ fullName: 1 }).lean(),
    ExamResult.find({ examId: id, classroomId: q.classroomId, deletedAt: null, ...(q.subject ? { subjectKey: q.subject.toLowerCase() } : {}) }).lean()
  ]);
  const subjects = [...new Set((await ExamResult.find({ examId: id, classroomId: q.classroomId, deletedAt: null }).select('subject').lean()).map((r) => r.subject))].sort();
  ok(res, { exam, students, results, subjects });
}));

/**
 * Teachers enter marks for their own classrooms; once an exam is published only users with
 * exams.manage can change marks (published results are what parents see).
 */
examsRouter.put('/:id/results', can('results.enter'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(resultsSaveSchema, req.body);
  await assertClassroomAccess(req.user!, b.classroomId);
  const exam = await Exam.findOne({ _id: id, deletedAt: null }).lean();
  if (!exam) throw notFound('Exam not found');
  if (exam.published && !req.user!.permissions.includes('exams.manage')) throw forbidden('Results are published. Ask an administrator to make corrections.');
  const roster = new Set((await Student.find({ classroomId: b.classroomId, deletedAt: null }).select('_id').lean()).map((s) => s._id));
  const strangers = b.entries.filter((e) => !roster.has(e.studentId));
  if (strangers.length) throw badRequest(`${strangers.length} student(s) are not in this classroom`);
  const subjectKey = b.subject.trim().toLowerCase();
  // One display name per subject in an exam: the first spelling entered wins ("Maths" vs "maths").
  const subject = (await ExamResult.findOne({ examId: id, subjectKey, deletedAt: null }).select('subject').lean())?.subject ?? b.subject.trim();
  const saved = await withTransaction(async (session) => {
    let n = 0;
    const existing = await ExamResult.find({ examId: id, subjectKey, studentId: $in(b.entries.map((e) => e.studentId)), deletedAt: null }).session(session ?? null).lean();
    for (const e of b.entries) {
      const data = { maxMarks: b.maxMarks, marksObtained: e.absent ? null : e.marksObtained, absent: e.absent, remarks: e.remarks ?? undefined, enteredBy: req.user!.id, subject, classroomId: b.classroomId };
      const cur = existing.find((x) => x.studentId === e.studentId);
      if (cur) await updateVersioned(ExamResult, cur._id, data, { session });
      else await createVersioned(ExamResult, { examId: id, studentId: e.studentId, subjectKey, ...data }, { session });
      n++;
    }
    return n;
  });
  await audit(req, 'exam.results_saved', 'exam', id, { classroomId: b.classroomId, subject, count: saved });
  ok(res, { saved });
}));

examsRouter.post('/:id/publish', can('exams.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ published: z.boolean(), notifyParents: z.boolean().default(true) }), req.body);
  const exam = await Exam.findOne({ _id: id, deletedAt: null }).lean();
  if (!exam) throw notFound();
  if (b.published && !(await ExamResult.exists({ examId: id, deletedAt: null }))) throw badRequest('Enter results before publishing');
  const r = await updateVersioned(Exam, id, b.published ? { published: true, publishedAt: new Date(), publishedBy: req.user!.id } : { published: false, publishedAt: null });
  await audit(req, b.published ? 'exam.published' : 'exam.unpublished', 'exam', id);
  let notifications = null;
  if (b.published && b.notifyParents) {
    const studentIds = [...new Set((await ExamResult.find({ examId: id, deletedAt: null }).select('studentId').lean()).map((x) => x.studentId))];
    notifications = await enqueueStudentEvent({ event: 'result', studentIds, key: `exam:${id}`, refId: id, actorId: req.user!.id, vars: () => ({ examName: exam.name }) })
      .catch((err) => { logger.error({ err }, 'result notifications failed'); return null; });
  }
  ok(res, { exam: r, notifications });
}));

/** Class result summary: per-student totals and per-subject averages. */
examsRouter.get('/:id/summary', canAny('exams.view', 'exams.manage', 'results.enter'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const q = parse(z.object({ classroomId: z.string().uuid() }), req.query);
  await assertClassroomAccess(req.user!, q.classroomId);
  const results = await ExamResult.find({ examId: id, classroomId: q.classroomId, deletedAt: null }).lean();
  const students = await Student.find({ _id: $in([...new Set(results.map((r) => r.studentId))]) }).select('fullName admissionNumber').lean();
  const perStudent = students.map((s) => ({ student: s, ...summariseMarks(results.filter((r) => r.studentId === s._id).map((r) => ({ subject: r.subject, maxMarks: r.maxMarks, marksObtained: r.marksObtained ?? null, absent: r.absent }))) }))
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const subjects = [...new Set(results.map((r) => r.subject))].sort().map((subject) => {
    const rows = results.filter((r) => r.subject === subject);
    const pcts = rows.map((r) => percentOf(r.absent ? 0 : r.marksObtained ?? 0, r.maxMarks) ?? 0);
    return { subject, entries: rows.length, average: pcts.length ? Math.round((pcts.reduce((a, x) => a + x, 0) / pcts.length) * 10) / 10 : null, passRate: pcts.length ? Math.round((pcts.filter((p) => p >= PASS_PERCENT).length / pcts.length) * 1000) / 10 : null };
  });
  ok(res, { perStudent, subjects });
}));

examsRouter.get('/:id/report-card/:studentId', canAny('exams.view', 'exams.manage', 'results.enter'), h(async (req, res) => {
  const id = idParam(req.params.id); const studentId = idParam(req.params.studentId);
  const st = await Student.findOne({ _id: studentId, deletedAt: null }).lean();
  if (!st) throw notFound();
  await assertClassroomAccess(req.user!, st.classroomId);
  const exam = await Exam.findOne({ _id: id, deletedAt: null }).lean();
  if (!exam) throw notFound();
  const rows = (await ExamResult.find({ examId: id, studentId, deletedAt: null }).sort({ subject: 1 }).lean()).map((r) => ({ subject: r.subject, maxMarks: r.maxMarks, marksObtained: r.marksObtained ?? null, absent: r.absent, remarks: r.remarks ?? null }));
  if (!rows.length) throw notFound('No results for this student');
  const [room, sess] = await Promise.all([Classroom.findById(st.classroomId).select('name').lean(), AcademicSession.findById(exam.sessionId).select('name').lean()]);
  const pdf = await renderReportCardPdf({ exam, student: st, className: room?.name ?? '', sessionName: sess?.name, rows }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="report-card-${st.admissionNumber.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`);
  res.send(pdf);
}));

// ================================================================== Homework
export const homeworkRouter = Router();
homeworkRouter.use(requireFeature('homework'));

homeworkRouter.get('/', canAny('homework.view', 'homework.manage'), h(async (req, res) => {
  const q = parse(z.object({ classroomId: z.string().uuid().optional(), from: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const scope = await classroomScopeFilter(req.user!);
  const filter: Record<string, unknown> = { deletedAt: null, ...scope };
  if (q.classroomId) { await assertClassroomAccess(req.user!, q.classroomId); filter.classroomId = q.classroomId; }
  const items = await Homework.find(filter).sort({ dueDate: -1, createdAt: -1 }).skip((q.page - 1) * 50).limit(50).lean();
  const rooms = await Classroom.find({ _id: $in(items.map((i) => i.classroomId)) }).select('name').lean();
  const authors = await User.find({ _id: $in(items.map((i) => i.createdBy)) }).select('fullName').lean();
  ok(res, items.map((i) => ({ ...i, classroomName: rooms.find((r) => r._id === i.classroomId)?.name, createdByName: authors.find((a) => a._id === i.createdBy)?.fullName })));
}));

homeworkRouter.post('/', can('homework.manage'), h(async (req, res) => {
  const b = parse(homeworkSchema, req.body);
  await assertClassroomAccess(req.user!, b.classroomId);
  if (!(await Classroom.exists({ _id: b.classroomId, deletedAt: null, archived: false }))) throw notFound('Classroom not found');
  const { notifyParents, ...data } = b;
  const hw = await createVersioned(Homework, { ...data, createdBy: req.user!.id });
  await audit(req, 'homework.created', 'homework', hw._id, { classroomId: b.classroomId });
  let notifications = null;
  if (notifyParents) {
    const studentIds = (await Student.find({ classroomId: b.classroomId, status: 'active', deletedAt: null }).select('_id').lean()).map((s) => s._id);
    notifications = await enqueueStudentEvent({ event: 'homework', studentIds, key: `hw:${hw._id}`, refId: hw._id, actorId: req.user!.id, vars: () => ({ subject: b.subject, title: b.title, dueDate: b.dueDate }) })
      .catch((err) => { logger.error({ err }, 'homework notifications failed'); return null; });
  }
  ok(res, { homework: hw, notifications }, undefined, 201);
}));

async function ownedHomework(req: Parameters<typeof assertClassroomAccess>[0], id: string) {
  const hw = await Homework.findOne({ _id: id, deletedAt: null }).lean();
  if (!hw) throw notFound();
  await assertClassroomAccess(req, hw.classroomId);
  return hw;
}

homeworkRouter.patch('/:id', can('homework.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(homeworkUpdateSchema, req.body);
  const hw = await ownedHomework(req.user!, id);
  const assigned = b.assignedDate ?? hw.assignedDate; const due = b.dueDate ?? hw.dueDate;
  if (assigned > due) throw badRequest('Due date must be on or after the assigned date');
  ok(res, await updateVersioned(Homework, id, b));
}));

homeworkRouter.delete('/:id', can('homework.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const hw = await ownedHomework(req.user!, id);
  if (hw.createdBy !== req.user!.id && !req.user!.permissions.includes('students.manage')) throw forbidden('Only the teacher who set this homework or an administrator can remove it');
  await softDeleteVersioned(Homework, id);
  await audit(req, 'homework.deleted', 'homework', id);
  ok(res, { deleted: true });
}));

// ================================================================== Teacher feedback
export const feedbackRouter = Router();

feedbackRouter.get('/', canAny('feedback.write', 'students.view'), h(async (req, res) => {
  const q = parse(z.object({ studentId: z.string().uuid() }), req.query);
  const st = await Student.findOne({ _id: q.studentId, deletedAt: null }).select('classroomId').lean();
  if (!st) throw notFound();
  await assertClassroomAccess(req.user!, st.classroomId);
  const items = await StudentFeedback.find({ studentId: q.studentId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean();
  const authors = await User.find({ _id: $in(items.map((i) => i.authorId)) }).select('fullName').lean();
  ok(res, items.map((i) => ({ ...i, authorName: authors.find((a) => a._id === i.authorId)?.fullName })));
}));

feedbackRouter.post('/', can('feedback.write'), h(async (req, res) => {
  const b = parse(feedbackSchema, req.body);
  const st = await Student.findOne({ _id: b.studentId, deletedAt: null }).select('classroomId').lean();
  if (!st) throw notFound('Student not found');
  await assertClassroomAccess(req.user!, st.classroomId);
  const f = await createVersioned(StudentFeedback, { ...b, classroomId: st.classroomId, authorId: req.user!.id });
  await audit(req, 'feedback.created', 'student', b.studentId);
  ok(res, f, undefined, 201);
}));

feedbackRouter.delete('/:id', can('feedback.write'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const f = await StudentFeedback.findOne({ _id: id, deletedAt: null }).lean();
  if (!f) throw notFound();
  // Authors may remove their own notes; administrators (students.manage) may remove any.
  if (f.authorId !== req.user!.id && !req.user!.permissions.includes('students.manage')) throw forbidden();
  await softDeleteVersioned(StudentFeedback, id);
  ok(res, { deleted: true });
}));
