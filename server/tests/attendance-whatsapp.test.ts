import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { Guardian, Student, StudentGuardian } from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('absent / late: free WhatsApp messages to parents', () => {
  it('lists absent and late students of the day with the parent\'s WhatsApp number', async () => {
    const [ali, sara, omar] = w.studentIds as [string, string, string];
    const g = await createVersioned(Guardian, { fullName: 'Ayesha Khan', relation: 'mother', phone: '0300 1234567' });
    await createVersioned(StudentGuardian, { studentId: sara, guardianId: g._id, isPrimary: true });
    await Student.updateOne({ _id: omar }, { primaryGuardianPhone: '03219876543' });
    const t = await login(w.app, 'teacher1');
    const day = today();
    // Ali present, Sara absent, Omar late.
    expect((await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: day, entries: [
      { studentId: ali, status: 'present' }, { studentId: sara, status: 'absent' }, { studentId: omar, status: 'late', arrivalTime: '08:25' }
    ], clientOpId: uuid() }, { 'Idempotency-Key': uuid() })).status).toBe(201);

    const p = await login(w.app, 'principal');
    const r = await p.get(`/api/attendance/alerts?date=${day}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.totals).toEqual({ absent: 1, late: 1, noPhone: 0 });
    const sRow = d.rows.find((x: { fullName: string }) => x.fullName === 'Sara');
    const oRow = d.rows.find((x: { fullName: string }) => x.fullName === 'Omar');
    expect(sRow).toEqual(expect.objectContaining({ status: 'absent', parentName: 'Ayesha Khan', whatsapp: '923001234567', lastSentAt: null }));
    expect(oRow).toEqual(expect.objectContaining({ status: 'late', arrivalTime: '08:25', whatsapp: '923219876543' }));
    expect(d.rows.some((x: { fullName: string }) => x.fullName === 'Ali')).toBe(false);
    expect((await p.get(`/api/attendance/alerts?date=${day}&status=late`)).body.data.rows.map((x: { fullName: string }) => x.fullName)).toEqual(['Omar']);

    // Recorded per date.
    expect((await p.post(`/api/attendance/alerts/${sara}/whatsapp`, { date: day, status: 'absent' })).status).toBe(200);
    expect((await p.get(`/api/attendance/alerts?date=${day}`)).body.data.rows.find((x: { fullName: string }) => x.fullName === 'Sara').lastSentAt).not.toBeNull();
    expect((await p.post(`/api/attendance/alerts/${uuid()}/whatsapp`, { date: day, status: 'absent' })).status).toBe(404);
  });

  it('the school can change the wording of the absent and late messages', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/attendance/alerts/templates', { late: '{student} came late at {time}' })).status).toBe(200);
    const d = (await p.get('/api/attendance/alerts')).body.data;
    expect(d.templates).toEqual({ absent: null, late: '{student} came late at {time}' });
  });

  it('teachers cannot use the school-wide list', async () => {
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/attendance/alerts')).status).toBe(403);
    expect((await t.patch('/api/attendance/alerts/templates', { late: 'x' })).status).toBe(403);
  });
});
