import { Router } from 'express';
import { z } from 'zod';
import { announcementSchema, attendancePolicySchema, schoolSettingsSchema, websiteSettingsSchema, type PublicConfig } from '@sms/shared';
import { APP_VERSION, env } from '../config/env.js';
import { SchoolSettings, Announcement } from '../models/index.js';
import { can } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, softDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings, invalidateSettings } from '../services/settings.js';
import { invalidateWebsiteCache } from '../services/website.js';
import { memoryUpload, removeUpload, saveImage } from '../services/uploads.js';
import { badRequest, h, ok, parse } from '../utils/http.js';
import { $cmp } from '../utils/query.js';

export const settingsRouter = Router();
export const publicRouter = Router();

/** Unauthenticated: branding needed to render the login page and the optional public website. */
publicRouter.get('/config', h(async (_req, res) => {
  const s = await getSettings();
  const cfg: PublicConfig = {
    schoolName: s.name, logoUrl: s.logoPath ?? null, faviconUrl: s.faviconPath ?? null,
    primaryColor: s.primaryColor, accentColor: s.accentColor, defaultLanguage: s.defaultLanguage as 'en' | 'ur',
    timeZone: s.timeZone, dateFormat: s.dateFormat, package: env.PACKAGE, mode: env.APP_MODE,
    websiteEnabled: Boolean(s.website?.enabled), registrationEnabled: env.REGISTRATION_ENABLED, version: APP_VERSION
  };
  ok(res, cfg);
}));

publicRouter.get('/website', h(async (_req, res) => {
  const s = await getSettings();
  if (!s.website?.enabled) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Website is not enabled' } });
  const announcements = s.website.showAnnouncements
    ? await Announcement.find({ deletedAt: null, publishedAt: $cmp({ ne: null, lte: new Date() }) }).sort({ pinned: -1, publishedAt: -1 }).limit(20).select('title body publishedAt pinned').lean()
    : [];
  ok(res, {
    name: s.name, description: s.description, logoUrl: s.logoPath, primaryColor: s.primaryColor, accentColor: s.accentColor,
    heroTitle: s.website.heroTitle, heroSubtitle: s.website.heroSubtitle, about: s.website.about,
    contact: s.website.showContact ? { address: s.address, phone: s.phone, email: s.email } : null,
    announcements
  });
}));

settingsRouter.get('/', can('settings.view'), h(async (_req, res) => {
  const s = await getSettings();
  ok(res, { ...s, package: env.PACKAGE, mode: env.APP_MODE, nodeId: env.NODE_ID });
}));

const updateSettings = async (patch: Record<string, unknown>, version?: number) => {
  const r = await updateVersioned(SchoolSettings, 'school', patch, {}, version);
  invalidateSettings();
  return r;
};

settingsRouter.patch('/profile', can('settings.manage'), h(async (req, res) => {
  const body = parse(schoolSettingsSchema.and(z.object({ version: z.number().int().optional() })), req.body);
  const { version, ...patch } = body;
  if (patch.timeZone) {
    try { new Intl.DateTimeFormat('en', { timeZone: patch.timeZone }); } catch { throw badRequest('Unknown time zone'); }
  }
  const r = await updateSettings(patch, version);
  await audit(req, 'settings.profile_updated', 'settings', 'school', { changed: Object.keys(patch) });
  ok(res, r);
}));

settingsRouter.patch('/attendance-policy', can('academic.manage'), h(async (req, res) => {
  const patch = parse(attendancePolicySchema, req.body);
  const s = await getSettings();
  const r = await updateSettings({ policy: { ...s.policy, ...patch } });
  await audit(req, 'settings.policy_updated', 'settings', 'school', patch);
  ok(res, r.policy);
}));

settingsRouter.patch('/website', can('website.manage'), h(async (req, res) => {
  const patch = parse(websiteSettingsSchema, req.body);
  const s = await getSettings();
  const r = await updateSettings({ website: { ...s.website, ...patch } });
  await audit(req, 'settings.website_updated', 'settings', 'school');
  ok(res, r.website);
}));

settingsRouter.patch('/student-fields', can('settings.manage'), h(async (req, res) => {
  const { fields } = parse(z.object({ fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_]{1,30}$/), label: z.string().min(1).max(60) })).max(20) }), req.body);
  if (new Set(fields.map((x) => x.key)).size !== fields.length) throw badRequest('Each custom field needs a unique key');
  const r = await updateSettings({ studentCustomFields: fields });
  await audit(req, 'settings.student_fields_updated', 'settings', 'school', { keys: fields.map((x) => x.key) });
  ok(res, r.studentCustomFields);
}));

settingsRouter.patch('/backup-schedule', can('backups.manage'), h(async (req, res) => {
  const body = parse(z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23), keepLast: z.number().int().min(1).max(365) }), req.body);
  const r = await updateSettings({ backupSchedule: body });
  await audit(req, 'settings.backup_schedule_updated', 'settings', 'school', body);
  ok(res, r.backupSchedule);
}));

const upload = memoryUpload(2 * 1024 * 1024);
settingsRouter.post('/branding/:kind', can('settings.manage'), upload.single('file'), h(async (req, res) => {
  const kind = z.enum(['logo', 'favicon']).parse(req.params.kind);
  if (!req.file) throw badRequest('No file uploaded');
  const p = await saveImage(req.file.buffer, 'branding', kind === 'favicon');
  const s = await getSettings();
  const field = kind === 'logo' ? 'logoPath' : 'faviconPath';
  await removeUpload(s[field]);
  await updateSettings({ [field]: p });
  await audit(req, `settings.${kind}_uploaded`, 'settings', 'school');
  ok(res, { path: p });
}));

// Announcements for the optional public website.

settingsRouter.get('/announcements', can('website.manage'), h(async (_req, res) => {
  ok(res, await Announcement.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean());
}));
settingsRouter.post('/announcements', can('website.manage'), h(async (req, res) => {
  const b = parse(announcementSchema, req.body);
  const a = await createVersioned(Announcement, { ...b, publishedAt: b.publishedAt ? new Date(b.publishedAt) : null, createdBy: req.user!.id });
  invalidateWebsiteCache();
  ok(res, a, undefined, 201);
}));
settingsRouter.patch('/announcements/:id', can('website.manage'), h(async (req, res) => {
  const b = parse(announcementSchema.partial(), req.body);
  const patch: Record<string, unknown> = { ...b };
  if (b.publishedAt !== undefined) patch.publishedAt = b.publishedAt ? new Date(b.publishedAt) : null;
  const updated = await updateVersioned(Announcement, z.string().uuid().parse(req.params.id), patch);
  invalidateWebsiteCache();
  ok(res, updated);
}));
settingsRouter.delete('/announcements/:id', can('website.manage'), h(async (req, res) => {
  await softDeleteVersioned(Announcement, z.string().uuid().parse(req.params.id));
  invalidateWebsiteCache();
  ok(res, { deleted: true });
}));
