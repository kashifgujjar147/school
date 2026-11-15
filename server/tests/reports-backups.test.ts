import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, PW, type World } from './helpers.js';
import { copyFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { BackupRecord, Student } from '../src/models/index.js';
import { backupDir, registerBackupFile, restoreBackup } from '../src/services/backup.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

async function seedAttendance() {
  const t = await login(w.app, 'teacher1');
  await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: w.studentIds.map((id, i) => ({ studentId: id, status: ['present', 'absent', 'late'][i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
}

describe('reports', () => {
  it('summary uses real records', async () => {
    await seedAttendance();
    const p = await login(w.app, 'principal');
    const r = await p.get(`/api/reports/summary?from=${today()}&to=${today()}`);
    const row = r.body.data.rows.find((x: { classroom: string }) => x.classroom === '5-A');
    expect(row).toMatchObject({ present: 1, absent: 1, late: 1, percent: '66.7%' });
  });

  it('exports csv, xlsx and pdf', async () => {
    await seedAttendance();
    const p = await login(w.app, 'principal');
    const csv = await p.get(`/api/reports/absentees?from=${today()}&to=${today()}&format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Sara');
    const xlsx = await p.get(`/api/reports/register?from=${today()}&to=${today()}&format=xlsx`).buffer(true);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    const pdf = await p.get(`/api/reports/percentage?from=${today()}&to=${today()}&format=pdf`).buffer(true);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('teacher reports are scoped to own classrooms', async () => {
    await seedAttendance();
    const t2 = await login(w.app, 'teacher2');
    const r = await t2.get(`/api/reports/register?from=${today()}&to=${today()}`);
    expect(r.body.data.rows).toHaveLength(0);
    expect((await t2.get(`/api/reports/submissions?from=${today()}&to=${today()}`)).status).toBe(403);
  });

  it('submission report flags missing attendance', async () => {
    await seedAttendance();
    const p = await login(w.app, 'principal');
    const r = await p.get(`/api/reports/submissions?from=${today()}&to=${today()}`);
    const statuses = Object.fromEntries(r.body.data.rows.map((x: { classroom: string; status: string }) => [x.classroom, x.status]));
    expect(statuses).toEqual({ '5-A': 'Submitted', '5-B': 'MISSING' });
  });
});

describe('backups', () => {
  it('creates a verified backup and restores it (principal + password + phrase)', async () => {
    const p = await login(w.app, 'principal');
    const b = await p.post('/api/backups');
    expect(b.status).toBe(201);
    expect(b.body.data.status).toBe('verified');
    await Student.deleteMany({});
    expect((await p.post('/api/backups/restore', { backupId: b.body.data._id, confirmPhrase: 'RESTORE', password: 'wrong' })).status).toBe(400);
    const r = await p.post('/api/backups/restore', { backupId: b.body.data._id, confirmPhrase: 'RESTORE', password: PW });
    expect(r.status).toBe(200);
    expect(await Student.countDocuments()).toBe(3);
    expect(await BackupRecord.countDocuments({ kind: 'pre_restore' })).toBe(1);
  });

  it('restores from a backup file onto an empty database (replacement computer)', async () => {
    const p = await login(w.app, 'principal');
    const b = (await p.post('/api/backups')).body.data;
    const file = `${backupDir}/${b.fileName}`;
    const copy = `${backupDir}/../copy-${b.fileName}`;
    await copyFile(file, copy);
    for (const c of await mongoose.connection.db!.collections()) await c.deleteMany({});
    const rec = await registerBackupFile(copy);
    expect(rec?.status).toBe('verified');
    await restoreBackup(rec!._id);
    expect(await Student.countDocuments()).toBe(3);
  });
});
