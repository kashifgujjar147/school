import { Router } from 'express';
import { z } from 'zod';
import { academicSessionSchema, classSchema, holidaySchema, sectionSchema, assignmentSchema, classroomSchema } from '@sms/shared';
import { AcademicSession, Classroom, Holiday, SchoolClass, SchoolSettings, Section, Student, TeacherAssignment, User } from '../models/index.js';
import { can, canAny } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, softDeleteVersioned, updateVersioned } from '../services/repo.js';
import { invalidateSettings } from '../services/settings.js';
import { teacherClassroomIds } from '../services/access.js';
import { badRequest, conflict, h, notFound, ok, parse } from '../utils/http.js';

export const academicRouter = Router();
const idParam = (v: unknown) => z.string().uuid().parse(v);

// ---------------- Sessions
academicRouter.get('/sessions', can('classrooms.view'), h(async (_req, res) => {
  ok(res, await AcademicSession.find({ deletedAt: null }).sort({ startDate: -1 }).lean());
}));
academicRouter.post('/sessions', can('academic.manage'), h(async (req, res) => {
  const b = parse(academicSessionSchema, req.body);
  const doc = await createVersioned(AcademicSession, b);
  if (b.isDefault) await makeDefaultSession(doc._id);
  await audit(req, 'academic.session_created', 'session', doc._id);
  ok(res, doc, undefined, 201);
}));
academicRouter.patch('/sessions/:id', can('academic.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ name: z.string().min(1).max(60).optional(), startDate: z.string().optional(), endDate: z.string().optional(), isDefault: z.boolean().optional(), archived: z.boolean().optional() }), req.body);
  const doc = await updateVersioned(AcademicSession, id, b);
  if (b.isDefault) await makeDefaultSession(id);
  ok(res, doc);
}));
async function makeDefaultSession(id: string) {
  const others = await AcademicSession.find({ _id: { $ne: id }, isDefault: true }).select('_id').lean();
  for (const o of others) await updateVersioned(AcademicSession, o._id, { isDefault: false });
  await updateVersioned(SchoolSettings, 'school', { defaultSessionId: id });
  invalidateSettings();
}

// ---------------- Classes & sections
academicRouter.get('/classes', can('classrooms.view'), h(async (_req, res) => {
  const [classes, sections] = await Promise.all([
    SchoolClass.find({ deletedAt: null }).sort({ order: 1, name: 1 }).lean(),
    Section.find({ deletedAt: null }).sort({ name: 1 }).lean()
  ]);
  ok(res, classes.map((c) => ({ ...c, sections: sections.filter((s) => s.classId === c._id) })));
}));
academicRouter.post('/classes', can('academic.manage'), h(async (req, res) => {
  ok(res, await createVersioned(SchoolClass, parse(classSchema, req.body)), undefined, 201);
}));
academicRouter.patch('/classes/:id', can('academic.manage'), h(async (req, res) => {
  ok(res, await updateVersioned(SchoolClass, idParam(req.params.id), parse(classSchema.partial().extend({ archived: z.boolean().optional() }), req.body)));
}));
academicRouter.post('/sections', can('academic.manage'), h(async (req, res) => {
  const b = parse(sectionSchema, req.body);
  if (!(await SchoolClass.exists({ _id: b.classId, deletedAt: null }))) throw badRequest('Class not found');
  ok(res, await createVersioned(Section, b), undefined, 201);
}));
academicRouter.patch('/sections/:id', can('academic.manage'), h(async (req, res) => {
  ok(res, await updateVersioned(Section, idParam(req.params.id), parse(z.object({ name: z.string().min(1).max(30).optional(), archived: z.boolean().optional() }), req.body)));
}));

// ---------------- Holidays / calendar
academicRouter.get('/holidays', can('classrooms.view'), h(async (req, res) => {
  const year = z.coerce.number().int().min(2000).max(2100).optional().parse(req.query.year);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (year) filter.date = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
  ok(res, await Holiday.find(filter).sort({ date: 1 }).lean());
}));
academicRouter.post('/holidays', can('academic.manage'), h(async (req, res) => {
  const b = parse(holidaySchema, req.body);
  if (b.endDate && b.endDate < b.date) throw badRequest('End date must be on or after start date');
  ok(res, await createVersioned(Holiday, b), undefined, 201);
}));
academicRouter.delete('/holidays/:id', can('academic.manage'), h(async (req, res) => {
  await softDeleteVersioned(Holiday, idParam(req.params.id));
  ok(res, { deleted: true });
}));

// ---------------- Classrooms
academicRouter.get('/classrooms', canAny('classrooms.view', 'attendance.mark'), h(async (req, res) => {
  const q = parse(z.object({ sessionId: z.string().uuid().optional(), includeArchived: z.coerce.boolean().optional(), mine: z.coerce.boolean().optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (!q.includeArchived) filter.archived = false;
  if (q.sessionId) filter.sessionId = q.sessionId;
  // Teachers only ever see classrooms assigned to them.
  if (q.mine || !req.user!.permissions.includes('attendance.view_all')) {
    filter._id = { $in: await teacherClassroomIds(req.user!.id) };
  }
  const rooms = await Classroom.find(filter).lean();
  const [classes, sections, counts, assignments] = await Promise.all([
    SchoolClass.find({ _id: { $in: rooms.map((r) => r.classId) } }).lean(),
    Section.find({ _id: { $in: rooms.map((r) => r.sectionId) } }).lean(),
    Student.aggregate<{ _id: string; n: number }>([{ $match: { classroomId: { $in: rooms.map((r) => r._id) }, status: 'active', deletedAt: null } }, { $group: { _id: '$classroomId', n: { $sum: 1 } } }]),
    TeacherAssignment.find({ classroomId: { $in: rooms.map((r) => r._id) }, endedAt: null, deletedAt: null }).lean()
  ]);
  const teachers = await User.find({ _id: { $in: assignments.map((a) => a.teacherId) } }).select('fullName').lean();
  const out = rooms.map((r) => {
    const cls = classes.find((c) => c._id === r.classId);
    return {
      ...r,
      className: cls?.name, classOrder: cls?.order ?? 0,
      sectionName: sections.find((s) => s._id === r.sectionId)?.name,
      studentCount: counts.find((c) => c._id === r._id)?.n ?? 0,
      teachers: assignments.filter((a) => a.classroomId === r._id).map((a) => ({ id: a.teacherId, assignmentId: a._id, name: teachers.find((t) => t._id === a.teacherId)?.fullName, isHomeroom: a.isHomeroom }))
    };
  }).sort((a, b) => a.classOrder - b.classOrder || String(a.sectionName).localeCompare(String(b.sectionName)));
  ok(res, out);
}));
academicRouter.post('/classrooms', can('classrooms.manage'), h(async (req, res) => {
  const b = parse(classroomSchema, req.body);
  const sec = await Section.findOne({ _id: b.sectionId, classId: b.classId, deletedAt: null }).lean();
  if (!sec) throw badRequest('Section does not belong to this class');
  if (!(await AcademicSession.exists({ _id: b.sessionId, deletedAt: null }))) throw badRequest('Academic session not found');
  const doc = await createVersioned(Classroom, b);
  await audit(req, 'classroom.created', 'classroom', doc._id);
  ok(res, doc, undefined, 201);
}));
academicRouter.patch('/classrooms/:id', can('classrooms.manage'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(80).optional(), room: z.string().max(40).nullable().optional(), capacity: z.number().int().min(1).max(500).nullable().optional(), archived: z.boolean().optional() }), req.body);
  const id = idParam(req.params.id);
  if (b.archived && (await Student.exists({ classroomId: id, status: 'active', deletedAt: null }))) throw conflict('Move or archive the active students in this classroom first');
  ok(res, await updateVersioned(Classroom, id, b));
}));

// ---------------- Teacher assignments (history preserved: ending sets endedAt)
academicRouter.get('/assignments', can('classrooms.view'), h(async (req, res) => {
  const q = parse(z.object({ classroomId: z.string().uuid().optional(), teacherId: z.string().uuid().optional(), includeEnded: z.coerce.boolean().optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.classroomId) filter.classroomId = q.classroomId;
  if (q.teacherId) filter.teacherId = q.teacherId;
  if (!q.includeEnded) filter.endedAt = null;
  ok(res, await TeacherAssignment.find(filter).sort({ startedAt: -1 }).limit(500).lean());
}));
academicRouter.post('/assignments', can('assignments.manage'), h(async (req, res) => {
  const b = parse(assignmentSchema, req.body);
  const teacher = await User.findOne({ _id: b.teacherId, deletedAt: null }).lean();
  if (!teacher || teacher.role !== 'teacher') throw badRequest('User is not a teacher');
  if (!(await Classroom.exists({ _id: b.classroomId, deletedAt: null, archived: false }))) throw badRequest('Classroom not found');
  if (await TeacherAssignment.exists({ teacherId: b.teacherId, classroomId: b.classroomId, endedAt: null, deletedAt: null })) throw conflict('Teacher is already assigned to this classroom');
  const doc = await createVersioned(TeacherAssignment, { ...b, assignedBy: req.user!.id, startedAt: new Date() });
  await audit(req, 'assignment.created', 'assignment', doc._id, b);
  ok(res, doc, undefined, 201);
}));
academicRouter.post('/assignments/:id/end', can('assignments.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const a = await TeacherAssignment.findById(id).lean();
  if (!a || a.endedAt) throw notFound('Active assignment not found');
  const doc = await updateVersioned(TeacherAssignment, id, { endedAt: new Date(), endedBy: req.user!.id });
  await audit(req, 'assignment.ended', 'assignment', id);
  ok(res, doc);
}));
