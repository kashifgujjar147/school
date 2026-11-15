import { statfs } from 'node:fs/promises';
import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { conflictResolveSchema, paginationSchema, schoolDate, countStatuses, attendancePercent, type ServiceStatus, type AttendanceStatus } from '@sms/shared';
import { APP_VERSION, env } from '../config/env.js';
import { dbState, supportsTransactions } from '../config/db.js';
import {
  AttendanceCorrection, AttendanceRecord, AttendanceSheet, AuditLog, BackupRecord, Classroom, LoginHistory, NotificationJob,
  PasswordResetRequest, Session, Student, SyncConflict, SyncOperation, User
} from '../models/index.js';
import { can } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { classroomScopeFilter } from '../services/access.js';
import { backupDiskUsage, backupDir } from '../services/backup.js';
import { getSettings, holidayDates } from '../services/settings.js';
import { configProblems, getProviderConfig } from '../services/sms-providers.js';
import { isNetworkError, syncEngine } from '../sync/engine.js';
import { workers } from '../jobs/workers.js';
import { AppError, escapeRegex, h, ok, pageArgs, parse } from '../utils/http.js';
import { $cmp, $in, $ne } from '../utils/query.js';

export const systemRouter = Router();

/** Unauthenticated liveness probe for hosting platforms. Reveals nothing sensitive. */
export const healthRouter = Router();
healthRouter.get('/', (_req, res) => {
  const up = dbState() === 'connected';
  res.status(up ? 200 : 503).json({ ok: up, db: dbState(), version: APP_VERSION });
});

// ------------------------------------------------------------------ Dashboard overview
systemRouter.get('/overview', can('dashboard.view'), h(async (req, res) => {
  const s = await getSettings();
  const today = schoolDate(new Date(), s.timeZone);
  const scope = await classroomScopeFilter(req.user!);
  const roomScope = scope.classroomId ? { _id: scope.classroomId } : {};
  // 14-day window ending on the school's "today" (both ends in school time, not UTC).
  const since = new Date(Date.parse(today + 'T12:00:00Z') - 13 * 86_400_000).toISOString().slice(0, 10);
  const [totalStudents, activeStudents, teachers, rooms, todayRecs, sheetsToday, pendingCorrections, trend, recent, holidays] = await Promise.all([
    Student.countDocuments({ deletedAt: null, ...scope }),
    Student.countDocuments({ deletedAt: null, status: 'active', ...scope }),
    User.countDocuments({ role: 'teacher', status: 'active', deletedAt: null }),
    Classroom.find({ deletedAt: null, archived: false, ...roomScope }).select('name').lean(),
    AttendanceRecord.aggregate<{ _id: AttendanceStatus; n: number }>([{ $match: { date: today, deletedAt: null, ...scope } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    AttendanceSheet.find({ date: today, deletedAt: null, ...scope }).select('classroomId').lean(),
    AttendanceCorrection.countDocuments({ status: 'pending', deletedAt: null, ...(req.user!.permissions.includes('corrections.review') ? {} : { requestedBy: req.user!.id }) }),
    AttendanceRecord.aggregate<{ _id: { d: string; s: AttendanceStatus }; n: number }>([{ $match: { date: $cmp({ gte: since, lte: today }), deletedAt: null, ...scope } }, { $group: { _id: { d: '$date', s: '$status' }, n: { $sum: 1 } } }]),
    req.user!.permissions.includes('audit.view') ? AuditLog.find().sort({ at: -1 }).limit(12).select('action actorName entity at').lean() : Promise.resolve([]),
    holidayDates(today, today)
  ]);
  const counts = countStatuses([]);
  for (const r of todayRecs) { counts[r._id] = r.n; counts.total += r.n; }
  const days = [...new Set(trend.map((t) => t._id.d))].sort();
  const trendRows = days.map((d) => {
    const c = countStatuses([]);
    for (const t of trend.filter((x) => x._id.d === d)) { c[t._id.s] = t.n; c.total += t.n; }
    return { date: d, ...c, percent: attendancePercent(c, s.policy) };
  });
  const submittedIds = new Set(sheetsToday.map((x) => x.classroomId));
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  let notifications: Record<string, number> | null = null;
  if (env.PACKAGE === 'standard' && req.user!.permissions.includes('sms.view')) {
    const agg = await NotificationJob.aggregate<{ _id: string; n: number }>([{ $match: { date: today } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    notifications = Object.fromEntries(agg.map((a) => [a._id, a.n]));
  }
  await syncEngine.refreshCounts().catch(() => undefined);
  ok(res, {
    date: today, schoolDay: s.policy.workingDays.includes(dow) && !holidays.includes(today),
    totals: { students: totalStudents, activeStudents, teachers, classrooms: rooms.length },
    today: { ...counts, percent: attendancePercent(counts, s.policy) },
    submissions: { submitted: rooms.filter((r) => submittedIds.has(r._id)).length, total: rooms.length, missing: rooms.filter((r) => !submittedIds.has(r._id)).map((r) => ({ id: r._id, name: r.name })) },
    pendingCorrections, trend: trendRows, recentActivity: recent, notifications,
    mode: env.APP_MODE, sync: env.APP_MODE === 'hybrid' ? syncEngine.status : null
  });
}));

// ------------------------------------------------------------------ System health (honest statuses)
systemRouter.get('/health', can('system.view'), h(async (_req, res) => {
  const now = new Date().toISOString();
  const services: ServiceStatus[] = [];
  const t0 = Date.now();
  let dbDetail: string = dbState();
  try { await mongoose.connection.db!.admin().ping(); dbDetail = `connected (${Date.now() - t0} ms)`; } catch { dbDetail = 'ping failed'; }
  services.push({ name: 'database', state: dbDetail.startsWith('connected') ? 'ok' : 'down', detail: `${env.APP_MODE === 'cloud' ? 'MongoDB Atlas' : 'Local MongoDB'} — ${dbDetail}${(await supportsTransactions()) ? ', transactions enabled' : ', transactions unavailable (standalone)'}`, checkedAt: now });
  services.push({ name: 'backend', state: 'ok', detail: `v${APP_VERSION}, node ${env.NODE_ID}, uptime ${Math.round(process.uptime() / 60)} min`, checkedAt: now });

  const lastBackup = await BackupRecord.findOne({ status: $in(['verified', 'completed']) }).sort({ createdAt: -1 }).lean();
  const lastFailed = await BackupRecord.findOne({ status: $in(['failed', 'verify_failed']) }).sort({ createdAt: -1 }).lean();
  const ageH = lastBackup ? (Date.now() - new Date(lastBackup.createdAt!).getTime()) / 3600_000 : Infinity;
  services.push({ name: 'backups', state: !lastBackup ? 'down' : ageH > 48 ? 'degraded' : 'ok', detail: lastBackup ? `last ${lastBackup.status} backup ${Math.round(ageH)} h ago${lastFailed && lastFailed.createdAt! > lastBackup.createdAt! ? '; most recent attempt FAILED' : ''}` : 'no successful backup yet', checkedAt: now });

  if (env.PACKAGE === 'standard') {
    const cfg = await getProviderConfig();
    const problems = configProblems(cfg);
    const queue = await NotificationJob.aggregate<{ _id: string; n: number }>([{ $match: { status: $in(['pending', 'failed', 'blocked_config', 'processing']) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const q = Object.fromEntries(queue.map((x) => [x._id, x.n]));
    services.push({ name: 'sms', state: problems.length ? 'not_configured' : (q.failed ?? 0) > 0 ? 'degraded' : 'ok', detail: problems.length ? problems.join('; ') : `${cfg.provider} via ${cfg.source}; queue: ${JSON.stringify(q)}`, checkedAt: now });
  } else {
    services.push({ name: 'sms', state: 'disabled', detail: 'Starter package', checkedAt: now });
  }
  if (env.APP_MODE === 'hybrid') {
    await syncEngine.refreshCounts();
    const st = syncEngine.status;
    services.push({ name: 'sync', state: st.state === 'online' && !st.conflicts && !st.dead ? 'ok' : st.state === 'offline' ? 'degraded' : st.state === 'error' || st.dead ? 'down' : 'degraded', detail: `${st.state}; pending ${st.pending}, failed ${st.failed}, conflicts ${st.conflicts}, dead ${st.dead}; last success ${st.lastSuccessAt?.toISOString() ?? 'never'}${st.lastError ? '; ' + st.lastError : ''}`, checkedAt: now });
  } else {
    services.push({ name: 'sync', state: 'disabled', detail: env.APP_MODE === 'cloud' ? 'Cloud mode: data is stored directly in Atlas' : 'Local mode: no cloud sync configured', checkedAt: now });
  }
  let storage: Record<string, unknown> = {};
  try {
    const st = await mongoose.connection.db!.stats();
    const fs = await statfs(backupDir).catch(() => null);
    storage = { dataSizeBytes: st.dataSize, storageSizeBytes: st.storageSize, indexSizeBytes: st.indexSize, backupBytes: await backupDiskUsage(), diskFreeBytes: fs ? fs.bavail * fs.bsize : null };
  } catch { storage = { note: 'storage statistics unavailable for this database user' }; }
  ok(res, { services, storage, workers: workers.status(), lastBackup });
}));

// ------------------------------------------------------------------ Security center
systemRouter.get('/security', can('security.view'), h(async (_req, res) => {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [failed, recentLogins, activeSessions, locked, resetRequests, suspicious] = await Promise.all([
    LoginHistory.find({ success: false, at: $cmp({ gte: since }) }).sort({ at: -1 }).limit(100).lean(),
    LoginHistory.find({ success: true }).sort({ at: -1 }).limit(50).lean(),
    Session.find({ revokedAt: null, expiresAt: $cmp({ gt: new Date() }) }).select('userId ip userAgent lastSeenAt createdAt').sort({ lastSeenAt: -1 }).limit(200).lean(),
    User.find({ lockedUntil: $cmp({ gt: new Date() }) }).select('username fullName lockedUntil').lean(),
    PasswordResetRequest.find({ status: 'open' }).sort({ createdAt: -1 }).lean(),
    // Heuristic: many failures from one IP in the last 24 h.
    LoginHistory.aggregate([{ $match: { success: false, at: $cmp({ gte: new Date(Date.now() - 86_400_000) }) } }, { $group: { _id: '$ip', n: { $sum: 1 }, users: { $addToSet: '$username' } } }, { $match: { n: $cmp({ gte: 10 }) } }, { $sort: { n: -1 } }])
  ]);
  const users = await User.find({ _id: $in(activeSessions.map((s) => s.userId)) }).select('fullName username role').lean();
  ok(res, {
    failedLogins: failed, recentLogins, lockedAccounts: locked, resetRequests, suspiciousIps: suspicious,
    activeSessions: activeSessions.map((s) => ({ ...s, _id: String(s._id).slice(0, 12), user: users.find((u) => u._id === s.userId) })),
    config: { sessionTtlHours: env.SESSION_TTL_HOURS, idleMinutes: env.SESSION_IDLE_MINUTES, maxAttempts: env.LOGIN_MAX_ATTEMPTS, lockMinutes: env.LOGIN_LOCK_MINUTES, secureCookies: env.COOKIE_SECURE }
  });
}));

systemRouter.post('/security/reset-requests/:id/dismiss', can('users.manage'), h(async (req, res) => {
  await PasswordResetRequest.updateOne({ _id: z.string().uuid().parse(req.params.id) }, { status: 'dismissed', handledBy: req.user!.id });
  ok(res, { dismissed: true });
}));

systemRouter.get('/audit', can('audit.view'), h(async (req, res) => {
  const q = parse(paginationSchema.extend({ entity: z.string().max(40).optional(), actorId: z.string().uuid().optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.entity) filter.entity = q.entity;
  if (q.actorId) filter.actorId = q.actorId;
  if (q.q) filter.action = new RegExp(escapeRegex(q.q), 'i');
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  ok(res, items, { page: q.page, pageSize: q.pageSize, total });
}));

// ------------------------------------------------------------------ Sync administration (hybrid)
systemRouter.get('/sync', can('sync.view'), h(async (req, res) => {
  await syncEngine.refreshCounts().catch(() => undefined);
  const status = z.enum(['pending', 'failed', 'conflict', 'dead', 'synced']).optional().parse(req.query.status);
  const [ops, conflicts] = await Promise.all([
    SyncOperation.find(status ? { status } : { status: $ne('synced') }).sort({ createdAt: -1 }).limit(200).select('-snapshot').lean(),
    SyncConflict.find({ status: 'open' }).sort({ createdAt: -1 }).limit(100).lean()
  ]);
  // Never send password hashes (user-record conflicts) to the browser.
  const strip = (d: unknown) => { if (!d || typeof d !== 'object') return d; const { passwordHash: _p, ...rest } = d as Record<string, unknown>; return rest; };
  const safeConflicts = conflicts.map((c) => ({ ...c, localVersion: strip(c.localVersion), remoteVersion: strip(c.remoteVersion) }));
  ok(res, { enabled: syncEngine.enabled, mode: env.APP_MODE, nodeId: env.NODE_ID, status: syncEngine.status, operations: ops, conflicts: safeConflicts });
}));
systemRouter.post('/sync/run', can('sync.manage'), h(async (req, res) => {
  const st = await syncEngine.runOnce();
  await audit(req, 'sync.manual_run', 'sync');
  ok(res, st);
}));
systemRouter.post('/sync/retry-failed', can('sync.manage'), h(async (req, res) => {
  const r = await syncEngine.retryFailed();
  await audit(req, 'sync.retry_failed', 'sync', undefined, r);
  ok(res, r);
}));
systemRouter.post('/sync/conflicts/:id/resolve', can('sync.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const b = parse(conflictResolveSchema, req.body);
  const r = await syncEngine.resolve(id, b.resolution, req.user!.id, b.merged, b.note ?? undefined).catch((e: Error) => {
    if (isNetworkError(e)) throw new AppError(503, 'OFFLINE', 'Atlas is unreachable. Conflicts can only be resolved while online so no remote change is overwritten unseen.');
    throw new AppError(409, 'SYNC_RESOLVE', e.message);
  });
  await audit(req, 'sync.conflict_resolved', 'sync_conflict', id, { resolution: b.resolution });
  ok(res, r);
}));
systemRouter.post('/sync/bootstrap', can('sync.manage'), h(async (req, res) => {
  const { direction } = parse(z.object({ direction: z.enum(['pull_all', 'push_all']) }), req.body);
  const r = await syncEngine.bootstrap(direction).catch((e: Error) => { throw new AppError(409, 'SYNC_BOOTSTRAP', e.message); });
  await audit(req, 'sync.bootstrap', 'sync', undefined, { direction, r });
  ok(res, r);
}));
