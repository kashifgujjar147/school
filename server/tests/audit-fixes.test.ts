/**
 * Regression tests for defects found in the full-stack functionality audit (2026-11-12).
 * Each test drives the real API against an in-memory MongoDB and reads the data back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { AttendanceRecord, Classroom, Guardian, NotificationJob, SchoolClass, Section, Student, StudentHistory, User } from '../src/models/index.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('SMS queue phone search', () => {
  it('a short or non-numeric query narrows the list instead of returning every job', async () => {
    await NotificationJob.create({ dedupeKey: 'k1', event: 'absent', to: '+923001112233', body: 'x', date: '2026-05-04', status: 'pending', version: 1 });
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/sms/jobs?q=999')).body.meta.total).toBe(0);
    expect((await p.get('/api/sms/jobs?q=233')).body.meta.total).toBe(1);
    expect((await p.get('/api/sms/jobs?q=abc')).body.meta.total).toBe(0);
    expect((await p.get('/api/sms/jobs')).body.meta.total).toBe(1);
  });
});

describe('student edit after creation with blank optional fields', () => {
  it('a student stored with null optional fields can be renamed and the change persists', async () => {
    const p = await login(w.app, 'principal');
    const created = await p.post('/api/students', { admissionNumber: 'N-1', fullName: 'Zainab', classroomId: w.classroomId, emergencyContactName: null, address: null, notes: null, dateOfBirth: null });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;
    const before = (await p.get(`/api/students/${id}`)).body.data;
    // Same payload shape the edit form sends: blank strings become null.
    const r = await p.patch(`/api/students/${id}`, { admissionNumber: 'N-1', fullName: 'Zainab Ali', emergencyContactName: null, emergencyContactPhone: null, address: null, notes: null, dateOfBirth: null, admissionDate: null, gender: 'unspecified', version: before.version });
    expect(r.status).toBe(200);
    expect((await Student.findById(id).lean())!.fullName).toBe('Zainab Ali');
  });
});

describe('bulk promotion', () => {
  it('refuses to "promote" a class into itself and writes no history', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.post('/api/students/bulk-promote', { fromClassroomId: w.classroomId, toClassroomId: w.classroomId, studentIds: w.studentIds, reason: 'oops' });
    expect(r.status).toBe(400);
    expect(await StudentHistory.countDocuments({ kind: 'promotion' })).toBe(0);
  });
});

describe('classrooms cannot be created on archived classes or sections', () => {
  it('rejects an archived section, accepts after restore', async () => {
    const p = await login(w.app, 'principal');
    const cls = await SchoolClass.findOne().lean();
    const sec = (await p.post('/api/academic/sections', { classId: cls!._id, name: 'Z' })).body.data;
    expect((await p.patch(`/api/academic/sections/${sec._id}`, { archived: true })).status).toBe(200);
    const body = { classId: cls!._id, sectionId: sec._id, sessionId: w.sessionId, name: '5-Z' };
    expect((await p.post('/api/academic/classrooms', body)).status).toBe(400);
    expect(await Classroom.countDocuments({ sectionId: sec._id })).toBe(0);
    expect((await p.patch(`/api/academic/sections/${sec._id}`, { archived: false })).status).toBe(200);
    expect((await p.post('/api/academic/classrooms', body)).status).toBe(201);
  });
  it('rejects an archived class', async () => {
    const p = await login(w.app, 'principal');
    const cls = await SchoolClass.findOne().lean();
    const sec = await Section.findOne({ classId: cls!._id, name: 'A' }).lean();
    await Classroom.deleteMany({ sectionId: sec!._id });
    expect((await p.patch(`/api/academic/classes/${cls!._id}`, { archived: true })).status).toBe(200);
    expect((await p.post('/api/academic/classrooms', { classId: cls!._id, sectionId: sec!._id, sessionId: w.sessionId, name: 'x' })).status).toBe(400);
  });
});

describe('user unlock / revoke sessions', () => {
  it('404 for unknown users instead of a fake success', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/users/${uuid()}/unlock`)).status).toBe(404);
    expect((await p.post(`/api/users/${uuid()}/revoke-sessions`)).status).toBe(404);
  });
  it('an administrator cannot unlock or sign out a principal; a principal can', async () => {
    await User.updateOne({ _id: w.principal }, { lockedUntil: new Date(Date.now() + 3600_000) });
    const a = await login(w.app, 'admin1');
    expect((await a.post(`/api/users/${w.principal}/unlock`)).status).toBe(403);
    expect((await a.post(`/api/users/${w.principal}/revoke-sessions`)).status).toBe(403);
    expect((await User.findById(w.principal).lean())!.lockedUntil).toBeTruthy();
    // Admin can still unlock a teacher.
    await User.updateOne({ _id: w.teacher }, { lockedUntil: new Date(Date.now() + 3600_000) });
    expect((await a.post(`/api/users/${w.teacher}/unlock`)).status).toBe(200);
    expect((await User.findById(w.teacher).lean())!.lockedUntil).toBeNull();
  });
  it('profile fields (name, email, phone) can be edited and persist', async () => {
    const p = await login(w.app, 'principal');
    const u = (await p.get(`/api/users/${w.teacher}`)).body.data;
    const r = await p.patch(`/api/users/${w.teacher}`, { fullName: 'Ayesha Khan', email: 'ayesha@example.org', phone: '0300 1234567', version: u.version });
    expect(r.status).toBe(200);
    const after = await User.findById(w.teacher).lean();
    expect(after!.fullName).toBe('Ayesha Khan');
    expect(after!.email).toBe('ayesha@example.org');
  });
});

describe('guardians', () => {
  async function makeGuardian(p: Awaited<ReturnType<typeof login>>, phone: string, altPhone?: string) {
    const r = await p.post('/api/guardians', { fullName: 'G ' + phone, relation: 'Father', phone, altPhone });
    expect(r.status).toBe(201);
    return r.body.data._id as string;
  }

  it('changing only the phone keeps the stored alternate phone; altPhone alone is normalised', async () => {
    const p = await login(w.app, 'principal');
    const id = await makeGuardian(p, '0300 1111111', '0300 2222222');
    expect((await p.patch(`/api/guardians/${id}`, { phone: '0300 3333333' })).status).toBe(200);
    let g = await Guardian.findById(id).lean();
    expect(g!.phone).toBe('+923003333333');
    expect(g!.altPhone).toBe('+923002222222');
    expect((await p.patch(`/api/guardians/${id}`, { altPhone: '0300 4444444' })).status).toBe(200);
    g = await Guardian.findById(id).lean();
    expect(g!.altPhone).toBe('+923004444444');
    expect((await p.patch(`/api/guardians/${id}`, { altPhone: 'nope' })).status).toBe(400);
    expect((await p.patch(`/api/guardians/${id}`, { altPhone: '' })).status).toBe(200);
    expect((await Guardian.findById(id).lean())!.altPhone).toBeNull();
  });

  it('unlinking the primary guardian promotes the remaining one and keeps the alert phone', async () => {
    const p = await login(w.app, 'principal');
    const s = w.studentIds[0]!;
    const g1 = await makeGuardian(p, '0300 5555555');
    const g2 = await makeGuardian(p, '0300 6666666');
    const l1 = (await p.post(`/api/guardians/students/${s}/link`, { guardianId: g1 })).body.data;
    expect((await p.post(`/api/guardians/students/${s}/link`, { guardianId: g2 })).status).toBe(201);
    expect(l1.isPrimary).toBe(true);
    expect((await p.del(`/api/guardians/links/${l1._id}`)).status).toBe(200);
    const profile = (await p.get(`/api/students/${s}`)).body.data;
    expect(profile.guardians).toHaveLength(1);
    expect(profile.guardians[0].link.isPrimary).toBe(true);
    expect((await Student.findById(s).lean())!.primaryGuardianPhone).toBe('+923006666666');
  });
});

describe('reports', () => {
  it('submissions report does not flag archived classrooms as missing', async () => {
    const p = await login(w.app, 'principal');
    await Student.updateMany({ classroomId: w.otherClassroomId }, { status: 'archived' });
    expect((await p.patch(`/api/academic/classrooms/${w.otherClassroomId}`, { archived: true })).status).toBe(200);
    const r = await p.get(`/api/reports/submissions?from=${today()}&to=${today()}`);
    expect(r.status).toBe(200);
    const names = r.body.data.rows.map((x: { classroom: string }) => x.classroom);
    expect(names).toContain('5-A');
    expect(names).not.toContain('5-B');
  });

  it('percentage report lists active students, plus inactive ones only when they have records', async () => {
    const p = await login(w.app, 'principal');
    const [a, b] = w.studentIds;
    await Student.updateOne({ _id: b }, { status: 'archived' });
    const all = (await p.get(`/api/reports/percentage?from=${today()}&to=${today()}`)).body.data.rows.map((x: { student: string }) => x.student);
    const archivedName = (await Student.findById(b).lean())!.fullName;
    expect(all).not.toContain(archivedName);
    // With a record in range the archived student does appear.
    await AttendanceRecord.create({ _id: uuid(), sheetId: uuid(), classroomId: w.classroomId, studentId: b, date: today(), status: 'present', originalStatus: 'present', markedBy: w.teacher, version: 1 });
    const withRec = (await p.get(`/api/reports/percentage?from=${today()}&to=${today()}`)).body.data.rows.map((x: { student: string }) => x.student);
    expect(withRec).toContain(archivedName);
    expect(withRec).toContain((await Student.findById(a).lean())!.fullName);
  });
});
