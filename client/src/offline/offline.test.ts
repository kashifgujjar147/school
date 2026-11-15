import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { offlineLogin, rememberForOffline, hasOfflineCredential } from './offlineAuth';
import { enqueue, flushOutbox, requeueOutboxItem, useOutbox } from '../sync/outbox';
import { useAuth } from '../store/auth';

const user = { id: 'u1', username: 'teacher1', fullName: 'T', role: 'teacher' as const, permissions: ['attendance.mark' as const], mustChangePassword: false };

beforeEach(async () => {
  await db.delete(); await db.open();
  useAuth.setState({ user, offlineSession: false, needsReauth: false });
  vi.restoreAllMocks();
});

describe('offline sign-in', () => {
  it('stores a verifier, never the password', async () => {
    await rememberForOffline('Teacher1', 'Secret-Pass-1', user);
    const rec = await db.offlineCreds.get('teacher1');
    expect(rec).toBeTruthy();
    expect(JSON.stringify(rec)).not.toContain('Secret-Pass-1');
    expect(await hasOfflineCredential('teacher1')).toBe(true);
  });
  it('accepts the right password and rejects a wrong one', async () => {
    await rememberForOffline('teacher1', 'Secret-Pass-1', user);
    expect((await offlineLogin('teacher1', 'Secret-Pass-1'))?.id).toBe('u1');
    expect(await offlineLogin('teacher1', 'wrong')).toBeNull();
    expect(await offlineLogin('unknown', 'Secret-Pass-1')).toBeNull();
  });
  it('expires after 30 days', async () => {
    await rememberForOffline('teacher1', 'Secret-Pass-1', user);
    await db.offlineCreds.update('teacher1', { savedAt: Date.now() - 31 * 86_400_000 });
    expect(await offlineLogin('teacher1', 'Secret-Pass-1')).toBeNull();
  });
});

const item = (id: string) => ({ id, userId: 'u1', kind: 'attendance.submit' as const, method: 'POST' as const, url: '/api/attendance/submit', body: { clientOpId: id, classroomId: 'c', date: '2026-11-11', entries: [] }, label: 'x' });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('outbox', () => {
  it('network failure keeps item pending (never reported as synced)', async () => {
    await enqueue(item('11111111-1111-4111-8111-111111111111'));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await flushOutbox();
    const it1 = await db.outbox.get('11111111-1111-4111-8111-111111111111');
    expect(it1?.status).toBe('pending');
    expect(it1?.attempts).toBe(1);
    expect(useOutbox.getState().pending).toBe(1);
  });

  it('marks synced only after server confirmation and sends Idempotency-Key', async () => {
    await enqueue(item('22222222-2222-4222-8222-222222222222'));
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(201, { ok: true, data: { sheet: { _id: 's' } } }));
    await flushOutbox();
    const headers = (spy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('22222222-2222-4222-8222-222222222222');
    expect(headers['X-Offline-Origin']).toBe('1');
    expect((await db.outbox.get('22222222-2222-4222-8222-222222222222'))?.status).toBe('synced');
  });

  it('server refusal (409) is kept as a conflict for the user, not dropped', async () => {
    await enqueue(item('33333333-3333-4333-8333-333333333333'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(409, { ok: false, error: { code: 'ALREADY_SUBMITTED', message: 'already' } }));
    await flushOutbox();
    expect((await db.outbox.get('33333333-3333-4333-8333-333333333333'))?.status).toBe('conflict');
    expect(useOutbox.getState().needsAttention).toBe(1);
  });

  it('401 pauses the queue and asks for sign-in', async () => {
    await enqueue(item('44444444-4444-4444-8444-444444444444'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'no' } }));
    await flushOutbox();
    expect((await db.outbox.get('44444444-4444-4444-8444-444444444444'))?.status).toBe('auth_required');
  });

  it('offline session never sends', async () => {
    useAuth.setState({ offlineSession: true });
    await enqueue(item('55555555-5555-4555-8555-555555555555'));
    const spy = vi.spyOn(globalThis, 'fetch');
    await flushOutbox();
    expect(spy).not.toHaveBeenCalled();
  });

  it('requeue uses a NEW id and clientOpId (old key would replay the refusal)', async () => {
    await enqueue(item('66666666-6666-4666-8666-666666666666'));
    await db.outbox.update('66666666-6666-4666-8666-666666666666', { status: 'conflict' });
    await requeueOutboxItem('66666666-6666-4666-8666-666666666666');
    const all = await db.outbox.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).not.toBe('66666666-6666-4666-8666-666666666666');
    expect(all[0]!.body.clientOpId).toBe(all[0]!.id);
    expect(all[0]!.status).toBe('pending');
  });
});
