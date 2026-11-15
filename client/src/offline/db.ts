import Dexie, { type Table } from 'dexie';

/**
 * Browser-side offline store (IndexedDB via Dexie).
 * - httpCache: last good response of GET endpoints, served when the server is unreachable.
 * - outbox:    operations created offline; each has a stable UUID used as the server
 *              Idempotency-Key, so retries can never create duplicates.
 * - drafts:    in-progress attendance marking, survives tab close / device restart.
 * - offlineCreds: password verifier for offline sign-in (PBKDF2 hash — never the password,
 *              never a session token).
 */
export interface CachedResponse { key: string; data: unknown; meta?: unknown; savedAt: number; userId: string }
export type OutboxStatus = 'pending' | 'sending' | 'synced' | 'conflict' | 'failed' | 'auth_required';
export interface OutboxItem {
  id: string;                 // UUID → Idempotency-Key
  userId: string;
  /** 'generic': any other change made while offline (edit, create, delete...) replayed as-is. */
  kind: 'attendance.submit' | 'attendance.correction' | 'generic';
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  body: Record<string, unknown>;
  label: string;              // human description, e.g. "Attendance 5-A, 2026-11-11"
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  errorDetails?: unknown;
  createdAt: number;
  syncedAt?: number;
  serverResult?: unknown;
}
export interface Draft { key: string; userId: string; value: unknown; updatedAt: number }
export interface OfflineCred { username: string; salt: string; hash: string; iterations: number; user: unknown; savedAt: number }

class OfflineDb extends Dexie {
  httpCache!: Table<CachedResponse, string>;
  outbox!: Table<OutboxItem, string>;
  drafts!: Table<Draft, string>;
  offlineCreds!: Table<OfflineCred, string>;
  constructor() {
    super('sms-offline');
    this.version(1).stores({
      httpCache: 'key, userId, savedAt',
      outbox: 'id, userId, status, createdAt, nextAttemptAt',
      drafts: 'key, userId, updatedAt',
      offlineCreds: 'username'
    });
  }
}

export const db = new OfflineDb();

/** Removes cached data that belongs to other users of a shared device. */
export async function purgeOtherUsers(userId: string) {
  await db.httpCache.where('userId').notEqual(userId).delete();
  await db.drafts.where('userId').notEqual(userId).delete();
}
