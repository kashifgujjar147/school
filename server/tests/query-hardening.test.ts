import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, PW, type World } from './helpers.js';
import { Classroom, Holiday, NotificationJob, Session, Student, User } from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';
import { processSmsQueue } from '../src/services/notifications.js';
import { removeUpload, uploadDir } from '../src/services/uploads.js';
import { toXlsx } from '../src/services/spreadsheet.js';
import { $cmp, $in, $ne, $nin, assertScalar } from '../src/utils/query.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

/** What an attacker can put in a JSON body or an extended query string: untyped objects. */
const untrusted = (json: string): unknown => JSON.parse(json);
/** Plain structure, without the hidden trust marker (a Symbol) that mongoose.trusted() attaches. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('trusted operator helpers (sanitizeFilter: true)', () => {
  it('server-built operators survive sanitisation; raw operator objects do not', () => {
    const kept = mongoose.sanitizeFilter({ status: $in(['a', 'b']), n: $cmp({ gte: 1, lte: 5 }), id: $ne('x') });
    expect(plain(kept)).toEqual({ status: { $in: ['a', 'b'] }, n: { $gte: 1, $lte: 5 }, id: { $ne: 'x' } });
    const neutralised = mongoose.sanitizeFilter({ status: untrusted('{"$ne":"active"}') });
    expect(neutralised).toEqual({ status: { $eq: { $ne: 'active' } } });
  });

  it('rejects any operand that is not a scalar, so user objects cannot ride inside a trusted operator', () => {
    for (const bad of ['{"$gt":""}', '["a"]', '{"a":1}']) {
      expect(() => assertScalar(untrusted(bad))).toThrow(/Unsafe query operand/);
      expect(() => $in(untrusted(`[${bad}]`) as string[])).toThrow(/Unsafe query operand/);
      expect(() => $ne(untrusted(bad) as string)).toThrow(/Unsafe query operand/);
    }
    expect(() => $cmp({ gte: Number.NaN })).toThrow(/Unsafe/);
    expect(() => $cmp({ lte: new Date('not a date') })).toThrow(/Unsafe/);
    expect(() => $cmp({})).toThrow(/at least one bound/);
  });

  it('keeps legitimate scalar operands and drops undefined entries', () => {
    expect(plain($in(['a', undefined, 'b']))).toEqual({ $in: ['a', 'b'] });
    expect(plain($nin([1, 2]))).toEqual({ $nin: [1, 2] });
    expect(plain($cmp({ gte: '2026-01-01', lte: undefined }))).toEqual({ $gte: '2026-01-01' });
    const d = new Date();
    expect($cmp({ ne: null, lte: d })).toMatchObject({ $ne: null, $lte: d });
  });
});

describe('queries against the database', () => {
  it('legitimate operators match records', async () => {
    expect(await Student.countDocuments({ _id: $in(w.studentIds) })).toBe(3);
    expect(await Student.countDocuments({ _id: $ne(w.studentIds[0]!) })).toBe(2);
    expect(await Student.countDocuments({ _id: $nin(w.studentIds.slice(0, 2)) })).toBe(1);
    expect(await User.countDocuments({ createdAt: $cmp({ lte: new Date() }) })).toBe(4);
  });

  it('an untrusted operator object is never executed, and $where is refused', async () => {
    // Wrapped in $eq, the object cannot be cast to a string field: the query is refused outright
    // (the API turns this into a 400) instead of matching every user.
    await expect(User.countDocuments({ username: untrusted('{"$ne":"nobody"}') })).rejects.toThrow(/Cast to string failed/);
    await expect(User.countDocuments({ username: untrusted('{"$regex":".*"}') })).rejects.toThrow(/Cast to string failed/);
    // On a Mixed field the same object is compared literally and matches nothing.
    expect(await NotificationJob.countDocuments({ attemptLog: untrusted('{"$ne":null}') })).toBe(0);
    await expect(User.find({ $where: 'true' })).rejects.toThrow(/not allowed with sanitizeFilter/);
  });
});

describe('operator injection through the HTTP API', () => {
  it('extended query-string objects are rejected by validation', async () => {
    const p = await login(w.app, 'principal');
    for (const u of ['/api/students?status[$ne]=active', '/api/users?role[$ne]=x', '/api/students?classroomId[$gt]=', '/api/attendance/history?from[$gte]=0&to=2026-01-01']) {
      expect((await p.get(u)).status, u).toBe(400);
    }
  });

  it('JSON bodies with operator objects are rejected by validation', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.post('/api/students/check-duplicates', { fullName: { $ne: '' } });
    expect(r.status).toBe(400);
    expect((await request(w.app).post('/api/auth/reset/request').send({ username: { $gt: '' } })).status).toBe(400);
  });
});

describe('features that sanitizeFilter had broken now work', () => {
  it('classroom list, student list and holiday year filter', async () => {
    const p = await login(w.app, 'principal');
    const rooms = await p.get('/api/academic/classrooms');
    expect(rooms.status).toBe(200);
    expect(rooms.body.data.find((r: { _id: string }) => r._id === w.classroomId).studentCount).toBe(3);
    expect((await p.get('/api/students')).body.meta.total).toBe(3);
    await createVersioned(Holiday, { date: '2026-05-01', name: 'Labour Day' });
    await createVersioned(Holiday, { date: '2025-05-01', name: 'Labour Day' });
    const hs = await p.get('/api/academic/holidays?year=2026');
    expect(hs.body.data.map((h: { date: string }) => h.date)).toEqual(['2026-05-01']);
  });

  it('SMS job search by phone number matches (it previously matched nothing)', async () => {
    await NotificationJob.create({ dedupeKey: 'k1', event: 'absent', to: '+923001112233', body: 'x', date: '2026-05-04', status: 'pending', version: 1 });
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/sms/jobs?q=300111')).body.meta.total).toBe(1);
    expect((await p.get('/api/sms/jobs?q=999')).body.meta.total).toBe(0);
    expect((await p.get('/api/sms/jobs?from=2026-05-01&to=2026-05-31')).body.meta.total).toBe(1);
    expect((await p.get('/api/sms/jobs?from=2026-06-01')).body.meta.total).toBe(0);
  });
});

describe('query-string boolean flags', () => {
  it('"false" means false; unknown values are rejected', async () => {
    await Classroom.updateOne({ _id: w.otherClassroomId }, { archived: true });
    const p = await login(w.app, 'principal');
    const ids = async (u: string) => (await p.get(u)).body.data.map((r: { _id: string }) => r._id);
    expect(await ids('/api/academic/classrooms')).not.toContain(w.otherClassroomId);
    expect(await ids('/api/academic/classrooms?includeArchived=false')).not.toContain(w.otherClassroomId);
    expect(await ids('/api/academic/classrooms?includeArchived=true')).toContain(w.otherClassroomId);
    expect((await p.get('/api/academic/classrooms?includeArchived=maybe')).status).toBe(400);
    // mine=false must not restrict an administrator to "assigned" classrooms
    expect((await ids('/api/academic/classrooms?mine=false')).length).toBe(1);
  });
});

describe('academic session updates are validated like creation', () => {
  it('rejects malformed or inverted dates', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/academic/sessions/${w.sessionId}`, { startDate: 'next week' })).status).toBe(400);
    expect((await p.patch(`/api/academic/sessions/${w.sessionId}`, { endDate: '2025-01-01' })).status).toBe(400);
    expect((await p.patch(`/api/academic/sessions/${w.sessionId}`, { endDate: '2027-04-30' })).status).toBe(200);
  });
});

describe('session and password-reset hardening', () => {
  it('a malformed (object) session cookie is treated as signed out, not a server error', async () => {
    const r = await request(w.app).get('/api/auth/me').set('Cookie', 'sms_sid=j:%7B%22a%22%3A1%7D');
    expect(r.status).toBe(401);
  });

  it('signing in on a browser retires the session it presented', async () => {
    const agent = request.agent(w.app);
    const first = await agent.post('/api/auth/login').send({ username: 'teacher1', password: PW });
    expect(first.status).toBe(200);
    expect(await Session.countDocuments({ userId: w.teacher, revokedAt: null })).toBe(1);
    // A signed-in browser sends its CSRF token on every POST (client/src/services/api.ts), login included.
    expect((await agent.post('/api/auth/login').set('x-csrf-token', first.body.data.csrfToken).send({ username: 'principal', password: PW })).status).toBe(200);
    expect(await Session.countDocuments({ userId: w.teacher, revokedAt: null })).toBe(0);
    expect((await agent.get('/api/auth/me')).body.data.user.username).toBe('principal');
  });

  it('a reset link can be used exactly once, even by concurrent requests', async () => {
    const p = await login(w.app, 'principal');
    const url = (await p.post(`/api/users/${w.teacher}/reset-password`, { mode: 'link' })).body.data.resetUrl as string;
    const token = new URL(url).searchParams.get('token');
    const results = await Promise.all(['Reset-Pass-123', 'Reset-Pass-456'].map((newPassword) => request(w.app).post('/api/auth/reset/confirm').send({ token, newPassword })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});

describe('SMS queue recovery', () => {
  it('reclaims a job left "processing" by a crashed worker once its lock expired, but never a live lock', async () => {
    const base = { event: 'absent', to: '+923001112233', body: 'x', date: '2026-05-04', version: 1 };
    const stale = await NotificationJob.create({ ...base, dedupeKey: 'stale', status: 'processing', lockedUntil: new Date(Date.now() - 60_000) });
    const live = await NotificationJob.create({ ...base, dedupeKey: 'live', status: 'processing', lockedUntil: new Date(Date.now() + 60_000) });
    await processSmsQueue(); // no provider configured -> claimed jobs become blocked_config
    expect((await NotificationJob.findById(stale._id).lean())!.status).toBe('blocked_config');
    expect((await NotificationJob.findById(live._id).lean())!.status).toBe('processing');
  });
});

describe('uploads', () => {
  it('removeUpload never deletes outside the upload directory', async () => {
    const sibling = path.join(path.dirname(uploadDir), `${path.basename(uploadDir)}-evil`);
    await mkdir(sibling, { recursive: true });
    const victim = path.join(sibling, 'keep.txt');
    await writeFile(victim, 'x');
    await removeUpload(`/uploads/../${path.basename(sibling)}/keep.txt`);
    expect(existsSync(victim)).toBe(true);
    await mkdir(path.join(uploadDir, 'students'), { recursive: true });
    const own = path.join(uploadDir, 'students', 'own.png');
    await writeFile(own, 'x');
    await removeUpload('/uploads/students/own.png');
    expect(existsSync(own)).toBe(false);
  });
});

describe('student import from .xlsx', () => {
  it('reads an Excel workbook (dry run, then import)', async () => {
    const cols = ['admissionNumber', 'fullName', 'gender', 'class', 'section'].map((k) => ({ header: k, key: k }));
    const xlsx = await toXlsx('Students', cols, [{ admissionNumber: 'X-100', fullName: 'Zara Khan', gender: 'female', class: 'Grade 5', section: 'A' }]);
    const p = await login(w.app, 'principal');
    const dry = await p.agent.post('/api/students/import?dryRun=true').set('x-csrf-token', p.csrf).attach('file', xlsx, 'students.xlsx');
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ totalRows: 1, validRows: 1, imported: 0 });
    const real = await p.agent.post('/api/students/import?dryRun=false').set('x-csrf-token', p.csrf).attach('file', xlsx, 'students.xlsx');
    expect(real.body.data.imported).toBe(1);
    expect(await Student.exists({ admissionNumberLower: 'x-100', classroomId: w.classroomId })).toBeTruthy();
  });
});
