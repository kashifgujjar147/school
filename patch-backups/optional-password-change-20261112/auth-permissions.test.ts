import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, PW, type World } from './helpers.js';
import { env } from '../src/config/env.js';
import { LoginHistory, SchoolSettings, User } from '../src/models/index.js';
import { assertInstallIdentity } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('authentication', () => {
  it('logs in, returns me, logs out', async () => {
    const p = await login(w.app, 'principal');
    const me = await p.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('principal');
    await p.post('/api/auth/logout');
    expect((await p.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects wrong password with a generic message and records history', async () => {
    const r = await request(w.app).post('/api/auth/login').send({ username: 'principal', password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).not.toMatch(/username does not exist/i);
    expect(await LoginHistory.countDocuments({ success: false })).toBe(1);
  });

  it('locks the account after too many failures', async () => {
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i++) await request(w.app).post('/api/auth/login').send({ username: 'teacher1', password: 'wrong' });
    const r = await request(w.app).post('/api/auth/login').send({ username: 'teacher1', password: PW });
    expect(r.status).toBe(401);
    expect((await User.findById(w.teacher).lean())!.lockedUntil).toBeTruthy();
  });

  it('suspended users cannot log in and existing sessions are revoked', async () => {
    const t = await login(w.app, 'teacher1');
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/users/${w.teacher}`, { status: 'suspended' })).status).toBe(200);
    expect((await t.get('/api/auth/me')).status).toBe(401);
    expect((await request(w.app).post('/api/auth/login').send({ username: 'teacher1', password: PW })).status).toBe(401);
  });

  it('requires CSRF token on state-changing requests', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.agent.post('/api/academic/classes').send({ name: 'Grade 9' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF');
  });

  it('forces password change for temporary passwords', async () => {
    const p = await login(w.app, 'principal');
    const r = await p.post(`/api/users/${w.teacher}/reset-password`, { mode: 'temporary' });
    const temp = r.body.data.temporaryPassword;
    const t = await login(w.app, 'teacher1', temp);
    expect((await t.get('/api/academic/classrooms')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await t.post('/api/auth/change-password', { currentPassword: temp, newPassword: 'Brand-New-Pass-7' })).status).toBe(200);
    expect((await t.get('/api/academic/classrooms')).status).toBe(200);
  });

  it('reset link works once', async () => {
    const p = await login(w.app, 'principal');
    const url = (await p.post(`/api/users/${w.teacher}/reset-password`, { mode: 'link' })).body.data.resetUrl as string;
    const token = new URL(url).searchParams.get('token');
    expect((await request(w.app).post('/api/auth/reset/confirm').send({ token, newPassword: 'Reset-Pass-123' })).status).toBe(200);
    expect((await request(w.app).post('/api/auth/reset/confirm').send({ token, newPassword: 'Reset-Pass-456' })).status).toBe(400);
  });
});

describe('authorization', () => {
  it('teacher cannot access admin APIs', async () => {
    const t = await login(w.app, 'teacher1');
    for (const u of ['/api/users', '/api/settings', '/api/system/security', '/api/system/audit', '/api/backups', '/api/system/health']) {
      expect((await t.get(u)).status, u).toBe(403);
    }
    expect((await t.post('/api/academic/classes', { name: 'X' })).status).toBe(403);
  });

  it('teacher sees only assigned classrooms and students', async () => {
    const t = await login(w.app, 'teacher2');
    const rooms = (await t.get('/api/academic/classrooms')).body.data;
    expect(rooms.map((r: { _id: string }) => r._id)).toEqual([w.otherClassroomId]);
    expect((await t.get(`/api/students/${w.studentIds[0]}`)).status).toBe(403);
    expect((await t.get(`/api/attendance/roster?classroomId=${w.classroomId}`)).status).toBe(403);
  });

  it('admin cannot create a principal or restore backups', async () => {
    const a = await login(w.app, 'admin1');
    expect((await a.post('/api/users', { username: 'p2', fullName: 'P2', role: 'principal', password: 'Strong-Pass-1' })).status).toBe(403);
    expect((await a.post('/api/backups/restore', { backupId: crypto.randomUUID(), confirmPhrase: 'RESTORE', password: PW })).status).toBe(403);
  });

  it('role in client payload is ignored: permissions come from the server', async () => {
    const t = await login(w.app, 'teacher1');
    const r = await t.agent.get('/api/users').set('x-role', 'principal');
    expect(r.status).toBe(403);
  });
});

describe('package gating (backend enforced)', () => {
  it('starter blocks guardians and sms APIs', async () => {
    const prev = env.PACKAGE;
    (env as { PACKAGE: string }).PACKAGE = 'starter';
    try {
      const p = await login(w.app, 'principal');
      expect((await p.get('/api/guardians')).body.error.code).toBe('PACKAGE');
      expect((await p.get('/api/sms/jobs')).body.error.code).toBe('PACKAGE');
      expect((await p.get('/api/reports/notifications?from=2026-01-01&to=2026-01-31')).status).toBe(403);
    } finally { (env as { PACKAGE: string }).PACKAGE = prev; }
  });
});

describe('installation isolation', () => {
  it('refuses to run against another school database', async () => {
    await SchoolSettings.updateOne({ _id: 'school' }, { installId: 'other-school' });
    await expect(assertInstallIdentity()).rejects.toThrow(/belongs to installation "other-school"/);
  });
});
