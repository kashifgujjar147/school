import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, type World } from './helpers.js';
import { SchoolSettings, User } from '../src/models/index.js';
import { LATEST_SCHEMA, runMigrations } from '../src/scripts/migrations.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('v1.3 upgrade (timetable) on an existing v1.2 database', () => {
  it('migration 4 only adds indexes: no record is changed or removed, existing logins keep working', async () => {
    const db = mongoose.connection.db!;
    await db.collection('schoolsettings').updateOne({ _id: 'school' as never }, { $set: { schemaVersion: 3 } });
    invalidateSettings();
    const collections = ['students', 'users', 'classrooms', 'sections', 'classes', 'academicsessions', 'teacherassignments', 'schoolsettings'];
    const snapshot = async () => Promise.all(collections.map((c) => db.collection(c).find({}).sort({ _id: 1 }).toArray()));
    const before = await snapshot();

    expect(await runMigrations()).toBe(1);
    expect(LATEST_SCHEMA).toBe(4);
    const after = await snapshot();
    // Every existing document is byte-for-byte the same except the schema marker on settings.
    for (let i = 0; i < collections.length; i++) {
      if (collections[i] === 'schoolsettings') continue;
      expect(after[i], collections[i]).toEqual(before[i]);
    }
    expect((await SchoolSettings.findById('school').lean())!.schemaVersion).toBe(4);
    expect(await runMigrations()).toBe(0);

    // Existing accounts have no studentId and work exactly as before.
    expect((await User.findOne({ username: 'teacher1' }).lean())!.studentId ?? null).toBeNull();
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/students')).body.meta.total).toBe(3);
    // The new feature is usable straight away on the upgraded database.
    expect((await p.post('/api/timetable/subjects', { name: 'Mathematics' })).status).toBe(201);
    const idx = await db.collection('timetableentries').indexes();
    expect(idx.filter((i) => i.unique).length).toBe(3);
  });
});
