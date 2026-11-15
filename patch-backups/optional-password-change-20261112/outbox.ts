import { create } from 'zustand';
import { backoffMs } from '@sms/shared';
import { db, type OutboxItem } from '../offline/db';
import { ApiError, NetworkError, post } from '../services/api';
import { useAuth } from '../store/auth';

/**
 * Browser outbox. Operations created while the school server is unreachable are stored in
 * IndexedDB and sent when it is reachable again. Each item's UUID is sent as Idempotency-Key and
 * embedded as clientOpId, so a resend after a lost response returns the original result instead
 * of creating a duplicate. An item is only marked `synced` after the server confirms it.
 */
interface OutboxState {
  pending: number; needsAttention: number; flushing: boolean; lastFlushAt: number | null;
  refresh: () => Promise<void>;
}
export const useOutbox = create<OutboxState>((set) => ({
  pending: 0, needsAttention: 0, flushing: false, lastFlushAt: null,
  refresh: async () => {
    const userId = useAuth.getState().user?.id;
    if (!userId) return set({ pending: 0, needsAttention: 0 });
    const items = await db.outbox.where('userId').equals(userId).toArray();
    set({
      pending: items.filter((i) => i.status === 'pending' || i.status === 'sending').length,
      needsAttention: items.filter((i) => ['conflict', 'failed', 'auth_required'].includes(i.status)).length
    });
  }
}));

export async function enqueue(item: Omit<OutboxItem, 'status' | 'attempts' | 'nextAttemptAt' | 'createdAt'>) {
  await db.outbox.put({ ...item, status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: Date.now() });
  await useOutbox.getState().refresh();
}

let running: Promise<void> | null = null;

export function flushOutbox(): Promise<void> {
  if (running) return running;
  running = doFlush().finally(() => { running = null; });
  return running;
}

async function doFlush() {
  const auth = useAuth.getState();
  const userId = auth.user?.id;
  if (!userId || auth.offlineSession) return; // needs a real server session
  useOutbox.setState({ flushing: true });
  try {
    const due = (await db.outbox.where('userId').equals(userId).sortBy('createdAt'))
      .filter((i) => (i.status === 'pending' || i.status === 'auth_required' || i.status === 'sending') && i.nextAttemptAt <= Date.now());
    for (const item of due) {
      await db.outbox.update(item.id, { status: 'sending' });
      try {
        const result = await post<unknown>(item.url, item.body, { 'Idempotency-Key': item.id, 'X-Offline-Origin': '1' });
        await db.outbox.update(item.id, { status: 'synced', syncedAt: Date.now(), serverResult: result, lastError: undefined });
      } catch (e) {
        if (e instanceof NetworkError) {
          const attempts = item.attempts + 1;
          await db.outbox.update(item.id, { status: 'pending', attempts, nextAttemptAt: Date.now() + backoffMs(attempts, 5_000, 5 * 60_000), lastError: 'Server unreachable' });
          break; // stop: still offline
        }
        if (e instanceof ApiError) {
          if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') {
            await db.outbox.update(item.id, { status: 'auth_required', lastError: e.message });
            useAuth.setState({ needsReauth: true });
            break;
          }
          if (e.status >= 500 || e.status === 429) {
            const attempts = item.attempts + 1;
            await db.outbox.update(item.id, { status: 'pending', attempts, nextAttemptAt: Date.now() + backoffMs(attempts, 15_000, 30 * 60_000), lastError: e.message });
            continue;
          }
          // 4xx: the server refused it (already submitted, roster changed, closed window…). Keep it,
          // show it to the user — never drop offline work silently.
          await db.outbox.update(item.id, { status: e.status === 409 ? 'conflict' : 'failed', lastError: e.message, errorDetails: { code: e.code, details: e.details } });
          continue;
        }
        await db.outbox.update(item.id, { status: 'failed', lastError: (e as Error).message });
      }
    }
    // Keep synced items 14 days for the teacher's own record, then clean up.
    await db.outbox.where('status').equals('synced').filter((i) => (i.syncedAt ?? 0) < Date.now() - 14 * 86_400_000).delete();
  } finally {
    useOutbox.setState({ flushing: false, lastFlushAt: Date.now() });
    await useOutbox.getState().refresh();
  }
}

export async function discardOutboxItem(id: string) {
  await db.outbox.delete(id);
  await useOutbox.getState().refresh();
}

/**
 * Re-sends a refused item as a NEW operation (new UUID), because the server remembers the
 * response to the old Idempotency-Key and would replay the refusal.
 */
export async function requeueOutboxItem(id: string, body?: Record<string, unknown>) {
  const old = await db.outbox.get(id);
  if (!old) return;
  const newId = crypto.randomUUID();
  const nextBody = { ...(body ?? old.body) };
  if ('clientOpId' in nextBody) nextBody.clientOpId = newId;
  await db.transaction('rw', db.outbox, async () => {
    await db.outbox.delete(id);
    await db.outbox.put({ ...old, id: newId, body: nextBody, status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: undefined, errorDetails: undefined, createdAt: Date.now() });
  });
  await useOutbox.getState().refresh();
}
