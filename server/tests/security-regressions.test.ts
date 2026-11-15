import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, PW, type World } from './helpers.js';
import { User } from '../src/models/index.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

describe('privilege escalation through user management', () => {
  it('an admin cannot grant themselves a principal-only permission', async () => {
    const a = await login(w.app, 'admin1');
    const r = await a.patch(`/api/users/${w.admin}`, { extraPermissions: ['backups.restore'] });
    // Refused by the self-edit rule (same convention as "cannot change your own role").
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/own permissions/);
    expect((await User.findById(w.admin).lean())!.extraPermissions).toEqual([]);
    const me = await a.get('/api/auth/me');
    expect(me.body.data.user.permissions).not.toContain('backups.restore');
  });

  it('an admin cannot create a user holding permissions the admin lacks', async () => {
    const a = await login(w.app, 'admin1');
    const r = await a.post('/api/users', { username: 'sneaky', fullName: 'S', role: 'teacher', password: 'Strong-Pass-1', extraPermissions: ['backups.restore'] });
    expect(r.status).toBe(403);
    expect(await User.exists({ username: 'sneaky' })).toBeNull();
  });

  it('an admin cannot grant a principal-only permission to someone else', async () => {
    const a = await login(w.app, 'admin1');
    expect((await a.patch(`/api/users/${w.teacher}`, { extraPermissions: ['backups.restore'] })).status).toBe(403);
  });

  it('a user given users.manage cannot create accounts more powerful than their own', async () => {
    const p = await login(w.app, 'principal');
    // staff + users.manage/users.view, but none of the admin permissions
    const staff = await p.post('/api/users', { username: 'office1', fullName: 'Office', role: 'staff', password: 'Strong-Pass-1', extraPermissions: ['users.manage', 'users.view'] });
    expect(staff.status).toBe(201);
    const s = await login(w.app, 'office1', 'Strong-Pass-1');
    expect((await s.post('/api/users', { username: 'boss2', fullName: 'B', role: 'admin', password: 'Strong-Pass-1' })).status).toBe(403);
    expect((await s.patch(`/api/users/${w.teacher}`, { role: 'admin' })).status).toBe(403);
    // ...but can still create an account within their own permissions.
    expect((await s.post('/api/users', { username: 'helper1', fullName: 'H', role: 'staff', password: 'Strong-Pass-1' })).status).toBe(201);
  });

  it('nobody changes their own permissions, but a principal can still grant within theirs', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/users/${w.principal}`, { revokedPermissions: ['audit.view'] })).status).toBe(400);
    const r = await p.patch(`/api/users/${w.teacher}`, { extraPermissions: ['reports.view'] });
    expect(r.status).toBe(200);
    expect((await User.findById(w.teacher).lean())!.extraPermissions).toEqual(['reports.view']);
  });

  it('a partial update does not wipe existing permission grants', async () => {
    const p = await login(w.app, 'principal');
    await p.patch(`/api/users/${w.teacher}`, { extraPermissions: ['reports.view'] });
    expect((await p.patch(`/api/users/${w.teacher}`, { fullName: 'Renamed Teacher' })).status).toBe(200);
    const t = (await User.findById(w.teacher).lean())!;
    expect(t.fullName).toBe('Renamed Teacher');
    expect(t.extraPermissions).toEqual(['reports.view']);
  });

  it('admins can still manage ordinary accounts and roles', async () => {
    const a = await login(w.app, 'admin1');
    const r = await a.post('/api/users', { username: 'staff7', fullName: 'Staff Seven', role: 'staff', password: 'Strong-Pass-1' });
    expect(r.status).toBe(201);
    expect((await a.patch(`/api/users/${r.body.data._id}`, { role: 'teacher' })).status).toBe(200);
    expect((await a.post('/api/users', { username: 'admin9', fullName: 'Admin Nine', role: 'admin', password: 'Strong-Pass-1' })).status).toBe(201);
  });
});

describe('login form is not an operator-injection vector', () => {
  it('object-valued credentials are rejected by validation', async () => {
    const r = await request(w.app).post('/api/auth/login').send({ username: { $ne: '' }, password: { $ne: '' } });
    expect(r.status).toBe(400);
    const r2 = await request(w.app).post('/api/auth/login').send({ username: 'principal', password: { $gt: '' } });
    expect(r2.status).toBe(400);
  });

  it('a correct password still works', async () => {
    expect((await request(w.app).post('/api/auth/login').send({ username: 'principal', password: PW })).status).toBe(200);
  });
});
