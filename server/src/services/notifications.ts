import { randomUUID } from 'node:crypto';
import {
  renderTemplate, smsDedupeKey, smsSegments, backoffMs, SMS_MAX_ATTEMPTS, parseHHMM, schoolMinutes, schoolDate, packageHasFeature,
  type NotificationChannel, type NotificationEvent, type TemplateVars
} from '@sms/shared';
import { env } from '../config/env.js';
import { AttendanceRecord, Classroom, Guardian, NotificationJob, NotificationLog, NotificationTemplate, Student, StudentGuardian } from '../models/index.js';
import { getSettings, type Settings } from './settings.js';
import { configProblems, getProviderConfig, sendSms, type SendResult } from './sms-providers.js';
import { getWhatsappConfig, sendWhatsapp, whatsappProblems } from './whatsapp.js';
import { logger } from '../utils/logger.js';
import { $cmp, $in, $nin } from '../utils/query.js';

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
  },
  fee_due: {
    en: 'Dear {{guardianName}}, fee voucher {{voucherNumber}} for {{studentName}} ({{amount}}) is due on {{dueDate}}. {{schoolName}}',
    ur: 'محترم {{guardianName}}، {{studentName}} کا فیس واؤچر {{voucherNumber}} ({{amount}}) {{dueDate}} تک واجب الادا ہے۔ {{schoolName}}'
  },
  fee_paid: {
    en: 'Dear {{guardianName}}, payment of {{amount}} for {{studentName}} has been received. Receipt {{receiptNumber}}. {{schoolName}}',
    ur: 'محترم {{guardianName}}، {{studentName}} کی فیس {{amount}} وصول ہو گئی ہے۔ رسید {{receiptNumber}}۔ {{schoolName}}'
  },
  result: {
    en: 'Dear {{guardianName}}, {{examName}} results for {{studentName}} are now available in the parent portal. {{schoolName}}',
    ur: 'محترم {{guardianName}}، {{studentName}} کے {{examName}} کے نتائج پیرنٹ پورٹل پر دستیاب ہیں۔ {{schoolName}}'
  },
  homework: {
    en: 'Dear {{guardianName}}, new {{subject}} homework for {{studentName}} ({{className}}): {{title}}. Due {{dueDate}}. {{schoolName}}',
    ur: 'محترم {{guardianName}}، {{studentName}} ({{className}}) کے لیے {{subject}} کا نیا ہوم ورک: {{title}}۔ آخری تاریخ {{dueDate}}۔ {{schoolName}}'
  },
  announcement: {
    en: '{{schoolName}}: {{title}} - {{message}}',
    ur: '{{schoolName}}: {{title}} - {{message}}'
  },
  timetable: {
    en: 'Dear {{guardianName}}, timetable update for {{studentName}} ({{className}}): {{message}} {{schoolName}}',
    ur: 'محترم {{guardianName}}، {{studentName}} ({{className}}) کے ٹائم ٹیبل میں تبدیلی: {{message}} {{schoolName}}'
  }
};

/** Channels the school has switched on that this package may use. */
export function enabledChannels(s: Settings): NotificationChannel[] {
  const chosen = (s.smsAutomation?.channels?.length ? s.smsAutomation.channels : ['sms']) as NotificationChannel[];
  return chosen.filter((c) => c === 'sms' || packageHasFeature(env.PACKAGE, 'whatsapp'));
}

/** Whether automatic notifications are on for this event (Notification settings). */
export function eventEnabled(s: Settings, event: NotificationEvent): boolean {
  return env.PACKAGE === 'standard' && Boolean(s.smsAutomation?.enabled) && (s.smsAutomation?.events ?? []).includes(event);
}

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
  const events = (s.smsAutomation.events as NotificationEvent[]).filter((e) => e === 'absent' || e === 'late' || e === 'leave');
  const channels = enabledChannels(s);
  const filter: Record<string, unknown> = { deletedAt: null, status: $in(events) };
  if (sheetId) filter.sheetId = sheetId;
  if (recordIds) filter._id = $in(recordIds);
  const records = await AttendanceRecord.find(filter).lean();
  if (!records.length) return { queued: 0, skipped: 0, reason: 'no_matching_records' };
  const [students, links, templates] = await Promise.all([
    Student.find({ _id: $in(records.map((r) => r.studentId)) }).lean(),
    StudentGuardian.find({ studentId: $in(records.map((r) => r.studentId)), receivesAlerts: true, deletedAt: null }).lean(),
    NotificationTemplate.find({ active: true, deletedAt: null }).lean()
  ]);
  const guardians = await Guardian.find({ _id: $in(links.map((l) => l.guardianId)), smsOptIn: true, deletedAt: null }).lean();
  const rooms = await Classroom.find({ _id: $in(records.map((r) => r.classroomId)) }).select('name').lean();
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
      for (const channel of channels) {
        const created = await createJob({
          channel, dedupeKey: smsDedupeKey(r.studentId, r.date, r.status, g.phone, channel), event: r.status as NotificationEvent,
          studentId: r.studentId, guardianId: g._id, attendanceId: r._id, date: r.date, to: g.phone, body, createdBy: actorId
        });
        if (created) queued++; else skipped++;
      }
    }
  }
  return { queued, skipped, reason: null };
}

interface NewJob {
  channel: NotificationChannel; dedupeKey: string; event: NotificationEvent; studentId?: string; guardianId?: string;
  attendanceId?: string; refId?: string; date: string; to: string; body: string; createdBy?: string;
}

/** Inserts one job; false when an identical job already exists (unique dedupeKey). */
async function createJob(j: NewJob): Promise<boolean> {
  const seg = smsSegments(j.body);
  const jobId = randomUUID();
  try {
    await NotificationJob.create({
      _id: jobId, ...j, segments: j.channel === 'sms' ? seg.segments : 1, encoding: j.channel === 'sms' ? seg.encoding : 'UTF-8',
      status: 'pending', version: 1, updatedByNode: env.NODE_ID
    });
    await log(jobId, 'queued', j.channel);
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
}

/**
 * Queues an event notification to every opted-in guardian (receivesAlerts + smsOptIn) of the given
 * students, on every enabled channel. `key` makes the job unique per student/recipient/channel, so
 * calling this again for the same event and record never sends a second message.
 * Messages are only QUEUED here; the worker sends them and records the provider's real answer.
 * With no provider configured, jobs wait honestly in `blocked_config`: nothing is reported as sent.
 */
export async function enqueueStudentEvent(opts: {
  event: NotificationEvent; studentIds: string[]; key: string; refId?: string; actorId?: string;
  vars: (student: { _id: string; fullName: string; classroomId: string }) => TemplateVars;
}): Promise<{ queued: number; skipped: number; reason: string | null }> {
  const s = await getSettings();
  if (!eventEnabled(s, opts.event)) return { queued: 0, skipped: 0, reason: env.PACKAGE !== 'standard' ? 'starter_package' : 'event_disabled' };
  if (!opts.studentIds.length) return { queued: 0, skipped: 0, reason: 'no_students' };
  const channels = enabledChannels(s);
  const [students, links, templates] = await Promise.all([
    Student.find({ _id: $in(opts.studentIds), deletedAt: null }).select('fullName classroomId').lean(),
    StudentGuardian.find({ studentId: $in(opts.studentIds), receivesAlerts: true, deletedAt: null }).lean(),
    NotificationTemplate.find({ event: opts.event, active: true, deletedAt: null }).lean()
  ]);
  const guardians = await Guardian.find({ _id: $in(links.map((l) => l.guardianId)), smsOptIn: true, deletedAt: null }).lean();
  const rooms = await Classroom.find({ _id: $in(students.map((x) => x.classroomId)) }).select('name').lean();
  const date = schoolDate(new Date(), s.timeZone);
  let queued = 0; let skipped = 0;
  for (const st of students) {
    for (const l of links.filter((x) => x.studentId === st._id)) {
      const g = guardians.find((x) => x._id === l.guardianId);
      if (!g) { skipped++; continue; }
      const lang = (g.language as 'en' | 'ur') ?? 'en';
      const tpl = templates.find((t) => t.language === lang)?.body ?? templates.find((t) => t.language === 'en')?.body ?? DEFAULT_TEMPLATES[opts.event][lang];
      const body = renderTemplate(tpl, {
        studentName: st.fullName, schoolName: s.name, guardianName: g.fullName, date,
        className: rooms.find((r) => r._id === st.classroomId)?.name ?? '', portalUrl: `${env.APP_URL}/parent`,
        ...opts.vars(st)
      });
      for (const channel of channels) {
        const created = await createJob({
          channel, dedupeKey: smsDedupeKey(st._id, opts.key, opts.event, g.phone, channel), event: opts.event,
          studentId: st._id, guardianId: g._id, refId: opts.refId, date, to: g.phone, body, createdBy: opts.actorId
        });
        if (created) queued++; else skipped++;
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
  const wa = await getWhatsappConfig();
  const problemsFor: Record<NotificationChannel, string[]> = { sms: configProblems(cfg), whatsapp: whatsappProblems(wa) };
  const send = (channel: NotificationChannel, to: string, body: string, id: string): Promise<SendResult> =>
    channel === 'whatsapp' ? sendWhatsapp(wa, to, body) : sendSms(cfg, to, body, id);
  const offlineChannels = new Set<NotificationChannel>();
  const s = await getSettings();
  const now = new Date();
  if (inQuietHours(now, s.timeZone, s.smsAutomation?.quietHoursStart, s.smsAutomation?.quietHoursEnd)) return stats;

  for (let i = 0; i < limit; i++) {
    const job = await NotificationJob.findOneAndUpdate(
      {
        deletedAt: null,
        $or: [
          { status: $in(['pending', 'failed', 'blocked_config']), nextAttemptAt: $cmp({ lte: new Date() }), $or: [{ lockedUntil: null }, { lockedUntil: $cmp({ lt: new Date() }) }], ...(offlineChannels.size ? { channel: $nin([...offlineChannels]) } : {}) },
          // A worker that crashed mid-send leaves its job 'processing'. Reclaim it once the lock has
          // expired (sends time out after 20 s, so a live worker never holds a job past the 120 s lock).
          { status: 'processing', lockedUntil: $cmp({ lt: new Date() }) }
        ]
      },
      { $set: { status: 'processing', lockedUntil: new Date(Date.now() + 120_000) } },
      { sort: { nextAttemptAt: 1 }, new: true }
    );
    if (!job) break;
    stats.processed++;
    const channel = (job.channel ?? 'sms') as NotificationChannel;
    const problems = problemsFor[channel];
    if (problems.length) {
      // Honest state: not sent, not failed — waiting for configuration. Re-checked every 10 minutes.
      await NotificationJob.updateOne({ _id: job._id }, { status: 'blocked_config', lockedUntil: null, lastError: problems.join('; '), nextAttemptAt: new Date(Date.now() + 10 * 60_000) });
      if (job.status !== 'blocked_config') await log(job._id, 'blocked_config', problems.join('; '));
      stats.blocked++;
      continue;
    }
    const r = await send(channel, job.to, job.body, job._id);
    const attemptEntry = { at: new Date(), ok: r.ok, error: r.ok ? undefined : r.error, providerStatus: r.ok ? r.providerStatus : undefined };
    if (r.ok) {
      await NotificationJob.updateOne({ _id: job._id }, {
        $set: { status: 'sent', sentAt: new Date(), provider: channel === 'whatsapp' ? 'whatsapp' : cfg.provider, providerMessageId: r.providerMessageId, lockedUntil: null, lastError: null },
        $inc: { attempts: 1, version: 1 }, $push: { attemptLog: { $each: [attemptEntry], $slice: -10 } }
      });
      await log(job._id, 'sent', r.providerMessageId ?? undefined);
      stats.sent++;
    } else if (r.offline) {
      // No internet: keep pending without consuming an attempt.
      stats.offline = true;
      await NotificationJob.updateOne({ _id: job._id }, { $set: { status: 'pending', lockedUntil: null, lastError: r.error, nextAttemptAt: new Date(Date.now() + 60_000) } });
      // Stop hammering this channel while it is unreachable; the other channel can still be served.
      offlineChannels.add(channel);
      if (offlineChannels.size === 2) break;
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
