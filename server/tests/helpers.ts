import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { connectDatabase } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { AcademicSession, Classroom, SchoolClass, SchoolSettings, Section, Student, TeacherAssignment, User } from '../src/models/index.js';
import { hashPassword } from '../src/security/crypto.js';
import { createVersioned } from '../src/services/repo.js';
import { invalidateSettings } from '../src/services/settings.js';
import { normalizeName } from '@sms/shared';
import { expect } from 'vitest';

export const PW = 'Correct-Horse-9';

let local: MongoMemoryReplSet | null = null;

/** Replica set so transactions are exercised exactly as on Atlas. */
export async function startDb() {
  local = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDatabase(local.getUri(), env.MONGODB_DB_NAME);
  for (const n of mongoose.modelNames()) await mongoose.model(n).syncIndexes();
}

export async function stopDb() {
  await mongoose.disconnect();
  await local?.stop();
}

export async function resetDb() {
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) await c.deleteMany({});
  invalidateSettings();
}

export interface World {
  app: Express;
  sessionId: string; classroomId: string; otherClassroomId: string;
  principal: string; admin: string; teacher: string; otherTeacher: string;
  studentIds: string[];
}

/** Builds a school with two classrooms, one teacher assigned to each, three students in the first. */
export async function buildWorld(): Promise<World> {
  await createVersioned(SchoolSettings, { _id: 'school', installId: env.SCHOOL_INSTALL_ID, name: 'Test School', timeZone: 'Asia/Karachi', policy: { workingDays: [0, 1, 2, 3, 4, 5, 6], cutoffTime: null, allowBackdatedDays: 30 } });
  const session = await createVersioned(AcademicSession, { name: '2026-2027', startDate: '2026-04-01', endDate: '2027-03-31', isDefault: true });
  await SchoolSettings.updateOne({ _id: 'school' }, { defaultSessionId: session._id });
  const hash = await hashPassword(PW);
  const mk = (username: string, role: string) => createVersioned(User, { username, fullName: username.toUpperCase(), role, passwordHash: hash });
  const [principal, admin, teacher, otherTeacher] = await Promise.all([mk('principal', 'principal'), mk('admin1', 'admin'), mk('teacher1', 'teacher'), mk('teacher2', 'teacher')]);
  const cls = await createVersioned(SchoolClass, { name: 'Grade 5', order: 5 });
  const secA = await createVersioned(Section, { classId: cls._id, name: 'A' });
  const secB = await createVersioned(Section, { classId: cls._id, name: 'B' });
  const roomA = await createVersioned(Classroom, { classId: cls._id, sectionId: secA._id, sessionId: session._id, name: '5-A' });
  const roomB = await createVersioned(Classroom, { classId: cls._id, sectionId: secB._id, sessionId: session._id, name: '5-B' });
  await createVersioned(TeacherAssignment, { teacherId: teacher!._id, classroomId: roomA._id, startedAt: new Date() });
  await createVersioned(TeacherAssignment, { teacherId: otherTeacher!._id, classroomId: roomB._id, startedAt: new Date() });
  const studentIds: string[] = [];
  for (const [i, n] of ['Ali', 'Sara', 'Omar'].entries()) {
    const s = await createVersioned(Student, { admissionNumber: `A-${i}`, admissionNumberLower: `a-${i}`, fullName: n, nameNormalized: normalizeName(n), classroomId: roomA._id, classId: cls._id, sectionId: secA._id, sessionId: session._id, status: 'active' });
    studentIds.push(s._id);
  }
  invalidateSettings();
  return { app: createApp(), sessionId: session._id, classroomId: roomA._id, otherClassroomId: roomB._id, principal: principal!._id, admin: admin!._id, teacher: teacher!._id, otherTeacher: otherTeacher!._id, studentIds };
}

/** Logged-in supertest agent that automatically sends the CSRF header. */
export async function login(app: Express, username: string, password = PW) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  const csrf = r.body.data.csrfToken as string;
  const withCsrf = <T extends { set: (k: string, v: string) => T }>(t: T) => t.set('x-csrf-token', csrf);
  return {
    agent, csrf,
    get: (u: string) => agent.get(u),
    post: (u: string, body?: object, headers: Record<string, string> = {}) => { let t = withCsrf(agent.post(u)); for (const [k, v] of Object.entries(headers)) t = t.set(k, v); return t.send(body ?? {}); },
    patch: (u: string, body?: object) => withCsrf(agent.patch(u)).send(body ?? {}),
    put: (u: string, body?: object) => withCsrf(agent.put(u)).send(body ?? {}),
    del: (u: string, body?: object) => withCsrf(agent.delete(u)).send(body ?? {})
  };
}

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
export const uuid = () => crypto.randomUUID();

/**
 * Creates a guardian linked to Ali and Sara (two children, same parent account) but NOT Omar,
 * and a parent portal account for it. Returns the logged-in parent.
 */
export async function makeParent(world: World) {
  const p = await login(world.app, 'principal');
  const g = await p.post('/api/guardians', { fullName: 'Ayesha Khan', relation: 'Mother', phone: '03001234567' });
  expect(g.status).toBe(201);
  for (const sid of [world.studentIds[0], world.studentIds[1]]) {
    expect((await p.post(`/api/guardians/students/${sid}/link`, { guardianId: g.body.data._id })).status).toBe(201);
  }
  const acc = await p.post(`/api/guardians/${g.body.data._id}/portal-account`, { username: 'ayesha.parent' });
  expect(acc.status).toBe(201);
  expect(acc.body.data.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
  const agent = request.agent(world.app);
  const r = await agent.post('/api/auth/login').send({ username: 'ayesha.parent', password: acc.body.data.temporaryPassword, portal: 'parent' });
  expect(r.status).toBe(200);
  const parent = await login(world.app, 'ayesha.parent', acc.body.data.temporaryPassword);
  return { principal: p, parent, guardianId: g.body.data._id as string, password: acc.body.data.temporaryPassword as string };
}

