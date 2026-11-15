import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { env } from '../src/config/env.js';
import { Guardian, NotificationJob, SchoolSettings, StudentGuardian, SyncConflict, SyncOperation, Student } from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';
import { invalidateSettings } from '../src/services/settings.js';
import { enqueueAttendanceAlerts, processSmsQueue } from '../src/services/notifications.js';
import { SyncEngine } from '../src/sync/engine.js';

let w: World;
let atlas: MongoMemoryReplSet;
beforeAll(async () => { await startDb(); atlas = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); });
// Tests here change env (SMS provider, Atlas URI). All server test files share one module graph,
// so restore it after every test even when an assertion fails midway.
const envSnapshot = { ...env };
afterEach(() => { Object.assign(env, envSnapshot); });
afterAll(async () => { await atlas.stop(); await stopDb(); });
beforeEach(async () => {
  await resetDb(); w = await buildWorld();
  const g = await createVersioned(Guardian, { fullName: 'Parent of Sara', relation: 'Mother', phone: '+923001112233', smsOptIn: true, language: 'en' });
  await createVersioned(StudentGuardian, { studentId: w.studentIds[1], guardianId: g._id, isPrimary: true, receivesAlerts: true });
  await SchoolSettings.updateOne({ _id: 'school' }, { smsAutomation: { enabled: true, events: ['absent', 'late'], sendAfterSubmission: true } });
  invalidateSettings();
});

async function submit(statuses = ['present', 'absent', 'late']) {
  const t = await login(w.app, 'teacher1');
  return t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: w.studentIds.map((id, i) => ({ studentId: id, status: statuses[i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
}

describe('SMS queue', () => {
  it('queues one job per absent student guardian; re-enqueue does not duplicate', async () => {
    const r = await submit();
    expect(r.body.data.alerts.queued).toBe(1);
    const again = await enqueueAttendanceAlerts(r.body.data.sheet._id, 'x');
    expect(again.queued).toBe(0);
    expect(await NotificationJob.countDocuments()).toBe(1);
  });

  it('without provider configuration jobs are blocked_config — never "sent"', async () => {
    await submit();
    await processSmsQueue();
    const j = (await NotificationJob.findOne().lean())!;
    expect(j.status).toBe('blocked_config');
    expect(j.sentAt).toBeFalsy();
  });

  it('offline: job stays pending and no attempt is consumed; then sends when online', async () => {
    Object.assign(env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 't'.repeat(32), TWILIO_FROM: '+15550000000' });
    await submit();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    let stats = await processSmsQueue();
    expect(stats.offline).toBe(true);
    let j = (await NotificationJob.findOne().lean())!;
    expect(j.status).toBe('pending');
    expect(j.attempts).toBe(0);
    await NotificationJob.updateOne({ _id: j._id }, { nextAttemptAt: new Date(0) });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SM123', status: 'queued' }), { status: 201 }));
    stats = await processSmsQueue();
    j = (await NotificationJob.findOne().lean())!;
    expect(j.status).toBe('sent'); // accepted, NOT delivered
    expect(j.deliveredAt).toBeFalsy();
    expect(j.providerMessageId).toBe('SM123');
    fetchMock.mockRestore();
    Object.assign(env, { SMS_PROVIDER: 'none' });
  });

  it('starter package never queues SMS', async () => {
    (env as { PACKAGE: string }).PACKAGE = 'starter';
    try { const r = await submit(); expect(r.body.data.alerts.queued).toBe(0); } finally { (env as { PACKAGE: string }).PACKAGE = 'standard'; }
  });
});

describe('hybrid sync engine (local ↔ Atlas)', () => {
  let engine: SyncEngine;
  beforeEach(async () => {
    Object.assign(env, { ATLAS_SYNC_URI: atlas.getUri() });
    const c = await mongoose.createConnection(atlas.getUri(), { dbName: env.ATLAS_SYNC_DB_NAME }).asPromise();
    await c.db!.dropDatabase();
    await c.close();
    engine = new SyncEngine();
  });

  const remote = async () => mongoose.createConnection(atlas.getUri(), { dbName: env.ATLAS_SYNC_DB_NAME }).asPromise();

  it('pushes all pending ops; second run is idempotent', async () => {
    await submit(['present', 'present', 'present']);
    const pending = await SyncOperation.countDocuments({ status: 'pending' });
    expect(pending).toBeGreaterThan(5);
    const st = await engine.runOnce();
    expect(st.state).toBe('online');
    expect(await SyncOperation.countDocuments({ status: 'pending' })).toBe(0);
    const c = await remote();
    expect(await c.db!.collection('attendancerecords').countDocuments()).toBe(3);
    expect(await c.db!.collection('students').countDocuments()).toBe(3);
    // Simulate a lost acknowledgement: mark ops pending again and re-run — no duplicates.
    await SyncOperation.updateMany({}, { status: 'pending' });
    await engine.runOnce();
    expect(await c.db!.collection('attendancerecords').countDocuments()).toBe(3);
    await c.close();
    await engine.stop();
  });

  it('detects conflicts instead of overwriting newer Atlas data', async () => {
    await engine.runOnce();
    const c = await remote();
    // Someone edits the student in the cloud (version 1 -> 2).
    await c.db!.collection('students').updateOne({ _id: w.studentIds[0] as never }, { $set: { notes: 'cloud edit', version: 2 } });
    // Meanwhile locally (offline) the same student is edited (base version 1).
    const p = await login(w.app, 'principal');
    await p.patch(`/api/students/${w.studentIds[0]}`, { notes: 'local edit' });
    const st = await engine.runOnce();
    expect(st.conflicts).toBe(1);
    expect((await c.db!.collection('students').findOne({ _id: w.studentIds[0] as never }))!.notes).toBe('cloud edit');
    const conflict = (await SyncConflict.findOne({ status: 'open' }).lean())!;
    expect((conflict.localVersion as { notes: string }).notes).toBe('local edit');
    expect((conflict.remoteVersion as { notes: string }).notes).toBe('cloud edit');
    // Authorised resolution: keep local. Both sides converge with a higher version.
    await engine.resolve(conflict._id, 'keep_local', w.principal);
    const remoteDoc = (await c.db!.collection('students').findOne({ _id: w.studentIds[0] as never }))!;
    const localDoc = (await Student.findById(w.studentIds[0]).lean())!;
    expect(remoteDoc.notes).toBe('local edit');
    expect(remoteDoc.version).toBe(localDoc.version);
    await c.close();
    await engine.stop();
  });

  it('pulls changes made by other nodes', async () => {
    await engine.runOnce();
    const c = await remote();
    const doc = await c.db!.collection('students').findOne({ _id: w.studentIds[2] as never });
    const snapshot = { ...doc, fullName: 'Omar (renamed in cloud)', version: 2 };
    await c.db!.collection('students').replaceOne({ _id: w.studentIds[2] as never }, snapshot);
    await c.db!.collection('syncoperations').insertOne({ _id: uuid() as never, collectionName: 'students', docId: w.studentIds[2], kind: 'upsert', baseVersion: 1, newVersion: 2, snapshot, nodeId: 'cloud-node', status: 'synced', createdAt: new Date() });
    const st = await engine.runOnce();
    expect(st.lastPulled).toBe(1);
    expect((await Student.findById(w.studentIds[2]).lean())!.fullName).toBe('Omar (renamed in cloud)');
    await c.close();
    await engine.stop();
  });

  it('offline: reports offline, never success; data stays pending', async () => {
    Object.assign(env, { ATLAS_SYNC_URI: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500' });
    const st = await engine.runOnce();
    expect(st.state).toBe('offline');
    expect(st.lastSuccessAt).toBeNull();
    expect(await SyncOperation.countDocuments({ status: 'pending' })).toBeGreaterThan(0);
    await engine.stop();
  });

  it('refuses to sync into another school\'s Atlas database', async () => {
    const c = await remote();
    await c.db!.collection('schoolsettings').insertOne({ _id: 'school' as never, installId: 'some-other-school' });
    const st = await engine.runOnce();
    expect(st.state).toBe('error');
    expect(st.lastError).toMatch(/some-other-school/);
    await c.close();
    await engine.stop();
  });
});
