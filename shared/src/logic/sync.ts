/**
 * Pure synchronisation decision logic. Used by the server sync engine (local <-> Atlas)
 * and mirrored by the browser outbox. Dependency-free so it is unit-testable anywhere.
 *
 * Every synchronised document carries:
 *   _id      stable UUID (generated where the record is created, never re-keyed)
 *   version  integer, +1 on every write
 *   updatedAt, updatedByNode
 *
 * Every change produces an operation:
 *   opId (UUID, idempotency key), collection, docId, baseVersion (version before change),
 *   newVersion, snapshot (full document after change, or null for deletes)
 */

export interface SyncOperation<T = Record<string, unknown>> {
  opId: string;
  collection: string;
  docId: string;
  kind: 'upsert' | 'delete';
  baseVersion: number;
  newVersion: number;
  snapshot: T | null;
  nodeId: string;
  createdAt: string; // ISO
}

export interface VersionedDoc {
  _id: string;
  version: number;
  deletedAt?: string | Date | null; // Date when read from MongoDB, string after JSON transport
  [k: string]: unknown;
}

export type ApplyDecision =
  | { action: 'insert' }
  | { action: 'replace' }
  | { action: 'skip_already_applied'; reason: string }
  | { action: 'conflict'; reason: string };

/** Fields ignored when comparing two snapshots for equality. */
const VOLATILE = new Set(['updatedAt', 'updatedByNode', 'syncedAt', '__v']);

export function stableEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .filter((k) => !VOLATILE.has(k) && o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(o[k]))
      .join(',') +
    '}'
  );
}

/**
 * Decide how to apply an incoming operation to the target store's current copy.
 * NEVER returns a decision that overwrites a newer target with an older snapshot.
 *
 * @param alreadyApplied whether the target has recorded this opId as applied (idempotency)
 * @param targetHasPendingLocalChange whether the target side has its own un-pushed op for this doc
 */
export function decideApply(
  op: SyncOperation,
  target: VersionedDoc | null,
  alreadyApplied: boolean,
  targetHasPendingLocalChange = false
): ApplyDecision {
  if (alreadyApplied) return { action: 'skip_already_applied', reason: 'opId already applied' };

  if (!target) {
    if (op.kind === 'delete') return { action: 'skip_already_applied', reason: 'delete of missing document' };
    if (op.baseVersion === 0) return { action: 'insert' };
    // Target never saw this doc but op is an update: safe to insert the full snapshot.
    return { action: 'insert' };
  }

  // Same content already present (e.g. retried push after lost response).
  if (op.snapshot && target.version >= op.newVersion && stableEqual(stripMeta(op.snapshot), stripMeta(target))) {
    return { action: 'skip_already_applied', reason: 'identical content already present' };
  }

  if (targetHasPendingLocalChange) {
    return { action: 'conflict', reason: 'both sides changed the document since last sync' };
  }

  if (target.version === op.baseVersion) return { action: 'replace' };

  if (target.version > op.baseVersion) {
    return { action: 'conflict', reason: `target version ${target.version} is newer than op base ${op.baseVersion}` };
  }

  // target.version < op.baseVersion: target missed intermediate ops. The snapshot is a full
  // document that is strictly newer than target, so applying it cannot lose target data
  // that the origin did not already see.
  return { action: 'replace' };
}

function stripMeta(d: Record<string, unknown>): Record<string, unknown> {
  const { version: _v, ...rest } = d as Record<string, unknown> & { version?: number };
  return rest;
}

/** Exponential backoff with full jitter cap. attempt starts at 1. */
export function backoffMs(attempt: number, baseMs = 5_000, maxMs = 30 * 60_000, rand = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2));
}

/** Categories that must never be auto-resolved; a human resolves conflicts on these. */
export const MANUAL_RESOLUTION_COLLECTIONS = new Set([
  'attendancerecords', 'attendancecorrections', 'students', 'teacherassignments', 'classrooms', 'users'
]);

/**
 * Source-of-truth rules per collection (documented in docs/synchronization).
 * 'local'  – the school's local server is authoritative; Atlas receives copies.
 * 'either' – both sides may edit; version check + manual conflict resolution.
 */
export const SOURCE_OF_TRUTH: Record<string, 'local' | 'either' | 'cloud'> = {
  schoolsettings: 'either',
  academicsessions: 'either',
  classes: 'either',
  sections: 'either',
  classrooms: 'either',
  teacherassignments: 'either',
  users: 'either',
  students: 'either',
  guardians: 'either',
  holidays: 'either',
  attendancerecords: 'either',
  attendancecorrections: 'either',
  notificationtemplates: 'either',
  announcements: 'either'
};
