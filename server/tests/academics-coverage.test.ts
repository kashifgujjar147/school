import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, makeParent, resetDb, startDb, stopDb, today, type World } from './helpers.js';
import { SchoolSettings } from '../src/models/index.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('exams: class summary and staff report cards', () => {
  it('computes totals/grades and restricts report cards to the classroom', async () => {
    const p = await login(w.app, 'principal');
    const t = await login(w.app, 'teacher1');
    const t2 = await login(w.app, 'teacher2');
    const exam = (await p.post('/api/exams', { name: 'Final', startDate: today() })).body.data;
    await t.put(`/api/exams/${exam._id}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 50, entries: [{ studentId: w.studentIds[0], marksObtained: 40 }, { studentId: w.studentIds[1], marksObtained: null, absent: true }] });
    await t.put(`/api/exams/${exam._id}/results`, { classroomId: w.classroomId, subject: 'English', maxMarks: 50, entries: [{ studentId: w.studentIds[0], marksObtained: 30 }, { studentId: w.studentIds[1], marksObtained: 45 }] });
    // Re-saving the same subject updates rather than duplicating.
    await t.put(`/api/exams/${exam._id}/results`, { classroomId: w.classroomId, subject: 'maths', maxMarks: 50, entries: [{ studentId: w.studentIds[0], marksObtained: 45 }] });
    const sum = await t.get(`/api/exams/${exam._id}/summary?classroomId=${w.classroomId}`);
    expect(sum.status).toBe(200);
    const ali = sum.body.data.perStudent.find((r: { student: { fullName: string } }) => r.student.fullName === 'Ali');
    expect(ali).toMatchObject({ obtained: 75, max: 100, percent: 75, grade: 'B', passed: true });
    const sara = sum.body.data.perStudent.find((r: { student: { fullName: string } }) => r.student.fullName === 'Sara');
    expect(sara).toMatchObject({ obtained: 45, percent: 45, passed: false });
    expect(sum.body.data.subjects.map((s: { subject: string }) => s.subject).sort()).toEqual(['English', 'Maths']);
    expect((await t2.get(`/api/exams/${exam._id}/summary?classroomId=${w.classroomId}`)).status).toBe(403);
    const pdf = await t.get(`/api/exams/${exam._id}/report-card/${w.studentIds[0]}`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await t2.get(`/api/exams/${exam._id}/report-card/${w.studentIds[0]}`)).status).toBe(403);
    // An exam with results cannot be deleted; teachers cannot create or publish exams.
    expect((await p.del(`/api/exams/${exam._id}`)).status).toBe(409);
    expect((await t.post('/api/exams', { name: 'x', startDate: today() })).status).toBe(403);
    expect((await t.post(`/api/exams/${exam._id}/publish`, { published: true })).status).toBe(403);
  });
});

describe('homework & feedback editing rights', () => {
  it('only the classroom teacher edits; only the author or an admin deletes', async () => {
    const p = await login(w.app, 'principal');
    const t = await login(w.app, 'teacher1');
    const t2 = await login(w.app, 'teacher2');
    const hw = (await t.post('/api/homework', { classroomId: w.classroomId, subject: 'Science', title: 'Plants', assignedDate: today(), dueDate: today() })).body.data.homework;
    expect((await t.patch(`/api/homework/${hw._id}`, { title: 'Plants & seeds' })).status).toBe(200);
    expect((await t.patch(`/api/homework/${hw._id}`, { assignedDate: '2099-01-01' })).status).toBe(400); // after due date
    expect((await t2.patch(`/api/homework/${hw._id}`, { title: 'x' })).status).toBe(403);
    expect((await t2.del(`/api/homework/${hw._id}`)).status).toBe(403);
    expect((await p.del(`/api/homework/${hw._id}`)).status).toBe(200);
    expect((await t.get(`/api/homework?classroomId=${w.classroomId}`)).body.data).toHaveLength(0);

    const fb = (await t.post('/api/feedback', { studentId: w.studentIds[0], body: 'Note' })).body.data;
    expect((await t2.del(`/api/feedback/${fb._id}`)).status).toBe(403);
    expect((await t.del(`/api/feedback/${fb._id}`)).status).toBe(200);
  });
});

describe('parent documents & notification history', () => {
  it('parent downloads own vouchers only and sees their message history', async () => {
    const { principal, parent } = await makeParent(w);
    const own = (await principal.post('/api/fees/vouchers', { studentId: w.studentIds[0], title: 'Tuition', period: '2026-11', dueDate: today(), items: [{ label: 'T', amountMinor: 1000 }] })).body.data;
    const other = (await principal.post('/api/fees/vouchers', { studentId: w.studentIds[2], title: 'Tuition', period: '2026-11', dueDate: today(), items: [{ label: 'T', amountMinor: 1000 }] })).body.data;
    const pdf = await parent.get(`/api/parent/vouchers/${own._id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await parent.get(`/api/parent/vouchers/${other._id}/pdf`)).status).toBe(404);

    await SchoolSettings.updateOne({ _id: 'school' }, { smsAutomation: { enabled: true, events: ['announcement'], sendAfterSubmission: true, channels: ['sms'] } });
    invalidateSettings();
    expect((await principal.post('/api/sms/broadcast', { title: 'Exam week', body: 'Starts Monday', classroomIds: [w.classroomId] })).body.data.queued).toBe(2);
    const notes = await parent.get('/api/parent/notifications');
    expect(notes.status).toBe(200);
    expect(notes.body.data).toHaveLength(2);
    expect(notes.body.data[0]).toMatchObject({ event: 'announcement', status: 'pending' });
    expect(notes.body.data[0]).not.toHaveProperty('to'); // recipient phone is not echoed back
  });

  it('WhatsApp test send reports the real configuration problem instead of pretending', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.post('/api/sms/whatsapp/test', { to: '03001234567' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ accepted: false });
    expect(r.body.data.error).toContain('not enabled');
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/sms/whatsapp/test', { to: '03001234567' })).status).toBe(403);
  });
});
