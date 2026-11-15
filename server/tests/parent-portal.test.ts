import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildWorld, login, makeParent, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { Guardian, User } from '../src/models/index.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('parent accounts & authentication', () => {
  it('creates one account per guardian; usernames are unique; staff/parent sign-in pages are separate', async () => {
    const { principal, guardianId, password } = await makeParent(w);
    expect((await principal.post(`/api/guardians/${guardianId}/portal-account`, { username: 'another' })).status).toBe(409);
    const u = await User.findOne({ username: 'ayesha.parent' }).lean();
    expect(u?.role).toBe('parent');
    expect(u?.guardianId).toBe(guardianId);
    // Parent cannot sign in on the staff page, staff cannot sign in on the parent page (same generic error).
    expect((await request(w.app).post('/api/auth/login').send({ username: 'ayesha.parent', password, portal: 'staff' })).status).toBe(401);
    expect((await request(w.app).post('/api/auth/login').send({ username: 'principal', password: 'Correct-Horse-9', portal: 'parent' })).status).toBe(401);
    // Existing principal login (no portal field) is unchanged.
    expect((await request(w.app).post('/api/auth/login').send({ username: 'principal', password: 'Correct-Horse-9' })).status).toBe(200);
  });

  it('the Users API can neither create parents nor promote a parent to staff', async () => {
    const { principal } = await makeParent(w);
    expect((await principal.post('/api/users', { username: 'pp', fullName: 'P', role: 'parent', password: 'Abcdefgh12x' })).status).toBe(400);
    const u = await User.findOne({ username: 'ayesha.parent' }).lean();
    expect((await principal.patch(`/api/users/${u!._id}`, { role: 'admin' })).status).toBe(400);
    expect((await principal.patch(`/api/users/${u!._id}`, { extraPermissions: ['students.view'] })).status).toBe(400);
  });

  it('parent can change own password and log out; suspending the account revokes sessions', async () => {
    const { principal, parent, guardianId, password } = await makeParent(w);
    expect((await parent.post('/api/auth/change-password', { currentPassword: password, newPassword: 'NewParent-Pass1' })).status).toBe(200);
    expect((await principal.patch(`/api/guardians/${guardianId}/portal-account`, { status: 'suspended' })).status).toBe(200);
    expect((await parent.get('/api/parent/children')).status).toBe(401);
    expect((await request(w.app).post('/api/auth/login').send({ username: 'ayesha.parent', password: 'NewParent-Pass1', portal: 'parent' })).status).toBe(401);
  });
});

describe('parent data isolation (IDOR)', () => {
  it('sees all and only linked children', async () => {
    const { parent } = await makeParent(w);
    const r = await parent.get('/api/parent/children');
    expect(r.status).toBe(200);
    expect(r.body.data.map((s: { fullName: string }) => s.fullName).sort()).toEqual(['Ali', 'Sara']);
    // Only parent-safe fields leave the server.
    expect(r.body.data[0]).not.toHaveProperty('notes');
    expect(r.body.data[0]).not.toHaveProperty('primaryGuardianPhone');
    expect(r.body.data[0]).not.toHaveProperty('idCardToken');
  });

  it('every per-child endpoint answers 404 for an unlinked or unknown student', async () => {
    const { parent } = await makeParent(w);
    const omar = w.studentIds[2];
    for (const path of ['', '/attendance', '/results', '/homework', '/fees', '/feedback', `/report-card/${uuid()}`]) {
      expect((await parent.get(`/api/parent/children/${omar}${path}`)).status).toBe(404);
      expect((await parent.get(`/api/parent/children/${uuid()}${path}`)).status).toBe(404);
    }
    expect((await parent.get('/api/parent/children/not-a-uuid')).status).toBe(404);
  });

  it('parent sessions cannot reach any staff API', async () => {
    const { parent } = await makeParent(w);
    for (const path of ['/api/students', `/api/students/${w.studentIds[0]}`, '/api/users', '/api/guardians', '/api/fees/vouchers', '/api/analytics/summary?from=2026-01-01&to=2026-01-31', '/api/system/overview', '/api/settings', '/api/sms/jobs', '/api/exams', '/api/homework']) {
      expect((await parent.get(path)).status, path).toBe(403);
    }
    expect((await parent.post('/api/attendance/submit', {})).status).toBe(403);
  });

  it('staff cannot use the parent portal API', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/parent/children')).status).toBe(403);
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/parent/dashboard')).status).toBe(403);
    expect((await request(w.app).get('/api/parent/children')).status).toBe(401);
  });

  it('a deleted guardian record leaves the account with no children', async () => {
    const { parent, guardianId } = await makeParent(w);
    await Guardian.updateOne({ _id: guardianId }, { deletedAt: new Date() });
    expect((await parent.get('/api/parent/children')).body.data).toEqual([]);
  });
});

describe('parent dashboard shows real records', () => {
  it('attendance, published results, homework, feedback and announcements', async () => {
    const { principal, parent } = await makeParent(w);
    const t = await login(w.app, 'teacher1');
    const t2 = await login(w.app, 'teacher2');
    const day = today();
    // Attendance: Ali present, Sara absent, Omar late.
    expect((await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: day, entries: w.studentIds.map((id, i) => ({ studentId: id, status: ['present', 'absent', 'late'][i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() })).status).toBe(201);
    const att = await parent.get(`/api/parent/children/${w.studentIds[1]}/attendance`);
    expect(att.body.data.records).toHaveLength(1);
    expect(att.body.data.records[0].status).toBe('absent');
    expect(att.body.data.summary.absent).toBe(1);

    // Exam: results hidden until published.
    const exam = await principal.post('/api/exams', { name: 'Mid-term', startDate: day });
    expect(exam.status).toBe(201);
    const examId = exam.body.data._id;
    // teacher2 is not assigned to this classroom.
    expect((await t2.put(`/api/exams/${examId}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 100, entries: [{ studentId: w.studentIds[0], marksObtained: 10 }] })).status).toBe(403);
    expect((await t.put(`/api/exams/${examId}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 100, entries: [{ studentId: w.studentIds[0], marksObtained: 85 }, { studentId: w.studentIds[1], marksObtained: 30 }] })).status).toBe(200);
    // A student from another classroom cannot be smuggled into the sheet.
    expect((await t.put(`/api/exams/${examId}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 100, entries: [{ studentId: uuid(), marksObtained: 1 }] })).status).toBe(400);
    expect((await parent.get(`/api/parent/children/${w.studentIds[0]}/results`)).body.data).toEqual([]);
    expect((await parent.get(`/api/parent/children/${w.studentIds[0]}/report-card/${examId}`)).status).toBe(404);
    expect((await principal.post(`/api/exams/${examId}/publish`, { published: true })).status).toBe(200);
    const res = await parent.get(`/api/parent/children/${w.studentIds[0]}/results`);
    expect(res.body.data[0].summary).toMatchObject({ percent: 85, grade: 'A', passed: true });
    // Teacher can no longer change published marks.
    expect((await t.put(`/api/exams/${examId}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 100, entries: [{ studentId: w.studentIds[0], marksObtained: 100 }] })).status).toBe(403);
    const pdf = await parent.get(`/api/parent/children/${w.studentIds[0]}/report-card/${examId}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');

    // Homework: own classroom only.
    expect((await t2.post('/api/homework', { classroomId: w.classroomId, subject: 'English', title: 'Essay', assignedDate: day, dueDate: day })).status).toBe(403);
    expect((await t.post('/api/homework', { classroomId: w.classroomId, subject: 'English', title: 'Essay', assignedDate: day, dueDate: day })).status).toBe(201);
    expect((await parent.get(`/api/parent/children/${w.studentIds[0]}/homework`)).body.data[0].title).toBe('Essay');

    // Feedback: private notes never reach parents.
    expect((await t.post('/api/feedback', { studentId: w.studentIds[0], body: 'Great progress', visibleToParents: true })).status).toBe(201);
    expect((await t.post('/api/feedback', { studentId: w.studentIds[0], body: 'Staff-only note', visibleToParents: false })).status).toBe(201);
    expect((await t2.post('/api/feedback', { studentId: w.studentIds[0], body: 'x' })).status).toBe(403);
    const fb = await parent.get(`/api/parent/children/${w.studentIds[0]}/feedback`);
    expect(fb.body.data.map((f: { body: string }) => f.body)).toEqual(['Great progress']);

    // Announcement published by the school appears on the dashboard.
    expect((await principal.post('/api/settings/announcements', { title: 'Sports day', body: 'Friday', publishedAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(201);
    const dash = await parent.get('/api/parent/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.data.children).toHaveLength(2);
    const ali = dash.body.data.children.find((c: { fullName: string }) => c.fullName === 'Ali');
    expect(ali.attendance.present).toBe(1);
    expect(ali.latestResult).toMatchObject({ name: 'Mid-term', percent: 85 });
    expect(ali.homework[0].title).toBe('Essay');
    expect(dash.body.data.announcements[0].title).toBe('Sports day');
  });
});
