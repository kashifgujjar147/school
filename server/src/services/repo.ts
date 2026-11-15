import { randomUUID } from 'node:crypto';
import type { ClientSession, Model } from 'mongoose';
import { env } from '../config/env.js';
import { SyncOperation } from '../models/index.js';
import { conflict, notFound } from '../utils/http.js';

/**
 * Versioned writes for synchronised collections.
 * Every create/update/delete:
 *   1. bumps `version` with an optimistic check (no lost updates between concurrent users)
 *   2. in hybrid mode, appends a pending op to the outbox in the same transaction (when available)
 *   3. in cloud mode, appends an already-synced op so hybrid nodes can pull the change
 *   4. in local mode, writes no op (no sync target)
 */

export interface WriteCtx { session?: ClientSession; actorId?: string }

type AnyModel = Model<any>;

function opStatus(): 'pending' | 'synced' | null {
  if (env.APP_MODE === 'hybrid') return 'pending';
  if (env.APP_MODE === 'cloud') return 'synced';
  return null;
}

async function recordOp(m: AnyModel, docId: string, kind: 'upsert' | 'delete', baseVersion: number, snapshot: Record<string, unknown> | null, ctx: WriteCtx) {
  const status = opStatus();
  if (!status) return;
  const now = new Date();
  await SyncOperation.create([{
    _id: randomUUID(),
    collectionName: m.collection.collectionName,
    docId, kind, baseVersion, newVersion: baseVersion + 1,
    snapshot, nodeId: env.NODE_ID, status,
    syncedAt: status === 'synced' ? now : undefined
  }], { session: ctx.session });
}

export async function createVersioned<T extends Record<string, unknown>>(m: AnyModel, data: T, ctx: WriteCtx = {}) {
  const [doc] = await m.create([{ ...data, version: 1, updatedByNode: env.NODE_ID }], { session: ctx.session });
  const snap = doc.toObject({ flattenMaps: true });
  await recordOp(m, String(doc._id), 'upsert', 0, snap, ctx);
  return doc;
}

/**
 * Update with optimistic concurrency. If expectedVersion is given and does not match, the caller
 * gets 409 (someone else changed the record) instead of silently overwriting it.
 */
export async function updateVersioned(m: AnyModel, id: string, patch: Record<string, unknown>, ctx: WriteCtx = {}, expectedVersion?: number) {
  const current = await m.findById(id).session(ctx.session ?? null).lean<{ version: number; deletedAt?: Date | null }>();
  if (!current || current.deletedAt) throw notFound();
  if (expectedVersion !== undefined && current.version !== expectedVersion) {
    throw conflict('This record was changed by someone else. Reload and try again.', { currentVersion: current.version });
  }
  const updated = await m.findOneAndUpdate(
    { _id: id, version: current.version },
    { $set: { ...patch, updatedByNode: env.NODE_ID }, $inc: { version: 1 } },
    { new: true, session: ctx.session, runValidators: true }
  );
  if (!updated) throw conflict('This record was changed at the same time by someone else. Reload and try again.');
  await recordOp(m, id, 'upsert', current.version, updated.toObject({ flattenMaps: true }), ctx);
  return updated;
}

/** Soft delete: keeps the document (history) and propagates the deletion through sync. */
export async function softDeleteVersioned(m: AnyModel, id: string, ctx: WriteCtx = {}) {
  return updateVersioned(m, id, { deletedAt: new Date() }, ctx);
}

/** Hard delete — only for records with no historical value (e.g. an unlinked guardian relation). */
export async function hardDeleteVersioned(m: AnyModel, id: string, ctx: WriteCtx = {}) {
  const current = await m.findById(id).session(ctx.session ?? null).lean<{ version: number }>();
  if (!current) throw notFound();
  await m.deleteOne({ _id: id }, { session: ctx.session });
  await recordOp(m, id, 'delete', current.version, null, ctx);
}
