import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, type World } from './helpers.js';
import { NotificationJob, SchoolSettings, Student, User } from '../src/models/index.js';
import { LATEST_SCHEMA, runMigrations } from '../src/scripts/migrations.js';
import { processSmsQueue } from '../src/services/notifications.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('v1.2 upgrade on an existing v1.0 database', () => {
  it('migration 3 only adds indexes: every record survives, old documents keep working', async () => {
    const db = mongoose.connection.db!;
    // Simulate a v1.0 install: settings without the new sub-documents, a job without a channel.
    await db.collection('schoolsettings').updateOne({ _id: 'school' as never }, { $set: { schemaVersion: 2 }, $unset: { fees: '', 'smsAutomation.channels': '' } });
    await db.collection('notificationjobs').insertOne({ _id: 'legacy-job' as never, dedupeKey: 'x', event: 'absent', to: '+923001234567', body: 'hi', status: 'pending', attempts: 0, attemptLog: [], nextAttemptAt: new Date(), lockedUntil: null, version: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
    const before = await Promise.all(['students', 'users', 'classrooms', 'teacherassignments'].map((c) => db.collection(c).countDocuments()));
    invalidateSettings();

    // From v1.0 (schema 2): migration 3 (v1.2) and migration 4 (v1.3 timetable) both run.
    expect(await runMigrations()).toBe(2);
    expect(LATEST_SCHEMA).toBe(4);
    expect((await SchoolSettings.findById('school').lean())!.schemaVersion).toBe(4);
    const after = await Promise.all(['students', 'users', 'classrooms', 'teacherassignments'].map((c) => db.collection(c).countDocuments()));
    expect(after).toEqual(before);
    // Running again does nothing (idempotent).
    expect(await runMigrations()).toBe(0);

    // Existing principal login and APIs still work.
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/students')).body.meta.total).toBe(3);
    expect((await p.get('/api/system/overview')).status).toBe(200);
    // Defaults apply to settings saved before v1.2.
    const s = await p.get('/api/settings');
    expect(s.body.data.smsAutomation.channels ?? ['sms']).toEqual(['sms']);
    // The legacy job (no channel field) is treated as SMS and blocked honestly (no provider).
    await SchoolSettings.updateOne({ _id: 'school' }, { 'smsAutomation.enabled': true });
    invalidateSettings();
    await processSmsQueue(5);
    expect((await NotificationJob.findById('legacy-job').lean())!.status).toBe('blocked_config');
    expect((await p.get('/api/sms/jobs?channel=sms')).body.meta.total).toBe(1);
    // New optional fields are absent on old documents and nothing breaks.
    expect((await Student.findById(w.studentIds[0]).lean())!.idCardToken ?? null).toBeNull();
    expect((await User.findOne({ username: 'principal' }).lean())!.guardianId ?? null).toBeNull();
  });
});
