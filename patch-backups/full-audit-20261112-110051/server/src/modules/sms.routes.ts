import { Router, urlencoded } from 'express';
import { z } from 'zod';
import { normalizePhone, smsAutomationSchema, smsTemplateSchema, unknownPlaceholders, paginationSchema, SMS_JOB_STATUSES, isoDate } from '@sms/shared';
import { env } from '../config/env.js';
import { NotificationJob, NotificationLog, NotificationTemplate, SecretSettings, SchoolSettings, Student } from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { encryptJson, safeEqual } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { getSettings, invalidateSettings } from '../services/settings.js';
import { DEFAULT_TEMPLATES, processSmsQueue } from '../services/notifications.js';
import { configProblems, getProviderConfig, mapReceipt, sendSms, verifyTwilioSignature } from '../services/sms-providers.js';
import { badRequest, h, notFound, ok, pageArgs, parse, unauthorized } from '../utils/http.js';
import { logger } from '../utils/logger.js';

export const smsRouter = Router();
smsRouter.use(requireFeature('sms_alerts'));

smsRouter.get('/templates', can('sms.view'), h(async (_req, res) => {
  const saved = await NotificationTemplate.find({ deletedAt: null }).lean();
  ok(res, { saved, defaults: DEFAULT_TEMPLATES });
}));

smsRouter.put('/templates', can('sms.manage'), h(async (req, res) => {
  const b = parse(smsTemplateSchema, req.body);
  const unknown = unknownPlaceholders(b.body);
  if (unknown.length) throw badRequest(`Unknown placeholders: ${unknown.join(', ')}`);
  const existing = await NotificationTemplate.findOne({ event: b.event, language: b.language }).lean();
  const doc = existing ? await updateVersioned(NotificationTemplate, existing._id, { body: b.body, active: b.active, deletedAt: null }) : await createVersioned(NotificationTemplate, b);
  await audit(req, 'sms.template_saved', 'template', doc._id, { event: b.event, language: b.language });
  ok(res, doc);
}));

smsRouter.patch('/automation', can('sms.manage'), h(async (req, res) => {
  const b = parse(smsAutomationSchema, req.body);
  const s = await getSettings();
  const r = await updateVersioned(SchoolSettings, 'school', { smsAutomation: { ...s.smsAutomation, ...b } });
  invalidateSettings();
  await audit(req, 'sms.automation_updated', 'settings', 'school', b);
  ok(res, r.smsAutomation);
}));

/** Provider status. Secrets are never returned — only whether each one is set. */
smsRouter.get('/provider', can('sms.view'), h(async (_req, res) => {
  const c = await getProviderConfig();
  ok(res, {
    provider: c.provider, source: c.source, problems: configProblems(c), configured: configProblems(c).length === 0,
    twilio: c.twilio ? { accountSidSet: Boolean(c.twilio.accountSid), authTokenSet: Boolean(c.twilio.authToken), from: c.twilio.from } : null,
    http: c.http ? { url: c.http.url ? new URL(c.http.url).origin + '/…' : '', method: c.http.method, from: c.http.from, idPath: c.http.idPath } : null,
    webhookTokenSet: Boolean(c.webhookToken),
    receiptUrl: c.provider === 'twilio' ? `${env.APP_URL}/api/webhooks/sms/twilio` : `${env.APP_URL}/api/webhooks/sms/http?token=<token>&id=<messageId>&status=<status>`
  });
}));

// Blank secret fields mean "keep the currently stored value" (secrets are never sent back to the browser).
const blank = z.literal('').optional();
const providerSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('none') }),
  z.object({ provider: z.literal('twilio'), accountSid: z.string().regex(/^AC[0-9a-f]{32}$/i).or(blank), authToken: z.string().min(20).max(80).or(blank), from: z.string().min(3).max(30).or(blank), webhookToken: z.string().max(100).optional() }),
  z.object({
    provider: z.literal('http'), url: z.string().url().or(blank), method: z.enum(['GET', 'POST']), headers: z.record(z.string()).default({}),
    bodyTemplate: z.string().max(2000).default(''), from: z.string().max(30).default(''), idPath: z.string().max(60).default('id'), webhookToken: z.string().min(16).max(100).or(blank)
  })
]);

smsRouter.put('/provider', can('sms.manage'), h(async (req, res) => {
  const b = parse(providerSchema, req.body);
  const cur = await getProviderConfig();
  const keep = (v: string | undefined, old: string | undefined) => (v ? v : old ?? '');
  const value = b.provider === 'none' ? { provider: 'none' }
    : b.provider === 'twilio' ? { provider: 'twilio', twilio: { accountSid: keep(b.accountSid, cur.twilio?.accountSid), authToken: keep(b.authToken, cur.twilio?.authToken), from: keep(b.from, cur.twilio?.from) }, webhookToken: b.webhookToken || cur.webhookToken || 'twilio-signature' }
    : { provider: 'http', http: { url: keep(b.url, cur.http?.url), method: b.method, headers: Object.keys(b.headers).length ? b.headers : cur.http?.headers ?? {}, bodyTemplate: b.bodyTemplate || cur.http?.bodyTemplate || '', from: b.from || cur.http?.from || '', idPath: b.idPath }, webhookToken: keep(b.webhookToken, cur.webhookToken) };
  const problems = configProblems({ ...(value as Omit<Parameters<typeof configProblems>[0], 'source'>), source: 'dashboard' });
  if (b.provider !== 'none' && problems.length) throw badRequest(`Incomplete provider settings: ${problems.join('; ')}`);
  await SecretSettings.updateOne({ _id: 'sms' }, { $set: { ...encryptJson(value), updatedBy: req.user!.id } }, { upsert: true });
  await audit(req, 'sms.provider_updated', 'sms_provider', b.provider);
  ok(res, { saved: true });
}));

smsRouter.delete('/provider', can('sms.manage'), h(async (req, res) => {
  await SecretSettings.deleteOne({ _id: 'sms' });
  await audit(req, 'sms.provider_cleared', 'sms_provider');
  ok(res, { cleared: true, nowUsing: 'environment' });
}));

/** Sends one real test message. Reports exactly what the provider answered. */
smsRouter.post('/test', can('sms.manage'), h(async (req, res) => {
  const { to } = parse(z.object({ to: z.string().min(7) }), req.body);
  const phone = normalizePhone(to, (await getSettings()).defaultCountryCode);
  if (!phone) throw badRequest('Invalid phone number');
  const r = await sendSms(await getProviderConfig(), phone, `Test message from ${(await getSettings()).name}`, 'test');
  await audit(req, 'sms.test_sent', 'sms_provider', undefined, { ok: r.ok });
  ok(res, r.ok ? { accepted: true, providerMessageId: r.providerMessageId, note: 'Accepted by provider. Delivery is confirmed only by a delivery receipt.' } : { accepted: false, error: r.error, offline: r.offline });
}));

smsRouter.get('/jobs', can('sms.view'), h(async (req, res) => {
  const q = parse(paginationSchema.extend({ status: z.enum(SMS_JOB_STATUSES).optional(), from: isoDate.optional(), to: isoDate.optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.q) filter.to = { $regex: q.q.replace(/[^\d+]/g, '') };
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([NotificationJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), NotificationJob.countDocuments(filter)]);
  const students = await Student.find({ _id: { $in: items.map((i) => i.studentId) } }).select('fullName').lean();
  ok(res, items.map((i) => ({ ...i, studentName: students.find((s) => s._id === i.studentId)?.fullName })), { page: q.page, pageSize: q.pageSize, total });
}));

smsRouter.get('/jobs/:id/logs', can('sms.view'), h(async (req, res) => {
  ok(res, await NotificationLog.find({ jobId: z.string().uuid().parse(req.params.id) }).sort({ at: 1 }).lean());
}));

smsRouter.post('/jobs/:id/retry', can('sms.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const r = await NotificationJob.updateOne({ _id: id, status: { $in: ['failed', 'dead', 'undelivered', 'blocked_config'] } }, { status: 'pending', nextAttemptAt: new Date(), attempts: 0, lockedUntil: null });
  if (!r.matchedCount) throw notFound('Job not found or not retryable');
  await NotificationLog.create({ jobId: id, type: 'retry', detail: `manual retry by ${req.user!.fullName}` });
  ok(res, { requeued: true });
}));

smsRouter.post('/jobs/:id/cancel', can('sms.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const r = await NotificationJob.updateOne({ _id: id, status: { $in: ['pending', 'failed', 'blocked_config'] } }, { status: 'cancelled' });
  if (!r.matchedCount) throw notFound('Job not found or not cancellable');
  await NotificationLog.create({ jobId: id, type: 'cancelled', detail: `by ${req.user!.fullName}` });
  ok(res, { cancelled: true });
}));

smsRouter.post('/process-now', can('sms.manage'), h(async (_req, res) => ok(res, await processSmsQueue(50))));

smsRouter.get('/usage', can('sms.view'), h(async (req, res) => {
  const q = parse(z.object({ from: isoDate, to: isoDate }), req.query);
  const agg = await NotificationJob.aggregate([
    { $match: { date: { $gte: q.from, $lte: q.to }, deletedAt: null } },
    { $group: { _id: '$status', messages: { $sum: 1 }, segments: { $sum: { $ifNull: ['$segments', 1] } } } }
  ]);
  ok(res, agg);
}));

// ------------------------------------------------------------------ Delivery receipts (public)
export const smsWebhookRouter = Router();
smsWebhookRouter.use(urlencoded({ extended: false, limit: '20kb' }));

smsWebhookRouter.post('/twilio', h(async (req, res) => {
  const cfg = await getProviderConfig();
  if (cfg.provider !== 'twilio' || !cfg.twilio?.authToken) throw unauthorized();
  const url = `${env.APP_URL}${req.originalUrl}`;
  if (!verifyTwilioSignature(cfg.twilio.authToken, url, req.body as Record<string, string>, String(req.headers['x-twilio-signature'] ?? ''))) throw unauthorized('Bad signature');
  await applyReceipt(String(req.body.MessageSid ?? ''), String(req.body.MessageStatus ?? ''), req.body.ErrorCode ? `Twilio error ${req.body.ErrorCode}` : undefined);
  res.status(204).end();
}));

smsWebhookRouter.all('/http', h(async (req, res) => {
  const cfg = await getProviderConfig();
  const token = String(req.query.token ?? '');
  if (cfg.provider !== 'http' || !cfg.webhookToken || !safeEqual(token, cfg.webhookToken)) throw unauthorized();
  const src = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) } as Record<string, string>;
  await applyReceipt(String(src.id ?? src.messageId ?? ''), String(src.status ?? ''), src.error);
  res.status(204).end();
}));

async function applyReceipt(messageId: string, status: string, error?: string) {
  if (!messageId) return;
  const mapped = mapReceipt(status);
  const job = await NotificationJob.findOne({ providerMessageId: messageId }).lean();
  if (!job) { logger.warn({ messageId }, 'receipt for unknown message'); return; }
  await NotificationLog.create({ jobId: job._id, type: 'receipt', detail: `${status}${error ? ' — ' + error : ''}` });
  if (!mapped || mapped === 'sent' || job.status === 'delivered') return;
  await NotificationJob.updateOne({ _id: job._id }, {
    $set: { status: mapped, ...(mapped === 'delivered' ? { deliveredAt: new Date() } : { lastError: error ?? status }) }, $inc: { version: 1 }
  });
}
