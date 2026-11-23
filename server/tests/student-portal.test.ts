import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

/** Student account for Ali (w.studentIds[0]); Sara (w.studentIds[1]) is in the same class. */
async function studentFor(idx = 0) {
  const principal = await login(w.app, 'principal');
  const acc = await principal.post(`/api/students/${w.studentIds[idx]}/portal-account`, { username: `student${idx}` });
  expect(acc.status).toBe(201);
  return { principal, student: await login(w.app, `student${idx}`, acc.body.data.temporaryPassword) };
}

describe('student portal: own records only', () => {
  it('dashboard, attendance, results, homework and fees show the student\'s own data', async () => {
    const { principal, student } = await studentFor(0);
    const t = await login(w.app, 'teacher1');
    const day = today();
    // Ali present, Sara absent.
    expect((await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: day, entries: w.studentIds.map((id, i) => ({ studentId: id, status: ['present', 'absent', 'late'][i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() })).status).toBe(201);
    const exam = (await principal.post('/api/exams', { name: 'Mid-term', startDate: day })).body.data;
    expect((await t.put(`/api/exams/${exam._id}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 100, entries: [{ studentId: w.studentIds[0], marksObtained: 85 }, { studentId: w.studentIds[1], marksObtained: 30 }] })).status).toBe(200);
    expect((await t.post('/api/homework', { classroomId: w.classroomId, subject: 'English', title: 'Essay', assignedDate: day, dueDate: day })).status).toBe(201);
    const own = (await principal.post('/api/fees/vouchers', { studentId: w.studentIds[0], title: 'Tuition', period: '2026-11', dueDate: day, items: [{ label: 'T', amountMinor: 1000 }] })).body.data;
    const other = (await principal.post('/api/fees/vouchers', { studentId: w.studentIds[1], title: 'Tuition', period: '2026-11', dueDate: day, items: [{ label: 'T', amountMinor: 2000 }] })).body.data;

    const att = (await student.get('/api/student/attendance')).body.data;
    expect(att.records).toHaveLength(1);
    expect(att.records[0].status).toBe('present');

    // Results stay hidden until the exam is published.
    expect((await student.get('/api/student/results')).body.data).toHaveLength(0);
    expect((await student.get(`/api/student/report-card/${exam._id}`)).status).toBe(404);
    expect((await principal.post(`/api/exams/${exam._id}/publish`, { published: true })).status).toBe(200);
    const res = (await student.get('/api/student/results')).body.data;
    expect(res[0].rows).toEqual([expect.objectContaining({ subject: 'Maths', marksObtained: 85 })]);
    const rc = await student.get(`/api/student/report-card/${exam._id}`);
    expect(rc.status).toBe(200);
    expect(rc.headers['content-type']).toContain('application/pdf');

    expect((await student.get('/api/student/homework')).body.data[0].title).toBe('Essay');

    const fees = (await student.get('/api/student/fees')).body.data;
    expect(fees.vouchers.map((v: { _id: string }) => v._id)).toEqual([own._id]);
    expect(fees.outstandingMinor).toBe(1000);
    expect((await student.get(`/api/student/vouchers/${own._id}/pdf`)).status).toBe(200);
    // Another student's voucher looks exactly like one that does not exist.
    expect((await student.get(`/api/student/vouchers/${other._id}/pdf`)).status).toBe(404);
    expect((await student.get(`/api/student/vouchers/${uuid()}/pdf`)).status).toBe(404);
    expect((await student.get(`/api/student/receipts/${uuid()}/pdf`)).status).toBe(404);

    const dash = (await student.get('/api/student/dashboard')).body.data;
    expect(dash.student.fullName).toBe('Ali');
    expect(dash.attendance.present).toBe(1);
    expect(dash.latestResult.percent).toBe(85);
    expect(dash.fees.outstandingMinor).toBe(1000);
    expect(dash.homework[0].title).toBe('Essay');
    expect(dash.student).not.toHaveProperty('idCardToken');

    const profile = (await student.get('/api/student/profile')).body.data;
    expect(profile.fullName).toBe('Ali');
    expect(profile).not.toHaveProperty('notes');
    expect(profile).not.toHaveProperty('idCardToken');
  });

  it('downloads the student\'s own ID card', async () => {
    const { student } = await studentFor(0);
    const r = await student.get('/api/student/id-card');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
  });

  it('students cannot pay online or reach parent and staff APIs', async () => {
    const { student } = await studentFor(0);
    for (const path of ['/api/parent/dashboard', '/api/parent/payments/availability', `/api/students/${w.studentIds[1]}`, '/api/fees/vouchers', '/api/exams', '/api/homework', '/api/id-cards/students/' + w.studentIds[0]]) {
      expect((await student.get(path)).status, path).toBe(403);
    }
    expect((await student.post(`/api/parent/vouchers/${uuid()}/checkout`, {})).status).toBe(403);
  });

  it('staff and parents cannot use the student portal API', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/student/dashboard')).status).toBe(403);
    expect((await p.get('/api/student/fees')).status).toBe(403);
  });
});
