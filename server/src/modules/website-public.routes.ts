import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ITEM_DETAIL_TYPES, ITEM_TYPES, SLUG_RE, inquirySchema, type PageContent } from '@sms/shared';
import { isTest } from '../config/env.js';
import { WebsiteInquiry, WebsitePage } from '../models/index.js';
import { createVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { cached, ensureWebsite, publicItem1, publicItems, resolvePage, siteBootstrap } from '../services/website.js';
import { h, notFound, ok, parse } from '../utils/http.js';

/**
 * Unauthenticated read API for the public school website. It can only ever return PUBLISHED
 * content: published site configuration, pages with status "published" (their `published` copy,
 * never `draft`) and items with status "published". When the website is switched off every route
 * answers 404.
 */
export const publicSiteRouter = Router();

publicSiteRouter.use(h(async (_req, res, next) => {
  const s = await getSettings();
  if (!s.website?.enabled) throw notFound('Website is not enabled');
  await ensureWebsite();
  // Browsers revalidate every time (cheap: Express sends an ETag, so unchanged pages answer 304).
  // A max-age here kept deleted announcements and freshly published pages stale in visitors' browsers.
  res.setHeader('Cache-Control', 'public, no-cache');
  next();
}));

publicSiteRouter.get('/bootstrap', h(async (_req, res) => {
  const b = await cached('bootstrap', () => siteBootstrap('published'));
  if (!b) throw notFound('Website is not published');
  ok(res, b);
}));

publicSiteRouter.get('/pages/:slug', h(async (req, res) => {
  const slug = z.string().max(80).regex(SLUG_RE).parse(req.params.slug);
  const page = await cached(`page:${slug}`, async () => {
    const p = await WebsitePage.findOne({ slug, status: 'published', deletedAt: null }).select('slug published publishedAt').lean();
    if (!p?.published) return null;
    return { slug: p.slug, status: 'published', publishedAt: p.publishedAt, ...(await resolvePage(p.published as PageContent)) };
  });
  if (!page) throw notFound('Page not found');
  ok(res, page);
}));

publicSiteRouter.get('/items', h(async (req, res) => {
  const q = parse(z.object({ type: z.enum(ITEM_TYPES), group: z.string().trim().max(60).regex(/^[a-z0-9 _-]*$/).optional(), featured: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(48).default(12) }), req.query);
  ok(res, await cached(`items:${JSON.stringify(q)}`, () => publicItems({ type: q.type, group: q.group || undefined, featuredOnly: q.featured === 'true', limit: q.limit })));
}));

publicSiteRouter.get('/items/:type/:slug', h(async (req, res) => {
  const type = z.enum(ITEM_TYPES).parse(req.params.type);
  const slug = z.string().max(80).regex(SLUG_RE).parse(req.params.slug);
  if (!ITEM_DETAIL_TYPES.includes(type)) throw notFound();
  const item = await cached(`item:${type}:${slug}`, () => publicItem1(type, slug));
  if (!item) throw notFound();
  ok(res, item);
}));

const inquiryLimiter = rateLimit({ windowMs: 10 * 60_000, limit: isTest ? 100_000 : 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many messages. Please try again later.' } } });

/** Contact / admission inquiry form. Stored for the school office to follow up (Website Management → Inquiries). */
publicSiteRouter.post('/inquiries', inquiryLimiter, h(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { website: honeypot, ...b } = parse(inquirySchema, req.body);
  // Bots fill the hidden field: answer as if it worked, store nothing.
  if (!honeypot) await createVersioned(WebsiteInquiry, { ...b });
  ok(res, { received: true }, undefined, 201);
}));
