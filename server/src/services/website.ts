import { randomUUID } from 'node:crypto';
import {
  ITEM_DATA, ITEM_DETAIL_TYPES, collectMediaIds, defaultPages, defaultSiteContent, pageContentSchema, patchMediaRefs,
  siteContentSchema, slugify, stableEqual, type ItemType, type MediaRef, type PageContent, type Section, type SiteContent
} from '@sms/shared';
import { env, isTest } from '../config/env.js';
import { Announcement, SchoolClass, Student, User, WebsiteConfig, WebsiteItem, WebsiteMedia, WebsitePage, WebsiteRevision } from '../models/index.js';
import { createVersioned, hardDeleteVersioned, updateVersioned } from './repo.js';
import { getSettings } from './settings.js';
import { badRequest, notFound } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { $cmp, $in } from '../utils/query.js';

/**
 * Website CMS domain logic. Routes stay thin; everything that decides WHAT is public lives here:
 *  - public readers only ever touch `published` content and `status: 'published'` items;
 *  - drafts are reachable only through the authenticated preview functions;
 *  - every publish / restore writes a revision so a previous version can be brought back.
 */

export interface Actor { id: string; fullName: string }
const REVISIONS_KEPT = 30;

// ---------------------------------------------------------------------------- small TTL cache (public reads)
const cache = new Map<string, { at: number; value: unknown }>();
const TTL = isTest ? 0 : 15_000;
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const value = await load();
  if (TTL > 0) { if (cache.size > 500) cache.clear(); cache.set(key, { at: Date.now(), value }); }
  return value;
}
export function invalidateWebsiteCache() { cache.clear(); }

// ---------------------------------------------------------------------------- first use
let seeding: Promise<void> | null = null;

/**
 * Creates the site configuration and the starter pages the first time the website module is used.
 * Additive and idempotent: it only inserts into the new website collections, and only when they are
 * empty. Existing school data is read (name, colours, old website text) but never modified.
 */
export async function ensureWebsite(): Promise<void> {
  if (await WebsiteConfig.exists({ _id: 'site' })) return;
  seeding ??= seed().finally(() => { seeding = null; });
  await seeding;
}

async function seed() {
  const s = await getSettings();
  const input = {
    name: s.name, description: s.description, address: s.address, phone: s.phone, email: s.email,
    primaryColor: s.primaryColor, accentColor: s.accentColor, defaultLanguage: s.defaultLanguage,
    heroTitle: s.website?.heroTitle, heroSubtitle: s.website?.heroSubtitle, about: s.website?.about,
    showContact: s.website?.showContact, showAnnouncements: s.website?.showAnnouncements
  };
  const site = siteContentSchema.parse(defaultSiteContent(input));
  try {
    await createVersioned(WebsiteConfig, { _id: 'site', draft: site, published: site, dirty: false, publishedAt: new Date() });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return; // another request / node seeded first
    throw e;
  }
  if (await WebsitePage.exists({})) return;
  for (const p of defaultPages(input)) {
    const draft = pageContentSchema.parse(p.draft);
    const published = p.published ? pageContentSchema.parse(p.published) : null;
    try {
      await createVersioned(WebsitePage, {
        slug: p.slug, systemKey: p.systemKey, order: p.order, draft, published,
        status: published ? 'published' : 'draft', dirty: !published || !stableEqual(draft, published),
        publishedAt: published ? new Date() : null
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }
  }
  invalidateWebsiteCache();
  logger.info('website starter content created');
}

export async function getConfig() {
  await ensureWebsite();
  const c = await WebsiteConfig.findById('site').lean();
  if (!c) throw new Error('Website configuration is missing');
  return c;
}

/** Base URL used for canonical links, the sitemap and Open Graph. A custom domain counts only once verified. */
export function canonicalBase(domain: unknown): string {
  const d = domain as { domain?: string; status?: string } | null;
  return d?.domain && d.status === 'verified' ? `https://${d.domain}` : env.APP_URL.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------- revisions
export async function recordRevision(scope: 'page' | 'site', action: 'publish' | 'unpublish' | 'restore', snapshot: unknown, actor: Actor | null, page?: { _id: string; slug: string; title?: string }) {
  await createVersioned(WebsiteRevision, {
    scope, action, snapshot, pageId: page?._id ?? null, pageSlug: page?.slug, title: page?.title,
    createdBy: actor?.id, createdByName: actor?.fullName ?? 'Scheduled publishing'
  });
  const old = await WebsiteRevision.find({ scope, pageId: page?._id ?? null, deletedAt: null }).sort({ createdAt: -1 }).skip(REVISIONS_KEPT).select('_id').lean();
  for (const r of old) await hardDeleteVersioned(WebsiteRevision, r._id);
}

// ---------------------------------------------------------------------------- pages
export async function loadPage(id: string) {
  const p = await WebsitePage.findById(id).lean();
  if (!p || p.deletedAt) throw notFound('Page not found');
  return p;
}

export async function savePageDraft(id: string, content: PageContent, actor: Actor, opts: { slug?: string; version?: number } = {}) {
  const p = await loadPage(id);
  const patch: Record<string, unknown> = { draft: content, dirty: !p.published || !stableEqual(content, p.published), updatedBy: actor.id };
  if (opts.slug && opts.slug !== p.slug) {
    if (p.systemKey) throw badRequest('The address of a built-in page cannot be changed');
    patch.slug = opts.slug;
  }
  return updateVersioned(WebsitePage, id, patch, {}, opts.version);
}

export async function publishPage(id: string, actor: Actor | null) {
  const p = await loadPage(id);
  // Re-validate: a draft written by an older version must still be safe to show publicly.
  const content = pageContentSchema.parse(p.draft);
  const updated = await updateVersioned(WebsitePage, id, { published: content, draft: content, status: 'published', dirty: false, publishedAt: new Date(), publishedBy: actor?.id, scheduledAt: null });
  await recordRevision('page', 'publish', { slug: p.slug, content }, actor, { _id: id, slug: p.slug, title: content.title.en ?? Object.values(content.title)[0] });
  invalidateWebsiteCache();
  return updated;
}

export async function unpublishPage(id: string, actor: Actor) {
  const p = await loadPage(id);
  if (p.systemKey === 'home') throw badRequest('The home page cannot be unpublished. To take the whole website offline, switch it off in Website settings.');
  if (p.published) await recordRevision('page', 'unpublish', { slug: p.slug, content: p.published }, actor, { _id: id, slug: p.slug });
  const updated = await updateVersioned(WebsitePage, id, { published: null, status: 'draft', dirty: true, publishedAt: null, scheduledAt: null });
  invalidateWebsiteCache();
  return updated;
}

/** Background job: publishes drafts whose scheduled time has arrived. */
export async function publishDueScheduledPages(now = new Date()): Promise<number> {
  const due = await WebsitePage.find({ deletedAt: null, scheduledAt: $cmp({ ne: null, lte: now }) }).select('_id').lean();
  let n = 0;
  for (const p of due) {
    try { await publishPage(p._id, null); n += 1; } catch (err) {
      logger.error({ err, pageId: p._id }, 'scheduled publish failed');
      await WebsitePage.updateOne({ _id: p._id }, { $set: { scheduledAt: null } });
    }
  }
  return n;
}

export async function uniquePageSlug(base: string): Promise<string> {
  const root = slugify(base) || 'page';
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await WebsitePage.exists({ slug, deletedAt: null }))) return slug;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------- site configuration
export async function publishSite(actor: Actor) {
  const c = await getConfig();
  const content = siteContentSchema.parse(c.draft);
  const updated = await updateVersioned(WebsiteConfig, 'site', { draft: content, published: content, dirty: false, publishedAt: new Date(), publishedBy: actor.id });
  await recordRevision('site', 'publish', content, actor);
  invalidateWebsiteCache();
  return updated;
}

// ---------------------------------------------------------------------------- items
export function itemSortDate(type: ItemType, data: Record<string, unknown>): Date | null {
  const raw = type === 'news' ? data.date : type === 'event' ? data.startAt : null;
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function uniqueItemSlug(type: ItemType, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || type;
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const hit = await WebsiteItem.findOne({ type, slug, deletedAt: null }).select('_id').lean();
    if (!hit || hit._id === exceptId) return slug;
  }
  return `${root}-${randomUUID().slice(0, 8)}`;
}

type ItemDoc = { _id: string; type: string; slug: string; featured: boolean; group: string; date: Date | null; data: Record<string, unknown>; publishedAt: Date | null };
const HEAVY_FIELDS = ['body'];

/** Public shape of an item. Lists drop long body text; detail pages keep it. */
function publicItem(i: ItemDoc, full: boolean) {
  const data = { ...i.data };
  if (!full) {
    for (const k of HEAVY_FIELDS) delete data[k];
    if (i.type === 'album' && Array.isArray(data.media)) { data.count = data.media.length; data.media = (data.media as unknown[]).slice(0, 1); }
  }
  return { id: i._id, type: i.type, slug: i.slug, featured: i.featured, group: i.group, date: i.date, hasDetail: ITEM_DETAIL_TYPES.includes(i.type as ItemType), data };
}

export async function publicItems(q: { type: ItemType; group?: string; featuredOnly?: boolean; limit: number }) {
  const filter: Record<string, unknown> = { type: q.type, status: 'published', deletedAt: null };
  if (q.group) filter.group = q.group;
  if (q.featuredOnly) filter.featured = true;
  const sort: Record<string, 1 | -1> = q.type === 'news' ? { date: -1, createdAt: -1 } : q.type === 'event' ? { date: 1 } : { order: 1, createdAt: -1 };
  let rows = await WebsiteItem.find(filter).sort(sort).limit(q.type === 'event' ? 200 : q.limit).lean<ItemDoc[]>();
  if (q.type === 'event') {
    // Upcoming events first (soonest first), then past events (most recent first).
    const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
    const upcoming = rows.filter((r) => r.date && r.date >= startOfToday);
    const past = rows.filter((r) => !r.date || r.date < startOfToday).reverse();
    rows = [...upcoming, ...past].slice(0, q.limit);
  }
  return rows.map((r) => publicItem(r, false));
}

export async function publicItem1(type: ItemType, slug: string) {
  const i = await WebsiteItem.findOne({ type, slug, status: 'published', deletedAt: null }).lean<ItemDoc>();
  return i ? publicItem(i, true) : null;
}

// ---------------------------------------------------------------------------- resolving a page for rendering
async function liveCounts() {
  const [students, teachers, classes] = await Promise.all([
    Student.countDocuments({ status: 'active', deletedAt: null }),
    User.countDocuments({ role: 'teacher', status: 'active', deletedAt: null }),
    SchoolClass.countDocuments({ archived: false, deletedAt: null })
  ]);
  return { students, teachers, classes };
}

/**
 * Attaches the data a page needs to render in one response: items for collection sections, the
 * announcements feed, and live counts for statistics that are bound to real school records.
 * Only published items / announcements are ever attached, including in draft previews.
 */
export async function resolvePage(content: PageContent, opts: { includeHidden?: boolean } = {}) {
  const sections = opts.includeHidden ? content.sections : content.sections.filter((s) => s.visible);
  const collections: Record<string, unknown[]> = {};
  let announcements: unknown[] | undefined;
  let stats: Awaited<ReturnType<typeof liveCounts>> | undefined;
  for (const s of sections as Section[]) {
    if (s.type === 'collection') {
      collections[s.id] = await publicItems({ type: s.content.itemType, group: s.content.group || undefined, featuredOnly: s.content.featuredOnly, limit: s.content.limit });
    } else if (s.type === 'announcements' && !announcements) {
      const settings = await getSettings();
      announcements = settings.website?.showAnnouncements === false ? [] : await Announcement.find({ deletedAt: null, publishedAt: $cmp({ ne: null, lte: new Date() }) })
        .sort({ pinned: -1, publishedAt: -1 }).limit(20).select('title body publishedAt pinned').lean();
    } else if (s.type === 'stats' && !stats && (s.content.items as { source: string }[]).some((i) => i.source !== 'manual')) {
      stats = await liveCounts();
    }
  }
  return { title: content.title, seo: content.seo, sections, collections, announcements: announcements ?? [], stats: stats ?? null };
}

/** What every public page needs: school identity, published site configuration and the list of live pages. */
export async function siteBootstrap(mode: 'published' | 'draft') {
  const [settings, c] = await Promise.all([getSettings(), getConfig()]);
  const content = (mode === 'draft' ? c.draft : c.published) as SiteContent | null;
  if (!content) return null;
  const pages = await WebsitePage.find(mode === 'draft' ? { deletedAt: null } : { deletedAt: null, status: 'published' }).sort({ order: 1 }).select('slug draft.title published.title').lean();
  return {
    school: { name: settings.name, logoUrl: settings.logoPath ?? null, faviconUrl: settings.faviconPath ?? null },
    site: content,
    pages: pages.map((p) => ({ slug: p.slug, title: ((mode === 'draft' ? p.draft : p.published) as PageContent | null)?.title ?? {} })),
    canonicalBase: canonicalBase(c.domain),
    preview: mode === 'draft'
  };
}

// ---------------------------------------------------------------------------- media references
export interface MediaUsage { where: string; label: string }

async function allContent() {
  const [pages, config, items] = await Promise.all([
    WebsitePage.find({ deletedAt: null }).select('slug draft published version').lean(),
    WebsiteConfig.findById('site').select('draft published').lean(),
    WebsiteItem.find({ deletedAt: null }).select('type slug data').lean()
  ]);
  return { pages, config, items };
}

/** Where a media asset is used (drafts and published content). Empty = safe to delete. */
export async function mediaUsage(id: string): Promise<MediaUsage[]> {
  const { pages, config, items } = await allContent();
  const out: MediaUsage[] = [];
  for (const p of pages) {
    if (collectMediaIds(p.published).has(id)) out.push({ where: 'page', label: `/${p.slug} (published)` });
    else if (collectMediaIds(p.draft).has(id)) out.push({ where: 'page', label: `/${p.slug} (draft)` });
  }
  if (config && (collectMediaIds(config.draft).has(id) || collectMediaIds(config.published).has(id))) out.push({ where: 'site', label: 'Site settings' });
  for (const i of items) if (collectMediaIds(i.data).has(id)) out.push({ where: 'item', label: `${i.type}: ${i.slug}` });
  return out;
}

/** After an asset is replaced, every place that embeds it is updated to the new file. */
export async function repointMedia(id: string, patch: Partial<MediaRef>): Promise<number> {
  const { pages, config, items } = await allContent();
  let touched = 0;
  for (const p of pages) {
    const d = patchMediaRefs(p.draft, id, patch); const pub = patchMediaRefs(p.published, id, patch);
    if (d.changed || pub.changed) { await updateVersioned(WebsitePage, p._id, { draft: d.value, published: pub.value }); touched += 1; }
  }
  if (config) {
    const d = patchMediaRefs(config.draft, id, patch); const pub = patchMediaRefs(config.published, id, patch);
    if (d.changed || pub.changed) { await updateVersioned(WebsiteConfig, 'site', { draft: d.value, published: pub.value }); touched += 1; }
  }
  for (const i of items) {
    const d = patchMediaRefs(i.data, id, patch);
    if (d.changed) { await updateVersioned(WebsiteItem, i._id, { data: d.value }); touched += 1; }
  }
  if (touched) invalidateWebsiteCache();
  return touched;
}

/** Every media id a piece of content embeds must exist in this school's library (no foreign / stale ids). */
export async function assertMediaExists(content: unknown) {
  const ids = [...collectMediaIds(content)];
  if (!ids.length) return;
  const found = await WebsiteMedia.find({ _id: $in(ids), deletedAt: null }).select('_id').lean();
  if (found.length !== ids.length) throw badRequest('This content refers to a media file that no longer exists in the media library');
}

export function validateItemData(type: ItemType, data: unknown) { return ITEM_DATA[type].parse(data ?? {}) as Record<string, unknown>; }
