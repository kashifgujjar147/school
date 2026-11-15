import { resolveTxt } from 'node:dns/promises';
import { randomBytes } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  ITEM_DETAIL_TYPES, ITEM_TYPES, SITE_PARTS, SITE_PART_KEYS, classifyMediaUrl, countMissingTranslations, domainSchema, itemSaveSchema,
  mediaListSchema, mediaRegisterSchema, mediaUpdateSchema, normalizeDomain, pageContentSchema, pageCreateSchema, pageSaveSchema,
  pageScheduleSchema, reorderSchema, siteContentSchema, stableEqual, type ItemType, type PageContent, type SiteContent, type SitePartKey
} from '@sms/shared';
import { env } from '../config/env.js';
import { WebsiteConfig, WebsiteInquiry, WebsiteItem, WebsiteMedia, WebsitePage, WebsiteRevision } from '../models/index.js';
import { can } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { cloudinaryConfigured, cloudinaryUploadTicket } from '../services/cloudinary.js';
import { createVersioned, softDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { removeUpload, storeWebsiteMedia, websiteUpload } from '../services/uploads.js';
import {
  assertMediaExists, canonicalBase, ensureWebsite, getConfig, invalidateWebsiteCache, itemSortDate, loadPage, mediaUsage, publicItem1,
  publishPage, publishSite, recordRevision, repointMedia, resolvePage, savePageDraft, siteBootstrap, uniqueItemSlug, uniquePageSlug, unpublishPage
} from '../services/website.js';
import { AppError, badRequest, conflict, escapeRegex, h, notFound, ok, pageArgs, parse } from '../utils/http.js';
import { $in } from '../utils/query.js';

/**
 * Website Management API (dashboard). Every route needs a signed-in user with `website.manage`;
 * anything that changes what the public sees (publish, unpublish, restore, domain) also needs
 * `website.publish`. This installation serves exactly one school, so all content in these
 * collections belongs to it: isolation between schools is enforced by the per-school database and
 * the install-identity check at startup (services/settings.ts).
 */
export const websiteRouter = Router();

const id = (v: unknown) => z.string().uuid().parse(v);
const actor = (req: Request) => ({ id: req.user!.id, fullName: req.user!.fullName });
const titleOf = (c: unknown) => { const t = (c as PageContent | null)?.title ?? {}; return t.en ?? Object.values(t)[0] ?? ''; };

websiteRouter.use(h(async (_req, _res, next) => { await ensureWebsite(); next(); }));

// ---------------------------------------------------------------------------- overview
websiteRouter.get('/overview', can('website.manage'), h(async (_req, res) => {
  const [settings, c, pages, itemCounts, media, inquiries] = await Promise.all([
    getSettings(), getConfig(),
    WebsitePage.find({ deletedAt: null }).select('status dirty scheduledAt').lean(),
    WebsiteItem.aggregate<{ _id: { type: string; status: string }; n: number }>([{ $match: { deletedAt: null } }, { $group: { _id: { type: '$type', status: '$status' }, n: { $sum: 1 } } }]),
    WebsiteMedia.countDocuments({ deletedAt: null, archivedAt: null }),
    WebsiteInquiry.countDocuments({ deletedAt: null, status: 'new' })
  ]);
  const items: Record<string, { published: number; total: number }> = {};
  for (const t of ITEM_TYPES) items[t] = { published: 0, total: 0 };
  for (const r of itemCounts) { const e = items[r._id.type]; if (e) { e.total += r.n; if (r._id.status === 'published') e.published += r.n; } }
  ok(res, {
    enabled: Boolean(settings.website?.enabled), publicUrl: `${canonicalBase(c.domain)}/site`,
    site: { dirty: c.dirty, publishedAt: c.publishedAt },
    pages: { total: pages.length, published: pages.filter((p) => p.status === 'published').length, unpublishedChanges: pages.filter((p) => p.status === 'published' && p.dirty).length, drafts: pages.filter((p) => p.status === 'draft').length, scheduled: pages.filter((p) => p.scheduledAt).length },
    items, media, newInquiries: inquiries, cloudinary: cloudinaryConfigured()
  });
}));

// ---------------------------------------------------------------------------- site-wide configuration (draft → publish)
websiteRouter.get('/site', can('website.manage'), h(async (_req, res) => {
  const c = await getConfig();
  ok(res, { draft: c.draft, published: c.published, dirty: c.dirty, publishedAt: c.publishedAt, version: c.version, domain: c.domain ?? null, canonicalBase: canonicalBase(c.domain), appUrl: env.APP_URL });
}));

websiteRouter.patch('/site/:part', can('website.manage'), h(async (req, res) => {
  const part = z.enum(SITE_PART_KEYS).parse(req.params.part) as SitePartKey;
  const body = parse(z.object({ value: z.unknown(), version: z.number().int().optional() }), req.body);
  const value = parse(SITE_PARTS[part], body.value);
  await assertMediaExists(value);
  const c = await getConfig();
  const draft = siteContentSchema.parse({ ...(c.draft as SiteContent), [part]: value });
  const r = await updateVersioned(WebsiteConfig, 'site', { draft, dirty: !c.published || !stableEqual(draft, c.published), updatedBy: req.user!.id }, {}, body.version);
  await audit(req, 'website.site_draft_saved', 'website', 'site', { part });
  ok(res, { draft: r.draft, dirty: r.dirty, version: r.version });
}));

websiteRouter.post('/site/publish', can('website.publish'), h(async (req, res) => {
  const r = await publishSite(actor(req));
  await audit(req, 'website.site_published', 'website', 'site');
  ok(res, { dirty: r.dirty, publishedAt: r.publishedAt, version: r.version });
}));

websiteRouter.post('/site/discard', can('website.manage'), h(async (req, res) => {
  const c = await getConfig();
  if (!c.published) throw badRequest('Nothing has been published yet');
  const r = await updateVersioned(WebsiteConfig, 'site', { draft: c.published, dirty: false, updatedBy: req.user!.id });
  await audit(req, 'website.site_draft_discarded', 'website', 'site');
  ok(res, { draft: r.draft, dirty: r.dirty, version: r.version });
}));

// ---------------------------------------------------------------------------- pages
const pageSummary = (p: { _id: string; slug: string; systemKey?: string | null; order: number; status: string; dirty: boolean; draft: unknown; publishedAt?: Date | null; scheduledAt?: Date | null; updatedAt?: Date; version: number }) => ({
  _id: p._id, slug: p.slug, system: Boolean(p.systemKey), order: p.order, status: p.status, dirty: p.dirty, title: (p.draft as PageContent).title,
  sections: (p.draft as PageContent).sections?.length ?? 0, publishedAt: p.publishedAt ?? null, scheduledAt: p.scheduledAt ?? null, updatedAt: p.updatedAt, version: p.version
});

websiteRouter.get('/pages', can('website.manage'), h(async (_req, res) => {
  const pages = await WebsitePage.find({ deletedAt: null }).sort({ order: 1, createdAt: 1 }).lean();
  ok(res, pages.map(pageSummary));
}));

websiteRouter.post('/pages', can('website.manage'), h(async (req, res) => {
  const b = parse(pageCreateSchema, req.body);
  if (await WebsitePage.exists({ slug: b.slug, deletedAt: null })) throw conflict('A page with this address already exists');
  const last = await WebsitePage.findOne({ deletedAt: null }).sort({ order: -1 }).select('order').lean();
  const draft = pageContentSchema.parse({ title: b.title, sections: [{ id: 'header', type: 'pageHeader', content: { heading: b.title } }] });
  const p = await createVersioned(WebsitePage, { slug: b.slug, order: (last?.order ?? 0) + 1, draft, createdBy: req.user!.id });
  await audit(req, 'website.page_created', 'websitepage', p._id, { slug: b.slug });
  ok(res, pageSummary(p.toObject()), undefined, 201);
}));

websiteRouter.post('/pages/reorder', can('website.manage'), h(async (req, res) => {
  const { ids } = parse(reorderSchema, req.body);
  const pages = await WebsitePage.find({ _id: $in(ids), deletedAt: null }).select('_id order').lean();
  const known = new Map(pages.map((p) => [p._id, p.order]));
  let order = 0;
  for (const pid of ids) { if (!known.has(pid)) continue; if (known.get(pid) !== order) await updateVersioned(WebsitePage, pid, { order }); order += 1; }
  invalidateWebsiteCache();
  ok(res, { reordered: order });
}));

websiteRouter.get('/pages/:id', can('website.manage'), h(async (req, res) => {
  const p = await loadPage(id(req.params.id));
  ok(res, { ...pageSummary(p), draft: p.draft, hasPublished: Boolean(p.published) });
}));

websiteRouter.patch('/pages/:id', can('website.manage'), h(async (req, res) => {
  const b = parse(pageSaveSchema, req.body);
  await assertMediaExists(b.content);
  const p = await savePageDraft(id(req.params.id), b.content as PageContent, actor(req), { slug: b.slug, version: b.version });
  await audit(req, 'website.page_draft_saved', 'websitepage', p._id, { slug: p.slug });
  ok(res, { ...pageSummary(p.toObject()), draft: p.draft, hasPublished: Boolean(p.published) });
}));

websiteRouter.post('/pages/:id/duplicate', can('website.manage'), h(async (req, res) => {
  const src = await loadPage(id(req.params.id));
  const draft = pageContentSchema.parse(src.draft);
  for (const k of Object.keys(draft.title)) draft.title[k] = `${draft.title[k]} (copy)`.slice(0, 160);
  const last = await WebsitePage.findOne({ deletedAt: null }).sort({ order: -1 }).select('order').lean();
  const p = await createVersioned(WebsitePage, { slug: await uniquePageSlug(`${src.slug}-copy`), order: (last?.order ?? 0) + 1, draft, createdBy: req.user!.id });
  await audit(req, 'website.page_duplicated', 'websitepage', p._id, { from: src.slug });
  ok(res, pageSummary(p.toObject()), undefined, 201);
}));

websiteRouter.post('/pages/:id/publish', can('website.publish'), h(async (req, res) => {
  const p = await publishPage(id(req.params.id), actor(req));
  await audit(req, 'website.page_published', 'websitepage', p._id, { slug: p.slug });
  ok(res, pageSummary(p.toObject()));
}));

websiteRouter.post('/pages/:id/unpublish', can('website.publish'), h(async (req, res) => {
  const p = await unpublishPage(id(req.params.id), actor(req));
  await audit(req, 'website.page_unpublished', 'websitepage', p._id, { slug: p.slug });
  ok(res, pageSummary(p.toObject()));
}));

websiteRouter.post('/pages/:id/schedule', can('website.publish'), h(async (req, res) => {
  const { at } = parse(pageScheduleSchema, req.body);
  if (at && Date.parse(at) <= Date.now()) throw badRequest('Choose a time in the future');
  const p = await updateVersioned(WebsitePage, id(req.params.id), { scheduledAt: at ? new Date(at) : null });
  await audit(req, at ? 'website.page_scheduled' : 'website.page_schedule_cleared', 'websitepage', p._id, { at });
  ok(res, pageSummary(p.toObject()));
}));

websiteRouter.post('/pages/:id/discard', can('website.manage'), h(async (req, res) => {
  const cur = await loadPage(id(req.params.id));
  if (!cur.published) throw badRequest('This page has never been published, so there is no published version to go back to');
  const p = await updateVersioned(WebsitePage, cur._id, { draft: cur.published, dirty: false, updatedBy: req.user!.id });
  ok(res, { ...pageSummary(p.toObject()), draft: p.draft, hasPublished: true });
}));

websiteRouter.delete('/pages/:id', can('website.publish'), h(async (req, res) => {
  const p = await loadPage(id(req.params.id));
  if (p.systemKey) throw badRequest('Built-in pages cannot be deleted. Unpublish the page instead.');
  // Soft delete: the document and its revisions stay in the database; the address becomes free again.
  await updateVersioned(WebsitePage, p._id, { status: 'archived', published: null, scheduledAt: null, deletedAt: new Date() });
  invalidateWebsiteCache();
  await audit(req, 'website.page_archived', 'websitepage', p._id, { slug: p.slug });
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------------------- revision history
websiteRouter.get('/revisions', can('website.manage'), h(async (req, res) => {
  const q = parse(z.object({ scope: z.enum(['page', 'site']).optional(), pageId: z.string().uuid().optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.scope) filter.scope = q.scope;
  if (q.pageId) filter.pageId = q.pageId;
  ok(res, await WebsiteRevision.find(filter).sort({ createdAt: -1 }).limit(200).select('-snapshot').lean());
}));

/** Restores a previous version INTO THE DRAFT. Nothing changes publicly until the draft is published. */
websiteRouter.post('/revisions/:id/restore', can('website.publish'), h(async (req, res) => {
  const rev = await WebsiteRevision.findById(id(req.params.id)).lean();
  if (!rev || rev.deletedAt) throw notFound('Revision not found');
  if (rev.scope === 'site') {
    const draft = siteContentSchema.parse(rev.snapshot);
    const c = await getConfig();
    await updateVersioned(WebsiteConfig, 'site', { draft, dirty: !stableEqual(draft, c.published), updatedBy: req.user!.id });
    await recordRevision('site', 'restore', draft, actor(req));
  } else {
    const p = await loadPage(String(rev.pageId));
    const content = pageContentSchema.parse((rev.snapshot as { content: unknown }).content) as PageContent;
    await savePageDraft(p._id, content, actor(req));
    await recordRevision('page', 'restore', { slug: p.slug, content }, actor(req), { _id: p._id, slug: p.slug, title: titleOf(content) });
  }
  await audit(req, 'website.revision_restored', 'websiterevision', rev._id, { scope: rev.scope, pageSlug: rev.pageSlug });
  ok(res, { restored: true, scope: rev.scope, pageId: rev.pageId ?? null });
}));

// ---------------------------------------------------------------------------- content collections
websiteRouter.get('/items', can('website.manage'), h(async (req, res) => {
  const q = parse(z.object({ type: z.enum(ITEM_TYPES) }), req.query);
  ok(res, await WebsiteItem.find({ type: q.type, deletedAt: null }).sort({ order: 1, createdAt: -1 }).limit(500).lean());
}));

websiteRouter.post('/items', can('website.manage'), h(async (req, res) => {
  const b = parse(itemSaveSchema, req.body);
  if (b.status === 'published' && !req.user!.permissions.includes('website.publish')) throw new AppError(403, 'FORBIDDEN', 'You can save drafts, but publishing needs the "publish website" permission');
  await assertMediaExists(b.data);
  const title = (b.data.title as Record<string, string>);
  const slug = await uniqueItemSlug(b.type, b.slug || title.en || Object.values(title)[0] || b.type);
  const first = await WebsiteItem.findOne({ type: b.type, deletedAt: null }).sort({ order: 1 }).select('order').lean();
  const item = await createVersioned(WebsiteItem, {
    type: b.type, slug, status: b.status, featured: b.featured, group: b.group, data: b.data, order: (first?.order ?? 0) - 1,
    date: itemSortDate(b.type, b.data), publishedAt: b.status === 'published' ? new Date() : null, createdBy: req.user!.id
  });
  invalidateWebsiteCache();
  await audit(req, 'website.item_created', 'websiteitem', item._id, { type: b.type, slug });
  ok(res, item, undefined, 201);
}));

websiteRouter.post('/items/reorder', can('website.manage'), h(async (req, res) => {
  const { ids } = parse(reorderSchema, req.body);
  const rows = await WebsiteItem.find({ _id: $in(ids), deletedAt: null }).select('_id order').lean();
  const known = new Map(rows.map((r) => [r._id, r.order]));
  let order = 0;
  for (const iid of ids) { if (!known.has(iid)) continue; if (known.get(iid) !== order) await updateVersioned(WebsiteItem, iid, { order }); order += 1; }
  invalidateWebsiteCache();
  ok(res, { reordered: order });
}));

websiteRouter.patch('/items/:id', can('website.manage'), h(async (req, res) => {
  const b = parse(itemSaveSchema, req.body);
  const cur = await WebsiteItem.findById(id(req.params.id)).lean();
  if (!cur || cur.deletedAt) throw notFound();
  if (cur.type !== b.type) throw badRequest('The type of an item cannot be changed');
  const visibilityChange = (cur.status === 'published') !== (b.status === 'published');
  if ((visibilityChange || cur.status === 'published') && !req.user!.permissions.includes('website.publish')) throw new AppError(403, 'FORBIDDEN', 'Changing published content needs the "publish website" permission');
  await assertMediaExists(b.data);
  const patch: Record<string, unknown> = { status: b.status, featured: b.featured, group: b.group, data: b.data, date: itemSortDate(b.type as ItemType, b.data), updatedBy: req.user!.id };
  if (b.slug && b.slug !== cur.slug) patch.slug = await uniqueItemSlug(b.type, b.slug, cur._id);
  if (b.status === 'published' && !cur.publishedAt) patch.publishedAt = new Date();
  const item = await updateVersioned(WebsiteItem, cur._id, patch, {}, b.version);
  invalidateWebsiteCache();
  await audit(req, 'website.item_updated', 'websiteitem', cur._id, { type: cur.type, status: b.status });
  ok(res, item);
}));

websiteRouter.delete('/items/:id', can('website.publish'), h(async (req, res) => {
  const cur = await WebsiteItem.findById(id(req.params.id)).select('type slug deletedAt').lean();
  if (!cur || cur.deletedAt) throw notFound();
  await softDeleteVersioned(WebsiteItem, cur._id);
  invalidateWebsiteCache();
  await audit(req, 'website.item_deleted', 'websiteitem', cur._id, { type: cur.type, slug: cur.slug });
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------------------- media library
websiteRouter.get('/media/config', can('website.manage'), h(async (_req, res) => {
  ok(res, { cloudinary: cloudinaryConfigured(), cloudName: cloudinaryConfigured() ? env.CLOUDINARY_CLOUD_NAME : null, imageMaxMb: env.WEBSITE_IMAGE_MAX_MB, videoMaxMb: env.WEBSITE_VIDEO_MAX_MB });
}));

websiteRouter.get('/media', can('website.manage'), h(async (req, res) => {
  const q = parse(mediaListSchema, req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.archived === 'false') filter.archivedAt = null;
  if (q.kind) filter.kind = q.kind;
  if (q.category) filter.category = q.category;
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ title: rx }, { originalName: rx }, { category: rx }]; }
  const [items, total, categories] = await Promise.all([
    WebsiteMedia.find(filter).sort({ createdAt: -1 }).skip(pageArgs(q).skip).limit(pageArgs(q).limit).lean(),
    WebsiteMedia.countDocuments(filter),
    WebsiteMedia.distinct('category', { deletedAt: null })
  ]);
  res.json({ ok: true, data: items, meta: { page: q.page, pageSize: q.pageSize, total, categories: (categories as string[]).filter(Boolean).sort() } });
}));

/** Runs multer and turns its errors (too large, wrong field) into clean 4xx responses. */
function receiveFile(req: Request, res: Response, next: NextFunction) {
  websiteUpload().single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code;
    next(code === 'LIMIT_FILE_SIZE' ? new AppError(413, 'TOO_LARGE', `The file is too large (maximum ${Math.max(env.WEBSITE_IMAGE_MAX_MB, env.WEBSITE_VIDEO_MAX_MB)} MB)`) : badRequest('Upload failed: send one file in the "file" field'));
  });
}
const uploadMeta = z.object({
  title: z.string().trim().max(160).default(''), category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9 _-]*$/).default(''),
  width: z.coerce.number().int().min(1).max(20000).optional(), height: z.coerce.number().int().min(1).max(20000).optional()
});

websiteRouter.post('/media/upload', can('website.manage'), receiveFile, h(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  const stored = await storeWebsiteMedia(req.file.path); // validates real type + size; removes the temp file on failure
  let meta;
  try { meta = parse(uploadMeta, req.body); } catch (e) { await removeUpload(stored.url); throw e; }
  const originalName = String(req.file.originalname ?? '').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const m = await createVersioned(WebsiteMedia, { kind: stored.kind, provider: 'local', source: 'upload', url: stored.url, mime: stored.mime, sizeBytes: stored.sizeBytes, originalName, title: meta.title || originalName.replace(/\.[a-z0-9]+$/i, ''), category: meta.category, width: meta.width, height: meta.height, createdBy: req.user!.id });
  await audit(req, 'website.media_uploaded', 'websitemedia', m._id, { kind: stored.kind, sizeBytes: stored.sizeBytes });
  ok(res, m, undefined, 201);
}));

websiteRouter.post('/media/cloudinary-ticket', can('website.manage'), h(async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(['image', 'video']) }), req.body);
  if (!cloudinaryConfigured()) throw new AppError(409, 'NOT_CONFIGURED', 'Cloudinary is not configured on this server. Files will be stored on the school server instead.');
  ok(res, cloudinaryUploadTicket(kind));
}));

/** Registers a media URL (pasted Cloudinary / YouTube / Vimeo link, or the result of a direct Cloudinary upload). The URL is validated, never fetched. */
websiteRouter.post('/media/register', can('website.manage'), h(async (req, res) => {
  const b = parse(mediaRegisterSchema.extend({ uploaded: z.boolean().default(false), sizeBytes: z.number().int().min(0).optional(), width: z.number().int().min(1).max(20000).optional(), height: z.number().int().min(1).max(20000).optional(), durationSec: z.number().min(0).max(86400).optional() }), req.body);
  const c = classifyMediaUrl(b.url);
  if (!c.ok) throw badRequest(c.reason);
  const existing = await WebsiteMedia.findOne({ url: c.url, deletedAt: null }).lean();
  if (existing) { ok(res, existing); return; }
  const fromOwnCloud = c.provider === 'cloudinary' && cloudinaryConfigured() && c.cloudName === env.CLOUDINARY_CLOUD_NAME;
  const m = await createVersioned(WebsiteMedia, {
    kind: c.kind, provider: c.provider, source: b.uploaded && fromOwnCloud ? 'cloudinary_upload' : 'url', url: c.url,
    publicId: c.provider === 'cloudinary' ? c.publicId : c.videoId, embedUrl: c.provider === 'cloudinary' ? undefined : c.embedUrl,
    title: b.title || (c.provider === 'cloudinary' ? c.publicId.split('/').pop() : `${c.provider} video`), category: b.category,
    sizeBytes: b.sizeBytes, width: b.width, height: b.height, durationSec: b.durationSec, createdBy: req.user!.id
  });
  await audit(req, 'website.media_registered', 'websitemedia', m._id, { provider: c.provider, kind: c.kind });
  ok(res, m, undefined, 201);
}));

websiteRouter.get('/media/:id/usage', can('website.manage'), h(async (req, res) => {
  ok(res, await mediaUsage(id(req.params.id)));
}));

websiteRouter.patch('/media/:id', can('website.manage'), h(async (req, res) => {
  const { archived, ...b } = parse(mediaUpdateSchema, req.body);
  const patch: Record<string, unknown> = { ...b };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  ok(res, await updateVersioned(WebsiteMedia, id(req.params.id), patch));
}));

/** Replaces the file behind an asset (same kind). Every page, setting and item that uses it is repointed. */
websiteRouter.post('/media/:id/replace', can('website.publish'), receiveFile, h(async (req, res) => {
  const cur = await WebsiteMedia.findById(id(req.params.id)).lean();
  if (!cur || cur.deletedAt) { if (req.file) await removeUpload(`/uploads/website/.tmp/${req.file.filename}`); throw notFound(); }
  let next: { url: string; kind: 'image' | 'video'; provider: 'local' | 'cloudinary' | 'youtube' | 'vimeo'; mime?: string; sizeBytes?: number; publicId?: string; embedUrl?: string };
  if (req.file) {
    const stored = await storeWebsiteMedia(req.file.path);
    next = { ...stored, provider: 'local' };
  } else {
    const c = classifyMediaUrl(parse(z.object({ url: z.string().trim().min(10).max(1000) }), req.body).url);
    if (!c.ok) throw badRequest(c.reason);
    next = { url: c.url, kind: c.kind, provider: c.provider, publicId: c.provider === 'cloudinary' ? c.publicId : c.videoId, embedUrl: c.provider === 'cloudinary' ? undefined : c.embedUrl };
  }
  if (next.kind !== cur.kind) { if (next.provider === 'local') await removeUpload(next.url); throw badRequest(`This asset is ${cur.kind === 'image' ? 'an image' : 'a video'}; replace it with the same kind of file`); }
  const m = await updateVersioned(WebsiteMedia, cur._id, { url: next.url, provider: next.provider, source: req.file ? 'upload' : 'url', mime: next.mime ?? null, sizeBytes: next.sizeBytes ?? null, publicId: next.publicId ?? null, embedUrl: next.embedUrl ?? null, width: null, height: null });
  const updated = await repointMedia(cur._id, { url: next.url, provider: next.provider, kind: next.kind });
  if (cur.provider === 'local' && cur.url !== next.url) await removeUpload(cur.url);
  await audit(req, 'website.media_replaced', 'websitemedia', cur._id, { referencesUpdated: updated });
  ok(res, { media: m, referencesUpdated: updated });
}));

websiteRouter.delete('/media/:id', can('website.publish'), h(async (req, res) => {
  const cur = await WebsiteMedia.findById(id(req.params.id)).lean();
  if (!cur || cur.deletedAt) throw notFound();
  const usage = await mediaUsage(cur._id);
  if (usage.length) throw conflict('This file is still used on the website. Remove it from those places first, or archive it to hide it from the library.', { usage });
  await softDeleteVersioned(WebsiteMedia, cur._id);
  if (cur.provider === 'local') await removeUpload(cur.url);
  await audit(req, 'website.media_deleted', 'websitemedia', cur._id);
  ok(res, { deleted: true });
}));

// ---------------------------------------------------------------------------- inquiries (public forms inbox)
websiteRouter.get('/inquiries', can('website.manage'), h(async (req, res) => {
  const q = parse(z.object({ status: z.enum(['new', 'read', 'closed']).optional(), kind: z.enum(['contact', 'admission']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.status) filter.status = q.status;
  if (q.kind) filter.kind = q.kind;
  const [rows, total] = await Promise.all([WebsiteInquiry.find(filter).sort({ createdAt: -1 }).skip(pageArgs(q).skip).limit(pageArgs(q).limit).lean(), WebsiteInquiry.countDocuments(filter)]);
  ok(res, rows, { page: q.page, pageSize: q.pageSize, total });
}));

websiteRouter.patch('/inquiries/:id', can('website.manage'), h(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['new', 'read', 'closed']) }), req.body);
  ok(res, await updateVersioned(WebsiteInquiry, id(req.params.id), { status, handledBy: req.user!.id }));
}));

// ---------------------------------------------------------------------------- translation report
websiteRouter.get('/translations', can('website.manage'), h(async (_req, res) => {
  const c = await getConfig();
  const site = c.draft as SiteContent;
  const def = site.languages.default;
  const [pages, items] = await Promise.all([WebsitePage.find({ deletedAt: null }).sort({ order: 1 }).select('slug draft status').lean(), WebsiteItem.find({ deletedAt: null }).select('type slug data status').lean()]);
  const report = site.languages.enabled.filter((l) => l !== def).map((lang) => {
    const rows = [
      { kind: 'site', id: 'site', label: 'Navigation, footer, contact & SEO', status: 'published', ...countMissingTranslations({ ...site, theme: null }, lang, def) },
      ...pages.map((p) => ({ kind: 'page', id: p._id, label: titleOf(p.draft) || p.slug, status: p.status, ...countMissingTranslations(p.draft, lang, def) })),
      ...items.map((i) => ({ kind: i.type, id: i._id, label: titleOf(i.data) || i.slug, status: i.status, ...countMissingTranslations(i.data, lang, def) }))
    ].filter((r) => r.total > 0);
    return { lang, total: rows.reduce((n, r) => n + r.total, 0), missing: rows.reduce((n, r) => n + r.missing, 0), rows };
  });
  ok(res, { default: def, enabled: site.languages.enabled, report });
}));

// ---------------------------------------------------------------------------- custom domain
const TXT_PREFIX = 'school-site-verification=';

websiteRouter.put('/domain', can('website.publish'), h(async (req, res) => {
  const { domain: raw } = parse(domainSchema, req.body);
  await getConfig();
  if (!raw) {
    await updateVersioned(WebsiteConfig, 'site', { domain: null });
    invalidateWebsiteCache();
    await audit(req, 'website.domain_removed', 'website', 'site');
    ok(res, { domain: null }); return;
  }
  const domain = normalizeDomain(raw);
  if (!domain) throw badRequest('Enter a public domain name such as www.yourschool.edu (no http://, no path)');
  const value = { domain, token: randomBytes(16).toString('hex'), status: 'unverified', checkedAt: null, lastError: null };
  await updateVersioned(WebsiteConfig, 'site', { domain: value });
  invalidateWebsiteCache();
  await audit(req, 'website.domain_set', 'website', 'site', { domain });
  ok(res, { domain: { ...value, txtName: `_school-site.${domain}`, txtValue: TXT_PREFIX + value.token } });
}));

/**
 * Checks domain ownership with a DNS TXT lookup only (no HTTP request is made to the domain).
 * Verification does NOT configure DNS or TLS: pointing the domain at this server and issuing a
 * certificate are done at the DNS provider / reverse proxy (see docs/website/website-cms.md).
 */
websiteRouter.post('/domain/verify', can('website.publish'), h(async (req, res) => {
  const c = await getConfig();
  const d = c.domain as { domain: string; token: string } | null;
  if (!d?.domain) throw badRequest('Set a custom domain first');
  let status: 'verified' | 'failed' = 'failed'; let lastError: string | null = null;
  try {
    const records = await Promise.race([resolveTxt(`_school-site.${d.domain}`), new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('DNS lookup timed out')), 8000))]);
    if (records.some((chunks) => chunks.join('') === TXT_PREFIX + d.token)) status = 'verified';
    else lastError = 'The TXT record was found but its value does not match';
  } catch (e) {
    const code = (e as { code?: string }).code;
    lastError = code === 'ENOTFOUND' || code === 'ENODATA' ? 'No TXT record found yet. DNS changes can take up to 48 hours.' : (e as Error).message;
  }
  const value = { ...d, status, checkedAt: new Date(), lastError };
  await updateVersioned(WebsiteConfig, 'site', { domain: value });
  invalidateWebsiteCache();
  await audit(req, 'website.domain_verified', 'website', 'site', { domain: d.domain, status });
  ok(res, { domain: { ...value, txtName: `_school-site.${d.domain}`, txtValue: TXT_PREFIX + d.token } });
}));

// ---------------------------------------------------------------------------- draft preview (never public)
websiteRouter.get('/preview/bootstrap', can('website.manage'), h(async (_req, res) => {
  ok(res, await siteBootstrap('draft'));
}));

websiteRouter.get('/preview/pages/:slug', can('website.manage'), h(async (req, res) => {
  const slug = z.string().max(80).parse(req.params.slug);
  const p = await WebsitePage.findOne({ slug, deletedAt: null }).lean();
  if (!p) throw notFound('Page not found');
  ok(res, { slug: p.slug, status: p.status, ...(await resolvePage(pageContentSchema.parse(p.draft) as PageContent)) });
}));

/** Live preview of UNSAVED editor content: validates it and attaches collection data. Nothing is stored. */
websiteRouter.post('/preview/resolve', can('website.manage'), h(async (req, res) => {
  const content = parse(pageContentSchema, (req.body as { content?: unknown })?.content) as PageContent;
  ok(res, { slug: 'preview', status: 'draft', ...(await resolvePage(content)) });
}));

websiteRouter.get('/preview/items/:type/:slug', can('website.manage'), h(async (req, res) => {
  const type = z.enum(ITEM_TYPES).parse(req.params.type);
  if (!ITEM_DETAIL_TYPES.includes(type)) throw notFound();
  const i = await WebsiteItem.findOne({ type, slug: z.string().max(80).parse(req.params.slug), deletedAt: null }).lean();
  if (!i) throw notFound();
  ok(res, (i.status === 'published' ? await publicItem1(type, i.slug) : null) ?? { id: i._id, type: i.type, slug: i.slug, featured: i.featured, group: i.group, date: i.date, hasDetail: true, data: i.data });
}));
