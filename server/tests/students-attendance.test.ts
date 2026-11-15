import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { AttendanceAudit, AttendanceRecord, AttendanceSheet, StudentHistory, SyncOperation } from '../src/models/index.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

const entries = (w: World, statuses = ['present', 'absent', 'late']) => w.studentIds.map((id, i) => ({ studentId: id, status: statuses[i] }));

describe('students', () => {
  it('creates, rejects duplicate admission number, flags likely duplicates', async () => {
    const p = await login(w.app, 'principal');
    const ok = await p.post('/api/students', { admissionNumber: 'N-1', fullName: 'New Kid', classroomId: w.classroomId, dateOfBirth: '2015-02-02' });
    expect(ok.status).toBe(201);
    expect((await p.post('/api/students', { admissionNumber: 'n-1', fullName: 'Other', classroomId: w.classroomId })).status).toBe(409);
    const likely = await p.post('/api/students', { admissionNumber: 'N-2', fullName: 'new  kid', classroomId: w.classroomId, dateOfBirth: '2015-02-02' });
    expect(likely.status).toBe(409);
    expect((await p.post('/api/students', { admissionNumber: 'N-2', fullName: 'new kid', classroomId: w.classroomId, dateOfBirth: '2015-02-02', confirmDuplicate: true })).status).toBe(201);
  });

  it('search, filter and pagination', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.get(`/api/students?q=sa&pageSize=1&page=1&classroomId=${w.classroomId}`);
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0].fullName).toBe('Sara');
  });

  it('transfer keeps history and attendance', async () => {
    const p = await login(w.app, 'principal');
    const t = await login(w.app, 'teacher1');
    await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    const r = await p.post(`/api/students/${w.studentIds[0]}/move`, { classroomId: w.otherClassroomId, reason: 'parent request', kind: 'transfer' });
    expect(r.status).toBe(200);
    expect(await StudentHistory.countDocuments({ studentId: w.studentIds[0], kind: 'transfer' })).toBe(1);
    expect(await AttendanceRecord.countDocuments({ studentId: w.studentIds[0] })).toBe(1);
  });

  it('every write produces a sync operation with version bump (hybrid)', async () => {
    const p = await login(w.app, 'principal');
    await p.patch(`/api/students/${w.studentIds[0]}`, { notes: 'x' });
    const op = await SyncOperation.findOne({ docId: w.studentIds[0], baseVersion: 1 }).lean();
    expect(op?.newVersion).toBe(2);
    expect(op?.status).toBe('pending');
  });

  it('optimistic concurrency: stale version is rejected, not overwritten', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/students/${w.studentIds[0]}`, { notes: 'a', version: 1 })).status).toBe(200);
    expect((await p.patch(`/api/students/${w.studentIds[0]}`, { notes: 'b', version: 1 })).status).toBe(409);
  });
});

describe('attendance', () => {
  it('teacher submits; counts saved; audit written', async () => {
    const t = await login(w.app, 'teacher1');
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(201);
    expect(r.body.data.sheet.counts).toMatchObject({ present: 1, absent: 1, late: 1, total: 3 });
    expect(await AttendanceAudit.countDocuments({ action: 'submitted' })).toBe(3);
  });

  it('idempotent retry returns the same sheet; no duplicates', async () => {
    const t = await login(w.app, 'teacher1');
    const body = { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() };
    const key = uuid();
    const a = await t.post('/api/attendance/submit', body, { 'Idempotency-Key': key });
    const b = await t.post('/api/attendance/submit', body, { 'Idempotency-Key': key });
    const c = await t.post('/api/attendance/submit', body, { 'Idempotency-Key': uuid() }); // lost-response retry with new key
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(c.body.data.replayed).toBe(true);
    expect(a.body.data.sheet._id).toBe(c.body.data.sheet._id);
    expect(await AttendanceSheet.countDocuments()).toBe(1);
    expect(await AttendanceRecord.countDocuments()).toBe(3);
  });

  it('second different submission for same class+date is rejected', async () => {
    const t = await login(w.app, 'teacher1');
    await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w, ['present', 'present', 'present']), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(409);
  });

  it('roster mismatch is reported, not silently accepted', async () => {
    const t = await login(w.app, 'teacher1');
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w).slice(0, 2), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ROSTER_CHANGED');
    expect(r.body.error.details.missing).toEqual([w.studentIds[2]]);
  });

  it('teacher cannot submit for unassigned classroom', async () => {
    const t = await login(w.app, 'teacher2');
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(403);
  });

  it('future dates are rejected', async () => {
    const t = await login(w.app, 'teacher1');
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: '2099-01-01', entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(422);
  });
});

describe('corrections', () => {
  async function submitted() {
    const t = await login(w.app, 'teacher1');
    await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: entries(w), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    const rec = await AttendanceRecord.findOne({ studentId: w.studentIds[1] }).lean();
    return { t, rec: rec! };
  }

  it('request -> approve: original preserved, corrected recorded, audit complete', async () => {
    const { t, rec } = await submitted();
    const req = await t.post('/api/attendance/corrections', { attendanceId: rec._id, studentId: rec.studentId, newStatus: 'present', reason: 'arrived after roll call' });
    expect(req.status).toBe(201);
    // pending request does not change the record
    expect((await AttendanceRecord.findById(rec._id).lean())!.status).toBe('absent');
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/attendance/corrections/${req.body.data._id}/review`, { decision: 'approved' })).status).toBe(200);
    const after = (await AttendanceRecord.findById(rec._id).lean())!;
    expect(after).toMatchObject({ status: 'present', originalStatus: 'absent', corrected: true });
    const trail = await AttendanceAudit.find({ recordId: rec._id }).sort({ at: 1 }).lean();
    expect(trail.map((a) => a.action)).toEqual(['submitted', 'correction_requested', 'correction_approved']);
    expect((await AttendanceSheet.findById(rec.sheetId).lean())!.counts).toMatchObject({ present: 2, absent: 0 });
  });

  it('teacher cannot review; double review rejected; rejection keeps record', async () => {
    const { t, rec } = await submitted();
    const id = (await t.post('/api/attendance/corrections', { attendanceId: rec._id, studentId: rec.studentId, newStatus: 'leave', reason: 'sick note' })).body.data._id;
    expect((await t.post(`/api/attendance/corrections/${id}/review`, { decision: 'approved' })).status).toBe(403);
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/attendance/corrections/${id}/review`, { decision: 'rejected', reviewNote: 'no note' })).status).toBe(200);
    expect((await p.post(`/api/attendance/corrections/${id}/review`, { decision: 'approved' })).status).toBe(409);
    expect((await AttendanceRecord.findById(rec._id).lean())!.status).toBe('absent');
  });
});
