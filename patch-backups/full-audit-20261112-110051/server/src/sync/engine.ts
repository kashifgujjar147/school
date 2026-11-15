import { randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { decideApply, backoffMs, SYNC_MAX_ATTEMPTS, type SyncOperation as SharedOp } from '@sms/shared';
import { env } from '../config/env.js';
import { SyncApplied, SyncCheckpoint, SyncConflict, SyncOperation } from '../models/index.js';
import { SYNCED_MODELS } from '../models/system.js';
import { logger } from '../utils/logger.js';

/**
 * Hybrid synchronisation: local MongoDB (authoritative for day-to-day operation) <-> the school's
 * MongoDB Atlas database. Runs on the LOCAL server only (APP_MODE=hybrid).
 *
 * PUSH: local outbox (syncoperations, status pending/failed) is applied to Atlas in creation order,
 *       using decideApply() — never overwriting a newer remote document. Each applied op is recorded
 *       in Atlas `syncapplied` (idempotency) and copied into Atlas `syncoperations` so other nodes
 *       (e.g. the cloud server or a second campus server) can pull it.
 * PULL: ops in Atlas `syncoperations` from other nodes are applied locally with the same rules.
 *       A doc with an un-pushed local change is a conflict, never a silent overwrite.
 *
 * Conflicts are stored (both versions) for an authorised human to resolve.
 */

type State = 'disabled' | 'offline' | 'online' | 'syncing' | 'error';
interface Status {
  state: State; lastRunAt: Date | null; lastSuccessAt: Date | null; lastError: string | null;
  pending: number; failed: number; conflicts: number; dead: number; lastPushed: number; lastPulled: number;
}

const OVERLAP_MS = 10 * 60_000; // tolerate clock skew between nodes

function isNetworkError(e: unknown): boolean {
  const n = (e as Error)?.name ?? '';
  return /MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongoTopologyClosedError|MongoNotConnectedError/.test(n);
}

function toShared(op: { _id: string; collectionName: string; docId: string; kind: string; baseVersion: number; newVersion: number; snapshot?: unknown; nodeId: string; createdAt?: Date }): SharedOp {
  return {
    opId: op._id, collection: op.collectionName, docId: op.docId, kind: op.kind as 'upsert' | 'delete',
    baseVersion: op.baseVersion, newVersion: op.newVersion, snapshot: (op.snapshot ?? null) as Record<string, unknown> | null,
    nodeId: op.nodeId, createdAt: (op.createdAt ?? new Date()).toISOString()
  };
}

export class SyncEngine {
  private remote: Connection | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  status: Status = { state: 'disabled', lastRunAt: null, lastSuccessAt: null, lastError: null, pending: 0, failed: 0, conflicts: 0, dead: 0, lastPushed: 0, lastPulled: 0 };

  get enabled() { return env.APP_MODE === 'hybrid'; }

  start() {
    if (!this.enabled) return;
    this.status.state = 'offline';
    const tick = () => { void this.runOnce().finally(() => { this.timer = setTimeout(tick, env.SYNC_INTERVAL_SECONDS * 1000); }); };
    this.timer = setTimeout(tick, 3_000);
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    await this.remote?.close().catch(() => undefined);
    this.remote = null;
  }

  private async remoteConn(): Promise<Connection> {
    if (this.remote && this.remote.readyState === 1) return this.remote;
    await this.remote?.close().catch(() => undefined);
    this.remote = await mongoose.createConnection(env.ATLAS_SYNC_URI, { dbName: env.ATLAS_SYNC_DB_NAME, serverSelectionTimeoutMS: 8_000, maxPoolSize: 5 }).asPromise();
    await this.verifyRemoteIdentity(this.remote);
    return this.remote;
  }

  /** Never sync into another school's Atlas database. */
  private async verifyRemoteIdentity(c: Connection) {
    const s = await c.db!.collection('schoolsettings').findOne({ _id: 'school' as never }, { projection: { installId: 1 } });
    if (s && s.installId !== env.SCHOOL_INSTALL_ID) {
      await c.close();
      throw new Error(`Atlas database belongs to installation "${s.installId}", not "${env.SCHOOL_INSTALL_ID}". Sync refused.`);
    }
  }

  async refreshCounts() {
    const [pending, failed, conflicts, dead] = await Promise.all([
      SyncOperation.countDocuments({ status: 'pending' }), SyncOperation.countDocuments({ status: 'failed' }),
      SyncConflict.countDocuments({ status: 'open' }), SyncOperation.countDocuments({ status: 'dead' })
    ]);
    Object.assign(this.status, { pending, failed, conflicts, dead });
  }

  async runOnce(): Promise<Status> {
    if (!this.enabled) return this.status;
    if (this.running) return this.status;
    this.running = true;
    this.status.lastRunAt = new Date();
    try {
      const remote = await this.remoteConn();
      this.status.state = 'syncing';
      this.status.lastPushed = await this.push(remote);
      this.status.lastPulled = await this.pull(remote);
      this.status.state = 'online';
      this.status.lastSuccessAt = new Date();
      this.status.lastError = null;
      await SyncCheckpoint.updateOne({ _id: 'atlas' }, { $set: { lastSuccessAt: new Date(), lastAttemptAt: new Date(), lastError: null }, $inc: { pushedTotal: this.status.lastPushed, pulledTotal: this.status.lastPulled } }, { upsert: true });
    } catch (e) {
      this.status.state = isNetworkError(e) ? 'offline' : 'error';
      this.status.lastError = isNetworkError(e) ? 'Atlas unreachable (no internet?)' : (e as Error).message;
      await SyncCheckpoint.updateOne({ _id: 'atlas' }, { $set: { lastAttemptAt: new Date(), lastError: this.status.lastError } }, { upsert: true }).catch(() => undefined);
      if (!isNetworkError(e)) logger.error({ err: e }, 'sync run failed');
    } finally {
      this.running = false;
      await this.refreshCounts().catch(() => undefined);
    }
    return this.status;
  }

  // ------------------------------------------------------------------ PUSH
  private async push(remote: Connection): Promise<number> {
    const rdb = remote.db!;
    let pushed = 0;
    const blockedDocs = new Set((await SyncOperation.find({ status: { $in: ['conflict', 'dead'] } }).select('collectionName docId').lean()).map((o) => `${o.collectionName}:${o.docId}`));
    for (;;) {
      const ops = await SyncOperation.find({ status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: new Date() } }).sort({ createdAt: 1, _id: 1 }).limit(200).lean();
      if (!ops.length) break;
      let progressed = false;
      for (const op of ops) {
        const key = `${op.collectionName}:${op.docId}`;
        // Preserve per-document ordering: later ops wait while an earlier one is unresolved.
        if (blockedDocs.has(key)) {
          await SyncOperation.updateOne({ _id: op._id }, { lastError: 'Waiting for an earlier conflict on this record to be resolved', nextAttemptAt: new Date(Date.now() + 5 * 60_000) });
          continue;
        }
        try {
          const coll = rdb.collection(op.collectionName);
          const applied = await rdb.collection('syncapplied').findOne({ _id: op._id as never });
          const target = await coll.findOne({ _id: op.docId as never });
          const d = decideApply(toShared(op), target as never, Boolean(applied));
          if (d.action === 'conflict') {
            await this.recordConflict(op, 'push', d.reason, target);
            blockedDocs.add(key);
            continue;
          }
          if (d.action === 'insert') {
            try { await coll.insertOne(op.snapshot as never); } catch (e) {
              if ((e as { code?: number }).code === 11000) { await this.recordConflict(op, 'push', 'duplicate_natural_key: another record with the same key exists in Atlas', null); blockedDocs.add(key); continue; }
              throw e;
            }
          } else if (d.action === 'replace') {
            if (op.kind === 'delete') await coll.deleteOne({ _id: op.docId as never });
            else {
              const r = await coll.replaceOne({ _id: op.docId as never, version: (target as { version: number }).version }, op.snapshot as never);
              if (!r.matchedCount) throw new Error('remote changed during push; will retry');
            }
          }
          await rdb.collection('syncapplied').updateOne({ _id: op._id as never }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
          const { _id: _opId, ...opBody } = op;
          await rdb.collection('syncoperations').updateOne({ _id: op._id as never }, { $setOnInsert: { ...opBody, status: 'synced', syncedAt: new Date(), createdAt: new Date() } }, { upsert: true });
          await SyncOperation.updateOne({ _id: op._id }, { status: 'synced', syncedAt: new Date(), lastError: null });
          pushed++; progressed = true;
        } catch (e) {
          if (isNetworkError(e)) throw e; // stop; whole run marked offline
          const attempts = op.attempts + 1;
          const dead = attempts >= SYNC_MAX_ATTEMPTS;
          await SyncOperation.updateOne({ _id: op._id }, { status: dead ? 'dead' : 'failed', attempts, lastError: (e as Error).message, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) });
          if (dead) blockedDocs.add(key);
        }
      }
      if (!progressed) break;
    }
    return pushed;
  }

  // ------------------------------------------------------------------ PULL
  private async pull(remote: Connection): Promise<number> {
    const rdb = remote.db!;
    const ldb = mongoose.connection.db!;
    const cp = await SyncCheckpoint.findById('pull:atlas').lean();
    const since = cp?.lastSuccessAt ? new Date(cp.lastSuccessAt.getTime() - OVERLAP_MS) : new Date(0);
    let pulled = 0; let maxSeen = cp?.lastSuccessAt ?? new Date(0);
    const cursor = rdb.collection('syncoperations').find({ nodeId: { $ne: env.NODE_ID }, createdAt: { $gte: since }, collectionName: { $in: [...SYNCED_MODELS] } }).sort({ createdAt: 1 }).limit(5000);
    for await (const raw of cursor) {
      const op = raw as unknown as { _id: string; collectionName: string; docId: string; kind: string; baseVersion: number; newVersion: number; snapshot: Record<string, unknown> | null; nodeId: string; createdAt: Date };
      if (op.createdAt > maxSeen) maxSeen = op.createdAt;
      if (await SyncApplied.exists({ _id: op._id })) continue;
      const coll = ldb.collection(op.collectionName);
      const target = await coll.findOne({ _id: op.docId as never });
      const pendingLocal = await SyncOperation.exists({ collectionName: op.collectionName, docId: op.docId, status: { $in: ['pending', 'failed', 'conflict', 'dead'] } });
      const d = decideApply(toShared(op), target as never, false, Boolean(pendingLocal));
      if (d.action === 'conflict') {
        // Do not mark applied: it is re-evaluated after the conflict is resolved.
        if (!(await SyncConflict.exists({ opId: op._id, status: 'open' }))) {
          await SyncConflict.create({ opId: op._id, direction: 'pull', collectionName: op.collectionName, docId: op.docId, reason: d.reason, localVersion: target, remoteVersion: op.snapshot });
        }
        continue;
      }
      try {
        if (d.action === 'insert') await coll.insertOne(op.snapshot as never);
        else if (d.action === 'replace') {
          if (op.kind === 'delete') await coll.deleteOne({ _id: op.docId as never });
          else await coll.replaceOne({ _id: op.docId as never }, op.snapshot as never);
        }
      } catch (e) {
        if ((e as { code?: number }).code === 11000) {
          if (!(await SyncConflict.exists({ opId: op._id, status: 'open' }))) {
            await SyncConflict.create({ opId: op._id, direction: 'pull', collectionName: op.collectionName, docId: op.docId, reason: 'duplicate_natural_key: a different local record has the same key', localVersion: null, remoteVersion: op.snapshot });
          }
          continue;
        }
        throw e;
      }
      await SyncApplied.create({ _id: op._id });
      pulled++;
    }
    await SyncCheckpoint.updateOne({ _id: 'pull:atlas' }, { $set: { lastSuccessAt: maxSeen, lastAttemptAt: new Date() } }, { upsert: true });
    return pulled;
  }

  private async recordConflict(op: { _id: string; collectionName: string; docId: string }, direction: 'push' | 'pull', reason: string, remoteDoc: unknown) {
    const local = await mongoose.connection.db!.collection(op.collectionName).findOne({ _id: op.docId as never });
    await SyncOperation.updateOne({ _id: op._id }, { status: 'conflict', lastError: reason });
    await SyncConflict.create({ opId: op._id, direction, collectionName: op.collectionName, docId: op.docId, reason, localVersion: local, remoteVersion: remoteDoc });
  }

  // ------------------------------------------------------------------ Resolution
  /**
   * keep_local / keep_remote / merged. Writes the chosen document to BOTH sides with a version
   * higher than either, publishes an op so other nodes converge, and supersedes stale ops.
   * Requires connectivity: resolving blind could overwrite unseen remote changes.
   */
  async resolve(conflictId: string, resolution: 'keep_local' | 'keep_remote' | 'merged', userId: string, merged?: Record<string, unknown>, note?: string) {
    const c = await SyncConflict.findById(conflictId);
    if (!c || c.status !== 'open') throw new Error('Conflict not found or already resolved');
    const remote = await this.remoteConn();
    const lcoll = mongoose.connection.db!.collection(c.collectionName!);
    const rcoll = remote.db!.collection(c.collectionName!);
    const local = await lcoll.findOne({ _id: c.docId as never });
    let remoteDoc = await rcoll.findOne({ _id: c.docId as never });

    if (String(c.reason).startsWith('duplicate_natural_key')) {
      return this.resolveNaturalKey(c, resolution === 'keep_remote' ? 'keep_remote' : 'keep_local', local, remote, userId, note);
    }
    if (!remoteDoc && c.direction === 'pull') remoteDoc = c.remoteVersion as never;
    const chosen = resolution === 'keep_local' ? local : resolution === 'keep_remote' ? remoteDoc : { ...(local ?? remoteDoc ?? {}), ...(merged ?? {}) };
    if (!chosen) throw new Error('Nothing to keep: the chosen side has no copy of this record');
    const version = Math.max(Number(local?.version ?? 0), Number(remoteDoc?.version ?? 0)) + 1;
    const final = { ...chosen, _id: c.docId, version, updatedByNode: env.NODE_ID, updatedAt: new Date() };
    await lcoll.replaceOne({ _id: c.docId as never }, final as never, { upsert: true });
    await rcoll.replaceOne({ _id: c.docId as never }, final as never, { upsert: true });
    await this.publishResolution(remote, c.collectionName!, c.docId!, version, final);
    await SyncOperation.updateMany({ collectionName: c.collectionName, docId: c.docId, status: { $in: ['pending', 'failed', 'conflict', 'dead'] } }, { status: 'synced', syncedAt: new Date(), lastError: `superseded by conflict resolution (${resolution})` });
    await SyncConflict.updateMany({ collectionName: c.collectionName, docId: c.docId, status: 'open' }, { status: 'resolved', resolution, resolvedBy: userId, resolvedAt: new Date(), note });
    if (c.opId && c.direction === 'pull') await SyncApplied.updateOne({ _id: c.opId }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
    await this.refreshCounts();
    return { resolved: true, version };
  }

  private async publishResolution(remote: Connection, collectionName: string, docId: string, newVersion: number, snapshot: unknown) {
    const opId = randomUUID();
    const op = { _id: opId, collectionName, docId, kind: 'upsert', baseVersion: newVersion - 1, newVersion, snapshot, nodeId: env.NODE_ID, status: 'synced', syncedAt: new Date(), createdAt: new Date(), attempts: 0 };
    await remote.db!.collection('syncoperations').insertOne(op as never);
    await remote.db!.collection('syncapplied').insertOne({ _id: opId as never, appliedAt: new Date() });
    await SyncApplied.create({ _id: opId });
  }

  /**
   * Two different attendance sheets (or records) for the same classroom+date were created on
   * different nodes. keep_local retires the Atlas copy; keep_remote retires the local copy.
   * "Retire" = soft delete (deletedAt), which keeps both versions on record for audit.
   */
  private async resolveNaturalKey(c: InstanceType<typeof SyncConflict>, keep: 'keep_local' | 'keep_remote', local: Record<string, unknown> | null, remote: Connection, userId: string, note?: string) {
    const ldb = mongoose.connection.db!; const rdb = remote.db!;
    const name = c.collectionName!;
    const keyFields = name === 'attendancesheets' ? ['classroomId', 'date'] : name === 'attendancerecords' ? ['classroomId', 'studentId', 'date'] : null;
    if (!keyFields) throw new Error('Unsupported natural-key conflict; resolve manually in the database');
    const src = (local ?? (c.remoteVersion as Record<string, unknown>))!;
    const keyQuery = Object.fromEntries(keyFields.map((k) => [k, src[k]]));
    const loser = keep === 'keep_local' ? rdb : ldb;
    const losingDocs = await loser.collection(name).find({ ...keyQuery, deletedAt: null }).toArray();
    for (const doc of losingDocs) {
      if (keep === 'keep_local' && doc._id === local?._id) continue;
      if (keep === 'keep_remote' && doc._id === (c.remoteVersion as { _id?: string })?._id) continue;
      const retired = { ...doc, deletedAt: new Date(), version: Number(doc.version ?? 1) + 1, updatedByNode: env.NODE_ID };
      await loser.collection(name).replaceOne({ _id: doc._id }, retired);
      // Retiring a sheet also retires its records.
      if (name === 'attendancesheets') {
        await loser.collection('attendancerecords').updateMany({ sheetId: doc._id, deletedAt: null }, { $set: { deletedAt: new Date(), updatedByNode: env.NODE_ID }, $inc: { version: 1 } });
      }
      if (keep === 'keep_remote') await SyncOperation.updateMany({ docId: doc._id, status: { $in: ['pending', 'failed', 'conflict', 'dead'] } }, { status: 'synced', syncedAt: new Date(), lastError: 'superseded: local copy retired in favour of Atlas copy' });
    }
    if (keep === 'keep_local') {
      // Retry the local ops now that the key is free in Atlas.
      await SyncOperation.updateMany({ collectionName: { $in: ['attendancesheets', 'attendancerecords', 'attendanceaudit'] }, status: { $in: ['conflict', 'dead', 'failed'] } }, { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null });
    } else {
      // Bring the Atlas copy down now; local unique index ignores the retired local copy.
      const remoteDocs = await rdb.collection(name).find({ ...keyQuery, deletedAt: null }).toArray();
      for (const d of remoteDocs) await ldb.collection(name).replaceOne({ _id: d._id }, d, { upsert: true });
      if (name === 'attendancesheets') for (const d of remoteDocs) {
        for (const r of await rdb.collection('attendancerecords').find({ sheetId: d._id }).toArray()) await ldb.collection('attendancerecords').replaceOne({ _id: r._id }, r, { upsert: true });
      }
    }
    await SyncConflict.updateMany({ status: 'open', collectionName: { $in: name === 'attendancesheets' ? ['attendancesheets', 'attendancerecords', 'attendanceaudit'] : [name] }, reason: /duplicate_natural_key/ }, { status: 'resolved', resolution: keep, resolvedBy: userId, resolvedAt: new Date(), note });
    await this.refreshCounts();
    return { resolved: true };
  }

  async retryFailed() {
    const r = await SyncOperation.updateMany({ status: { $in: ['failed', 'dead'] } }, { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastError: null });
    await this.refreshCounts();
    return { requeued: r.modifiedCount };
  }

  /**
   * One-time initial alignment for a new hybrid node:
   *  - 'pull_all': local is empty; copy every synchronised collection from Atlas.
   *  - 'push_all': Atlas is empty; copy every synchronised collection to Atlas.
   * Refuses when the destination already has school data.
   */
  async bootstrap(direction: 'pull_all' | 'push_all') {
    const remote = await this.remoteConn();
    const [src, dst] = direction === 'pull_all' ? [remote.db!, mongoose.connection.db!] : [mongoose.connection.db!, remote.db!];
    const dstHasData = await dst.collection('students').estimatedDocumentCount() + await dst.collection('attendancerecords').estimatedDocumentCount();
    if (dstHasData > 0) throw new Error('Destination already contains school data; bootstrap refused');
    const copied: Record<string, number> = {};
    for (const name of SYNCED_MODELS) {
      const docs = await src.collection(name).find({}).toArray();
      if (name === 'schoolsettings') await dst.collection(name).deleteMany({});
      if (docs.length) await dst.collection(name).insertMany(docs, { ordered: false }).catch((e: { code?: number }) => { if (e.code !== 11000) throw e; });
      copied[name] = docs.length;
    }
    if (direction === 'push_all') await SyncOperation.updateMany({ status: 'pending' }, { status: 'synced', syncedAt: new Date(), lastError: 'covered by bootstrap' });
    await SyncCheckpoint.updateOne({ _id: 'pull:atlas' }, { $set: { lastSuccessAt: new Date() } }, { upsert: true });
    return copied;
  }
}

export const syncEngine = new SyncEngine();
