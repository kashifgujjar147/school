import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { APP_VERSION, env } from '../config/env.js';
import { BackupRecord } from '../models/index.js';
import { logger } from '../utils/logger.js';

const { EJSON } = mongoose.mongo.BSON;
export const backupDir = path.resolve(env.BACKUP_DIR);

/** Collections never included: short-lived or derivable state. */
const EXCLUDE = new Set(['sessions', 'idempotencykeys', 'backups']);

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

/**
 * Writes a gzip'd newline-delimited EJSON dump of every collection:
 *   line 1: {"meta": {...}}
 *   then:   {"c":"<collection>","d":<document>} per document
 * EJSON preserves types (dates, ObjectIds) exactly, so restore is lossless.
 */
export async function createBackup(kind: 'manual' | 'scheduled' | 'pre_update' | 'pre_restore', createdBy?: string) {
  await mkdir(backupDir, { recursive: true });
  const id = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${env.SCHOOL_INSTALL_ID}_${stamp}_${kind}.ndjson.gz`;
  const file = path.join(backupDir, fileName);
  const rec = await BackupRecord.create({ _id: id, fileName, kind, status: 'running', createdBy, appVersion: APP_VERSION, installId: env.SCHOOL_INSTALL_ID });
  try {
    const db = mongoose.connection.db!;
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !EXCLUDE.has(n) && !n.startsWith('system.')).sort();
    const counts: { name: string; count: number }[] = [];
    async function* lines() {
      yield EJSON.stringify({ meta: { installId: env.SCHOOL_INSTALL_ID, appVersion: APP_VERSION, createdAt: new Date(), collections: names, node: env.NODE_ID } }) + '\n';
      for (const name of names) {
        let n = 0;
        for await (const d of db.collection(name).find({})) { n++; yield EJSON.stringify({ c: name, d }, { relaxed: false }) + '\n'; }
        counts.push({ name, count: n });
      }
    }
    await pipeline(Readable.from(lines()), createGzip(), createWriteStream(file, { mode: 0o600 }));
    const sizeBytes = (await stat(file)).size;
    const sha256 = await sha256File(file);
    await BackupRecord.updateOne({ _id: id }, { status: 'completed', sizeBytes, sha256, collections: counts });
    const verified = await verifyBackup(id);
    logger.info({ fileName, sizeBytes, verified }, 'backup completed');
    return BackupRecord.findById(id).lean();
  } catch (err) {
    await BackupRecord.updateOne({ _id: id }, { status: 'failed', error: (err as Error).message });
    await unlink(file).catch(() => undefined);
    logger.error({ err }, 'backup failed');
    throw err;
  } finally {
    void rec;
  }
}

function parseBackupFile(buf: Buffer) {
  const text = gunzipSync(buf).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const meta = EJSON.parse(lines[0]!) as { meta: { installId: string; collections: string[]; appVersion: string } };
  return { meta: meta.meta, docs: lines.slice(1) };
}

/** Verification = checksum matches AND the file decompresses AND per-collection counts match. */
export async function verifyBackup(id: string): Promise<boolean> {
  const rec = await BackupRecord.findById(id).lean();
  if (!rec?.fileName) return false;
  const file = path.join(backupDir, rec.fileName);
  try {
    if (!existsSync(file)) throw new Error('file missing');
    if ((await sha256File(file)) !== rec.sha256) throw new Error('checksum mismatch');
    const { meta, docs } = parseBackupFile(await readFile(file));
    if (meta.installId !== env.SCHOOL_INSTALL_ID) throw new Error('backup belongs to another installation');
    const counts = new Map<string, number>();
    for (const l of docs) { const c = (JSON.parse(l) as { c: string }).c; counts.set(c, (counts.get(c) ?? 0) + 1); }
    for (const c of rec.collections ?? []) if ((counts.get(c.name!) ?? 0) !== c.count) throw new Error(`count mismatch in ${c.name}`);
    await BackupRecord.updateOne({ _id: id }, { status: 'verified', verifiedAt: new Date(), error: null });
    return true;
  } catch (err) {
    await BackupRecord.updateOne({ _id: id }, { status: 'verify_failed', error: (err as Error).message });
    return false;
  }
}

/**
 * Restores a verified backup. A pre_restore backup of the current state is taken first, so a
 * restore can itself be undone. Refuses backups from another school installation.
 */
export async function restoreBackup(id: string) {
  const ok = await verifyBackup(id);
  if (!ok) throw new Error('Backup failed verification; refusing to restore');
  const rec = (await BackupRecord.findById(id).lean())!;
  const safety = await createBackup('pre_restore');
  const { meta, docs } = parseBackupFile(await readFile(path.join(backupDir, rec.fileName!)));
  const db = mongoose.connection.db!;
  const byCollection = new Map<string, unknown[]>();
  for (const l of docs) {
    const { c, d } = EJSON.parse(l) as { c: string; d: unknown };
    if (!byCollection.has(c)) byCollection.set(c, []);
    byCollection.get(c)!.push(d);
  }
  for (const name of meta.collections) {
    const coll = db.collection(name);
    await coll.deleteMany({});
    const list = byCollection.get(name) ?? [];
    for (let i = 0; i < list.length; i += 1000) await coll.insertMany(list.slice(i, i + 1000) as never[], { ordered: false });
  }
  // Re-insert the backup history (excluded from dumps) is untouched; sessions are invalidated.
  await db.collection('sessions').deleteMany({});
  logger.warn({ restored: rec.fileName, safetyBackup: safety?.fileName }, 'database restored from backup');
  return { restored: rec.fileName, safetyBackup: safety?.fileName };
}

/**
 * Registers a backup file that is not in this database's backup list — e.g. restoring onto a
 * replacement computer from a USB copy. Copies it into BACKUP_DIR, checks it belongs to this
 * installation, records checksum and counts, then verifies it.
 */
export async function registerBackupFile(filePath: string) {
  await mkdir(backupDir, { recursive: true });
  const buf = await readFile(filePath);
  const { meta, docs } = parseBackupFile(buf);
  if (meta.installId !== env.SCHOOL_INSTALL_ID) throw new Error(`Backup belongs to installation "${meta.installId}", not "${env.SCHOOL_INSTALL_ID}".`);
  const fileName = path.basename(filePath);
  const dest = path.join(backupDir, fileName);
  if (path.resolve(filePath) !== dest) { const { copyFile } = await import('node:fs/promises'); await copyFile(filePath, dest); }
  const counts = new Map<string, number>();
  for (const l of docs) { const c = (JSON.parse(l) as { c: string }).c; counts.set(c, (counts.get(c) ?? 0) + 1); }
  const id = randomUUID();
  await BackupRecord.create({
    _id: id, fileName, kind: 'manual', status: 'completed', sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
    collections: meta.collections.map((name) => ({ name, count: counts.get(name) ?? 0 })), appVersion: meta.appVersion, installId: meta.installId, createdBy: 'import'
  });
  await verifyBackup(id);
  return BackupRecord.findById(id).lean();
}

export async function pruneBackups(keepLast: number) {
  const scheduled = await BackupRecord.find({ kind: 'scheduled', status: { $in: ['verified', 'completed'] } }).sort({ createdAt: -1 }).lean();
  for (const old of scheduled.slice(keepLast)) {
    await unlink(path.join(backupDir, old.fileName!)).catch(() => undefined);
    await BackupRecord.deleteOne({ _id: old._id });
  }
}

export async function backupDiskUsage(): Promise<number> {
  if (!existsSync(backupDir)) return 0;
  let total = 0;
  for (const f of await readdir(backupDir)) total += (await stat(path.join(backupDir, f))).size;
  return total;
}
