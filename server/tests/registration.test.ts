import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, type World } from './helpers.js';
import { env } from '../src/config/env.js';
import { AuditLog, User } from '../src/models/index.js';
import { verifyPassword } from '../src/security/crypto.js';
import { $in } from '../src/utils/query.js';

const NEW_PW = 'Fresh-Account-42';
const mutableEnv = env as { SETUP_TOKEN: string; REGISTRATION_ENABLED: boolean };

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });
afterEach(() => { mutableEnv.SETUP_TOKEN = ''; mutableEnv.REGISTRATION_ENABLED = true; });

const register = (body: Record<string, unknown>) => request(w.app).post('/api/auth/register').send(body);
const valid = { fullName: 'Jane Doe', email: 'Jane.Doe@Example.com', password: NEW_PW, confirmPassword: NEW_PW };

describe('self-registration (Create account)', () => {
  it('creates a pending, unassigned account with a bcrypt hash and no plaintext password', async () => {
    const r = await register(valid);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ username: 'jane.doe', status: 'pending' });
    const u = await User.findOne({ username: 'jane.doe' }).select('+passwordHash').lean();
    expect(u).toMatchObject({ fullName: 'Jane Doe', email: 'jane.doe@example.com', role: 'unassigned', status: 'pending', selfRegistered: true });
    expect(u!.createdAt).toBeInstanceOf(Date);
    expect(u!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u!.passwordHash).not.toContain(NEW_PW);
    expect(await verifyPassword(NEW_PW, u!.passwordHash)).toBe(true);
    expect(JSON.stringify(await User.findById(u!._id).lean())).not.toContain(NEW_PW);
    expect(await AuditLog.countDocuments({ action: 'auth.registered' })).toBe(1);
  });

  it('rejects a duplicate email (case-insensitive), including emails of existing accounts', async () => {
    expect((await register(valid)).status).toBe(201);
    const dup = await register({ ...valid, email: 'JANE.DOE@example.COM' });
    expect(dup.status).toBe(409);
    await User.updateOne({ _id: w.teacher }, { email: 'Teacher.One@School.pk' });
    expect((await register({ ...valid, email: 'teacher.one@school.pk' })).status).toBe(409);
    expect(await User.countDocuments({ selfRegistered: true })).toBe(1);
  });

  it('validates input on the server', async () => {
    expect((await register({ ...valid, email: 'not-an-email' })).status).toBe(400);
    expect((await register({ ...valid, password: 'short', confirmPassword: 'short' })).status).toBe(400);
    expect((await register({ ...valid, confirmPassword: 'Different-Pass-99' })).status).toBe(400);
    expect((await register({ ...valid, fullName: '' })).status).toBe(400);
    expect(await User.countDocuments({ selfRegistered: true })).toBe(0);
  });

  it('never lets the public choose a role or status', async () => {
    const r = await register({ ...valid, role: 'principal', status: 'active', extraPermissions: ['users.manage'] });
    expect(r.status).toBe(201);
    const u = await User.findOne({ username: 'jane.doe' }).lean();
    expect(u).toMatchObject({ role: 'unassigned', status: 'pending', extraPermissions: [] });
  });

  it('picks a free username when the email prefix is taken', async () => {
    expect((await register({ ...valid, email: 'teacher1@other.org' })).body.data.username).toBe('teacher12');
  });

  it('can be turned off with REGISTRATION_ENABLED=false', async () => {
    mutableEnv.REGISTRATION_ENABLED = false;
    expect((await register(valid)).status).toBe(403);
    expect((await request(w.app).get('/api/public/config')).body.data.registrationEnabled).toBe(false);
  });

  it('a pending account cannot sign in and gets a clear pending message (correct password only)', async () => {
    await register(valid);
    const r = await request(w.app).post('/api/auth/login').send({ username: 'jane.doe', password: NEW_PW });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ACCOUNT_PENDING');
    expect(r.headers['set-cookie'] ?? []).toHaveLength(0);
    // Wrong password: the usual generic failure, nothing revealed.
    const bad = await request(w.app).post('/api/auth/login').send({ username: 'jane.doe', password: 'Wrong-Password-1' });
    expect(bad.status).toBe(401);
    // Sign-in by email gives the same pending result.
    expect((await request(w.app).post('/api/auth/login').send({ username: 'jane.doe@example.com', password: NEW_PW })).body.error.code).toBe('ACCOUNT_PENDING');
  });
});

describe('administrator approval', () => {
  const registerJane = async () => { await register(valid); return (await User.findOne({ username: 'jane.doe' }).lean())!; };

  it('principal assigns a role; the user can then sign in (username or email) and lands on the right area', async () => {
    const jane = await registerJane();
    const p = await login(w.app, 'principal');
    const a = await p.post(`/api/users/${jane._id}/approve`, { role: 'teacher' });
    expect(a.status).toBe(200);
    expect(a.body.data).toMatchObject({ role: 'teacher', status: 'active', approvedBy: w.principal });
    expect(a.body.data.passwordHash).toBeUndefined();
    const byEmail = await request(w.app).post('/api/auth/login').send({ username: 'JANE.DOE@example.com', password: NEW_PW });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.role).toBe('teacher');
    const t = await login(w.app, 'jane.doe', NEW_PW);
    const me = await t.get('/api/auth/me');
    expect(me.body.data.user.permissions).toContain('attendance.mark');
    expect(me.body.data.user.permissions).not.toContain('users.manage');
    expect((await t.get('/api/users')).status).toBe(403);
  });

  it('admin cannot approve someone as principal; non-admins cannot approve at all', async () => {
    const jane = await registerJane();
    const admin = await login(w.app, 'admin1');
    expect((await admin.post(`/api/users/${jane._id}/approve`, { role: 'principal' })).status).toBe(403);
    const teacher = await login(w.app, 'teacher1');
    expect((await teacher.post(`/api/users/${jane._id}/approve`, { role: 'teacher' })).status).toBe(403);
    expect((await admin.post(`/api/users/${jane._id}/approve`, { role: 'staff' })).status).toBe(200);
    expect((await User.findById(jane._id).lean())!.role).toBe('staff');
  });

  it('pending accounts cannot be activated through the generic edit endpoint', async () => {
    const jane = await registerJane();
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/users/${jane._id}`, { status: 'active' })).status).toBe(400);
    expect((await p.patch(`/api/users/${jane._id}`, { role: 'admin' })).status).toBe(400);
    expect((await p.patch(`/api/users/${jane._id}`, { status: 'pending' })).status).toBe(400);
    expect((await User.findById(jane._id).lean())).toMatchObject({ role: 'unassigned', status: 'pending' });
  });

  it('student/parent approval requires linking to an existing record', async () => {
    const jane = await registerJane();
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/users/${jane._id}/approve`, { role: 'student' })).status).toBe(400);
    const ok = await p.post(`/api/users/${jane._id}/approve`, { role: 'student', studentId: w.studentIds[0] });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ role: 'student', studentId: w.studentIds[0] });
    const s = await request(w.app).post('/api/auth/login').send({ username: 'jane.doe', password: NEW_PW, portal: 'student' });
    expect(s.status).toBe(200);
    // Approving an already-active account is refused.
    expect((await p.post(`/api/users/${jane._id}/approve`, { role: 'admin' })).status).toBe(400);
  });

  it('rejecting a registration deactivates it', async () => {
    const jane = await registerJane();
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/users/${jane._id}/reject`)).status).toBe(200);
    expect((await User.findById(jane._id).lean())!.status).toBe('inactive');
    expect((await request(w.app).post('/api/auth/login').send({ username: 'jane.doe', password: NEW_PW })).status).toBe(401);
  });

  it('lists pending accounts for administrators', async () => {
    await registerJane();
    const p = await login(w.app, 'principal');
    const r = await p.get('/api/users?status=pending');
    expect(r.body.meta.total).toBe(1);
    expect(r.body.data[0].username).toBe('jane.doe');
  });
});

describe('existing sign-in is unchanged', () => {
  it('username login, role in response and portal separation still work', async () => {
    for (const [u, role] of [['principal', 'principal'], ['admin1', 'admin'], ['teacher1', 'teacher']] as const) {
      const r = await request(w.app).post('/api/auth/login').send({ username: u, password: 'Correct-Horse-9' });
      expect(r.status).toBe(200);
      expect(r.body.data.role).toBe(role);
    }
    expect((await request(w.app).post('/api/auth/login').send({ username: 'teacher1', password: 'Correct-Horse-9', portal: 'parent' })).status).toBe(401);
  });

  it('an email shared by two accounts is ambiguous and cannot be used to sign in', async () => {
    await User.updateMany({ _id: $in([w.teacher, w.otherTeacher]) }, { email: 'shared@school.pk' });
    expect((await request(w.app).post('/api/auth/login').send({ username: 'shared@school.pk', password: 'Correct-Horse-9' })).status).toBe(401);
  });
});

describe('first-administrator setup', () => {
  const TOKEN = 'setup-token-for-tests-0123456789';
  const body = { setupToken: TOKEN, fullName: 'First Head', username: 'head', email: 'head@school.pk', password: NEW_PW, confirmPassword: NEW_PW };
  const removeAdmins = () => User.deleteMany({ role: $in(['principal', 'admin']) });

  it('is closed while an administrator exists, even with the right token', async () => {
    mutableEnv.SETUP_TOKEN = TOKEN;
    expect((await request(w.app).get('/api/auth/setup-status')).body.data).toEqual({ setupRequired: false, setupAvailable: false });
    expect((await request(w.app).post('/api/auth/setup').send(body)).status).toBe(403);
  });

  it('is unavailable without a configured SETUP_TOKEN', async () => {
    await removeAdmins();
    expect((await request(w.app).get('/api/auth/setup-status')).body.data).toEqual({ setupRequired: true, setupAvailable: false });
    expect((await request(w.app).post('/api/auth/setup').send(body)).status).toBe(403);
  });

  it('requires the correct token, creates one principal, then closes', async () => {
    await removeAdmins();
    mutableEnv.SETUP_TOKEN = TOKEN;
    expect((await request(w.app).post('/api/auth/setup').send({ ...body, setupToken: 'wrong-token-wrong-token' })).status).toBe(403);
    const r = await request(w.app).post('/api/auth/setup').send(body);
    expect(r.status).toBe(201);
    expect(await User.findOne({ username: 'head' }).lean()).toMatchObject({ role: 'principal', status: 'active' });
    const p = await login(w.app, 'head', NEW_PW);
    expect((await p.get('/api/users')).status).toBe(200);
    // Second attempt (same token) is refused: an administrator now exists.
    expect((await request(w.app).post('/api/auth/setup').send({ ...body, username: 'head2' })).status).toBe(403);
    // And later self-registrations still get no privileges.
    expect((await register(valid)).status).toBe(201);
    expect(await User.findOne({ username: 'jane.doe' }).lean()).toMatchObject({ role: 'unassigned', status: 'pending' });
  });

  it('first Create-account on a school with no administrator becomes principal; later ones stay pending', async () => {
    await removeAdmins();
    const r = await register(valid);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ role: 'principal', status: 'active' });
    const p = await login(w.app, 'jane.doe@example.com', NEW_PW);
    expect((await p.get('/api/auth/me')).body.data.user.role).toBe('principal');
    expect((await p.get('/api/users')).status).toBe(200);
    const second = await register({ ...valid, email: 'second@example.com' });
    expect(second.body.data).toMatchObject({ role: 'unassigned', status: 'pending' });
    expect(await User.countDocuments({ role: 'principal' })).toBe(1);
  });

  it('concurrent first registrations create only one principal', async () => {
    await removeAdmins();
    const rs = await Promise.all([1, 2, 3, 4].map((i) => register({ ...valid, email: `racer${i}@example.com` })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(rs.filter((r) => r.body.data.role === 'principal')).toHaveLength(1);
    expect(await User.countDocuments({ role: 'principal' })).toBe(1);
  });

  it('concurrent setup requests create only one administrator', async () => {
    await removeAdmins();
    mutableEnv.SETUP_TOKEN = TOKEN;
    const rs = await Promise.all([1, 2, 3].map((i) => request(w.app).post('/api/auth/setup').send({ ...body, username: `head${i}` })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await User.countDocuments({ role: 'principal' })).toBe(1);
  });
});
