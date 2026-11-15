import path from 'node:path';
import { existsSync } from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { restoreSchema } from '@sms/shared';
import { BackupRecord, User } from '../models/index.js';
import { can } from '../middleware/auth.js';
import { verifyPassword } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { backupDir, createBackup, restoreBackup, verifyBackup } from '../services/backup.js';
import { badRequest, h, notFound, ok, parse } from '../utils/http.js';
import { clearSessionCookies } from '../security/sessions.js';

export const backupsRouter = Router();

backupsRouter.get('/', can('backups.manage'), h(async (_req, res) => {
  ok(res, await BackupRecord.find().sort({ createdAt: -1 }).limit(200).lean());
}));

backupsRouter.post('/', can('backups.manage'), h(async (req, res) => {
  const b = await createBackup('manual', req.user!.id);
  await audit(req, 'backup.created', 'backup', b?._id);
  ok(res, b, undefined, 201);
}));

backupsRouter.post('/:id/verify', can('backups.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const verified = await verifyBackup(id);
  ok(res, { verified, record: await BackupRecord.findById(id).lean() });
}));

backupsRouter.get('/:id/download', can('backups.manage'), h(async (req, res) => {
  const rec = await BackupRecord.findById(z.string().uuid().parse(req.params.id)).lean();
  if (!rec?.fileName) throw notFound();
  const file = path.join(backupDir, path.basename(rec.fileName));
  if (!existsSync(file)) throw notFound('Backup file is missing from disk');
  await audit(req, 'backup.downloaded', 'backup', rec._id);
  res.download(file, rec.fileName);
}));

/** Principal only (backups.restore), with password re-entry and a typed confirmation phrase. */
backupsRouter.post('/restore', can('backups.restore'), h(async (req, res) => {
  const b = parse(restoreSchema, req.body);
  const me = await User.findById(req.user!.id).select('+passwordHash');
  if (!me || !(await verifyPassword(b.password, me.passwordHash))) throw badRequest('Password is incorrect');
  await audit(req, 'backup.restore_started', 'backup', b.backupId);
  const result = await restoreBackup(b.backupId);
  await audit(null, 'backup.restore_completed', 'backup', b.backupId, result);
  clearSessionCookies(res);
  ok(res, { ...result, note: 'All users have been signed out. Sign in again.' });
}));
