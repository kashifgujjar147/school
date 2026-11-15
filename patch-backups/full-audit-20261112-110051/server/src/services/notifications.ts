import { randomUUID } from 'node:crypto';
import { renderTemplate, smsDedupeKey, smsSegments, backoffMs, SMS_MAX_ATTEMPTS, parseHHMM, schoolMinutes, type NotificationEvent } from '@sms/shared';
import { env } from '../config/env.js';
import { AttendanceRecord, Classroom, Guardian, NotificationJob, NotificationLog, NotificationTemplate, Student, StudentGuardian } from '../models/index.js';
import { getSettings } from './settings.js';
import { configProblems, getProviderConfig, sendSms } from './sms-providers.js';
import { logger } from '../utils/logger.js';

export const DEFAULT_TEMPLATES: Record<NotificationEvent, { en: string; ur: string }> = {
  absent: {
    en: 'Dear {{guardianName}}, {{studentName}} ({{className}}) was marked ABSENT at {{schoolName}} on {{date}}.',
    ur: 'محترم {{guardianName}}، {{studentName}} ({{className}}) آج {{date}} کو {{schoolName}} میں غیر حاضر تھے۔'
  },
  late: {
    en: 'Dear {{guardianName}}, {{studentName}} ({{className}}) arrived LATE at {{schoolName}} on {{date}}.',
    ur: 'محترم {{guardianName}}، {{studentName}} ({{className}}) {{date}} کو {{schoolName}} دیر سے پہنچے۔'
  },
  leave: {
    en: 'Dear {{guardianName}}, {{studentName}} ({{className}}) is recorded on LEAVE at {{schoolName}} on {{date}}.',
    ur: 'محترم {{guardianName}}، {{studentName}} ({{className}}) {{date}} کو {{schoolName}} سے رخصت پر ہیں۔'
  }
};

const STATUS_LABEL: Record<string, { en: string; ur: string }> = {
  absent: { en: 'absent', ur: 'غیر حاضر' }, late: { en: 'late', ur: 'دیر سے' }, leave: { en: 'on leave', ur: 'رخصت' }, present: { en: 'present', ur: 'حاضر' }
};

async function log(jobId: string, type: string, detail?: string) {
  await NotificationLog.create({ jobId, type, detail }).catch(() => undefined);
}

/**
 * Creates SMS jobs for attendance records whose status matches the configured events.
 * Safe to call repeatedly: the unique dedupeKey prevents duplicate messages for the same
 * student/date/event/recipient (including after offline sync replays).
 */
export async function enqueueAttendanceAlerts(sheetId: string | undefined, actorId: string, recordIds?: string[]) {
  if (env.PACKAGE !== 'standard') return { queued: 0, skipped: 0, reason: 'starter_package' };
  const s = await getSettings();
  if (!s.smsAutomation?.enabled) return { queued: 0, skipped: 0, reason: 'automation_disabled' };
  const events = s.smsAutomation.events as NotificationEvent[];
  const filter: Record<string, unknown> = { deletedAt: null, status: { $in: events } };
  if (sheetId) filter.sheetId = sheetId;
  if (recordIds) filter._id = { $in: recordIds };
  const records = await AttendanceRecord.find(filter).lean();
  if (!records.length) return { queued: 0, skipped: 0, reason: 'no_matching_records' };
  const [students, links, templates] = await Promise.all([
    Student.find({ _id: { $in: records.map((r) => r.studentId) } }).lean(),
    StudentGuardian.find({ studentId: { $in: records.map((r) => r.studentId) }, receivesAlerts: true, deletedAt: null }).lean(),
    NotificationTemplate.find({ active: true, deletedAt: null }).lean()
  ]);
  const guardians = await Guardian.find({ _id: { $in: links.map((l) => l.guardianId) }, smsOptIn: true, deletedAt: null }).lean();
  const rooms = await Classroom.find({ _id: { $in: records.map((r) => r.classroomId) } }).select('name').lean();
  let queued = 0; let skipped = 0;
  for (const r of records) {
    const st = students.find((x) => x._id === r.studentId);
    for (const l of links.filter((x) => x.studentId === r.studentId)) {
      const g = guardians.find((x) => x._id === l.guardianId);
      if (!g || !st) { skipped++; continue; }
      const lang = (g.language as 'en' | 'ur') ?? 'en';
      const tpl = templates.find((t) => t.event === r.status && t.language === lang)?.body
        ?? templates.find((t) => t.event === r.status && t.language === 'en')?.body
        ?? DEFAULT_TEMPLATES[r.status as NotificationEvent][lang];
      const body = renderTemplate(tpl, {
        studentName: st.fullName, schoolName: s.name, status: STATUS_LABEL[r.status]?.[lang] ?? r.status, date: r.date,
        className: rooms.find((x) => x._id === r.classroomId)?.name ?? '', guardianName: g.fullName
      });
      const seg = smsSegments(body);
      try {
        const jobId = randomUUID();
        await NotificationJob.create({
          _id: jobId, dedupeKey: smsDedupeKey(r.studentId, r.date, r.status, g.phone), event: r.status, studentId: r.studentId, guardianId: g._id,
          attendanceId: r._id, date: r.date, to: g.phone, body, segments: seg.segments, encoding: seg.encoding, status: 'pending', createdBy: actorId,
          version: 1, updatedByNode: env.NODE_ID
        });
        await log(jobId, 'queued');
        queued++;
      } catch (e) {
        if ((e as { code?: number }).code === 11000) skipped++; else throw e;
      }
    }
  }
  return { queued, skipped, reason: null };
}

function inQuietHours(now: Date, tz: string, start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false;
  const m = schoolMinutes(now, tz); const a = parseHHMM(start); const b = parseHHMM(end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

/** Processes due jobs. Called by the background worker; also exported for tests. */
export async function processSmsQueue(limit = 25): Promise<{ processed: number; sent: number; failed: number; offline: boolean; blocked: number }> {
  const stats = { processed: 0, sent: 0, failed: 0, offline: false, blocked: 0 };
  if (env.PACKAGE !== 'standard') return stats;
  const cfg = await getProviderConfig();
  const problems = configProblems(cfg);
  const s = await getSettings();
  const now = new Date();
  if (inQuietHours(now, s.timeZone, s.smsAutomation?.quietHoursStart, s.smsAutomation?.quietHoursEnd)) return stats;

  for (let i = 0; i < limit; i++) {
    const job = await NotificationJob.findOneAndUpdate(
      { status: { $in: ['pending', 'failed', 'blocked_config'] }, nextAttemptAt: { $lte: new Date() }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }], deletedAt: null },
      { $set: { status: 'processing', lockedUntil: new Date(Date.now() + 120_000) } },
      { sort: { nextAttemptAt: 1 }, new: true }
    );
    if (!job) break;
    stats.processed++;
    if (problems.length) {
      // Honest state: not sent, not failed — waiting for configuration. Re-checked every 10 minutes.
      await NotificationJob.updateOne({ _id: job._id }, { status: 'blocked_config', lockedUntil: null, lastError: problems.join('; '), nextAttemptAt: new Date(Date.now() + 10 * 60_000) });
      if (job.status !== 'blocked_config') await log(job._id, 'blocked_config', problems.join('; '));
      stats.blocked++;
      continue;
    }
    const r = await sendSms(cfg, job.to, job.body, job._id);
    const attemptEntry = { at: new Date(), ok: r.ok, error: r.ok ? undefined : r.error, providerStatus: r.ok ? r.providerStatus : undefined };
    if (r.ok) {
      await NotificationJob.updateOne({ _id: job._id }, {
        $set: { status: 'sent', sentAt: new Date(), provider: cfg.provider, providerMessageId: r.providerMessageId, lockedUntil: null, lastError: null },
        $inc: { attempts: 1, version: 1 }, $push: { attemptLog: { $each: [attemptEntry], $slice: -10 } }
      });
      await log(job._id, 'sent', r.providerMessageId ?? undefined);
      stats.sent++;
    } else if (r.offline) {
      // No internet: keep pending without consuming an attempt.
      stats.offline = true;
      await NotificationJob.updateOne({ _id: job._id }, { $set: { status: 'pending', lockedUntil: null, lastError: r.error, nextAttemptAt: new Date(Date.now() + 60_000) } });
      // Stop hammering while offline.
      break;
    } else {
      const attempts = job.attempts + 1;
      const dead = !r.retryable || attempts >= SMS_MAX_ATTEMPTS;
      await NotificationJob.updateOne({ _id: job._id }, {
        $set: { status: dead ? 'dead' : 'failed', lockedUntil: null, lastError: r.error, nextAttemptAt: new Date(Date.now() + backoffMs(attempts, 30_000)) },
        $inc: { attempts: 1, version: 1 }, $push: { attemptLog: { $each: [attemptEntry], $slice: -10 } }
      });
      await log(job._id, dead ? 'dead' : 'failed', r.error);
      stats.failed++;
    }
  }
  if (stats.processed) logger.info(stats, 'sms queue processed');
  return stats;
}
