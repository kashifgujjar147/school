import { Router, type Request } from 'express';
import { z } from 'zod';
import { isoDate, studentAccountSchema } from '@sms/shared';
import { AcademicSession, Classroom, SchoolClass, Section, Student, User } from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { classroomTimetable, noticesFor } from '../services/timetable.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { revokeAllForUser } from '../security/sessions.js';
import { conflict, forbidden, h, notFound, ok, parse } from '../utils/http.js';

/**
 * Student portal API. A student account is created FROM a student record (users.studentId), so it can
 * only ever see that student's own class timetable and notices. Anything else answers 404.
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
