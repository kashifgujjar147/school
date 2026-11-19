import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALPHA_BRAND, alphaItems, alphaPages, alphaSiteContent, ITEM_DATA, pageContentSchema, siteContentSchema, type ItemType } from '@sms/shared';
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { SchoolSettings, WebsiteConfig, WebsiteItem, WebsitePage } from '../models/index.js';
import { createVersioned, updateVersioned } from '../services/repo.js';

/**
 * Applies the branded showcase website of The Alpha School System — 47 Campus:
 *   - school name, colours, logo and favicon (dashboards, sign-in, PWA);
 *   - site configuration (theme, navigation, footer, contact, SEO);
 *   - every page, published, with bundled photos;
 *   - demo collection items (programmes, facilities, faculty, news, events, gallery, FAQs …).
 *
 * Safe to re-run: pages and items are matched by slug and updated in place. Before any change the
 * current settings, site configuration, pages and items are written to BACKUP_DIR as JSON.
 *
 *   npm run website:alpha -w server            dry run (prints what would change)
 *   npm run website:alpha -w server -- --apply
 */
async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  const settings = await SchoolSettings.findById('school').lean();
  if (!settings) throw new Error('School is not initialised. Run `npm run init:school` first.');

  const site = siteContentSchema.parse(alphaSiteContent());
  const pages = alphaPages().map((p) => ({ ...p, content: pageContentSchema.parse(p.published) }));
  const items = alphaItems().map((i) => ({ ...i, data: ITEM_DATA[i.type as ItemType].parse(i.data) }));

  const existingPages = await WebsitePage.find({ deletedAt: null }).lean();
  const existingItems = await WebsiteItem.find({ deletedAt: null }).lean();
  const bySlug = new Map(existingPages.map((p) => [p.slug, p]));
  const byKey = new Map(existingItems.map((i) => [`${i.type}/${i.slug}`, i]));

  console.log(`School: "${settings.name}" → "${ALPHA_BRAND.name}"`);
  console.log(`Pages: ${pages.filter((p) => bySlug.has(p.slug)).length} updated, ${pages.filter((p) => !bySlug.has(p.slug)).length} created`);
  console.log(`Items: ${items.filter((i) => byKey.has(`${i.type}/${i.slug}`)).length} updated, ${items.filter((i) => !byKey.has(`${i.type}/${i.slug}`)).length} created`);
  if (!apply) { console.log('\nDry run only. Re-run with --apply to write these changes.'); return; }

  // Backup first, so the previous website can be restored by hand if needed.
  const dir = path.resolve(env.BACKUP_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `website-before-alpha-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify({ settings, config: await WebsiteConfig.findById('site').lean(), pages: existingPages, items: existingItems }, null, 2));
  console.log(`Backup written: ${file}`);

  await updateVersioned(SchoolSettings, 'school', {
    name: ALPHA_BRAND.name, shortName: ALPHA_BRAND.shortName, description: ALPHA_BRAND.description,
    primaryColor: ALPHA_BRAND.primaryColor, accentColor: ALPHA_BRAND.accentColor,
    logoPath: ALPHA_BRAND.logoPath, faviconPath: ALPHA_BRAND.faviconPath,
    'website.enabled': true
  });

  const now = new Date();
  const cfg = { draft: site, published: site, dirty: false, publishedAt: now };
  if (await WebsiteConfig.exists({ _id: 'site' })) await updateVersioned(WebsiteConfig, 'site', cfg);
  else await createVersioned(WebsiteConfig, { _id: 'site', ...cfg });

  for (const p of pages) {
    const doc = { draft: p.content, published: p.content, status: 'published', dirty: false, publishedAt: now, order: p.order, scheduledAt: null };
    const cur = bySlug.get(p.slug);
    if (cur) await updateVersioned(WebsitePage, String(cur._id), doc);
    else await createVersioned(WebsitePage, { slug: p.slug, systemKey: p.systemKey, ...doc });
  }

  for (const i of items) {
    const doc = { status: 'published', featured: i.featured, group: i.group, order: i.order, date: i.date ? new Date(`${i.date}T12:00:00Z`) : null, data: i.data, publishedAt: now };
    const cur = byKey.get(`${i.type}/${i.slug}`);
    if (cur) await updateVersioned(WebsiteItem, String(cur._id), doc);
    else await createVersioned(WebsiteItem, { type: i.type, slug: i.slug, ...doc });
  }
  console.log('The Alpha School System website and branding are live. Open /site to view it.');
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
