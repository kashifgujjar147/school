import { DETAIL_PREFIXES, cloudinaryUrl, isRtlLang, parseSitePath, pickL10n, sitePath, type ItemType, type L10n, type MediaRef, type PageContent, type SiteContent } from '@sms/shared';
import { WebsiteItem, WebsitePage } from '../models/index.js';
import { getSettings } from './settings.js';
import { cached, publicItem1, siteBootstrap } from './website.js';
import { $in } from '../utils/query.js';

/**
 * Search-engine support for the single-page public site: the server injects the real title,
 * description, canonical URL, hreflang alternates, Open Graph tags and JSON-LD into the HTML shell
 * for every /site URL, and serves /sitemap.xml and /robots.txt. Only published content is used.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const absolute = (base: string, url: string) => (url.startsWith('/') ? base + url : url);
const imageUrl = (base: string, m: MediaRef | null | undefined) => (m && m.kind === 'image' ? absolute(base, m.provider === 'cloudinary' ? cloudinaryUrl(m.url, { width: 1200 }) : m.url) : null);

export interface SiteHead { status: number; lang: string; dir: 'ltr' | 'rtl'; head: string }

export async function renderSiteHead(pathAfterSite: string): Promise<SiteHead | null> {
  const settings = await getSettings();
  if (!settings.website?.enabled) return null;
  const boot = await cached('bootstrap', () => siteBootstrap('published'));
  if (!boot) return null;
  const site = boot.site as SiteContent;
  const langs = site.languages.enabled; const def = site.languages.default;
  const route = parseSitePath(pathAfterSite, langs);
  const lang = route.lang ?? def;
  const t = (v: L10n | undefined | null) => pickL10n(v, lang, def);
  const siteTitle = t(site.seo.siteTitle) || settings.name;

  let status = 200; let title = siteTitle; let description = t(site.seo.description); let image = imageUrl(boot.canonicalBase, site.seo.ogImage); let noindex = !site.seo.allowIndexing;
  let href = '/'; let type = 'website'; let ld: Record<string, unknown> | null = null;

  if (route.kind === 'home' || route.kind === 'page') {
    const slug = route.kind === 'home' ? 'home' : route.slug;
    const p = await cached(`seo:page:${slug}`, () => WebsitePage.findOne({ slug, status: 'published', deletedAt: null }).select('published').lean());
    const c = p?.published as PageContent | undefined;
    if (!c) { status = 404; noindex = true; title = `Page not found — ${siteTitle}`; }
    else {
      href = route.kind === 'home' ? '/' : `/${slug}`;
      const pageTitle = t(c.seo?.title) || t(c.title);
      title = route.kind === 'home' ? (t(c.seo?.title) || siteTitle) : `${pageTitle} — ${siteTitle}`;
      description = t(c.seo?.description) || description;
      image = imageUrl(boot.canonicalBase, c.seo?.ogImage) ?? image;
      noindex = noindex || Boolean(c.seo?.noindex);
    }
  } else if (route.kind === 'item') {
    const item = await cached(`item:${route.type}:${route.slug}`, () => publicItem1(route.type as ItemType, route.slug));
    if (!item) { status = 404; noindex = true; title = `Page not found — ${siteTitle}`; }
    else {
      const d = item.data as { title?: L10n; summary?: L10n; image?: MediaRef | null; startAt?: string | null; endAt?: string | null; location?: L10n };
      href = `/${DETAIL_PREFIXES[route.type]}/${item.slug}`;
      title = `${t(d.title)} — ${siteTitle}`; description = t(d.summary) || description; image = imageUrl(boot.canonicalBase, d.image) ?? image; type = 'article';
      if (site.seo.structuredData && route.type === 'news') ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: clip(t(d.title), 110), datePublished: item.date ?? undefined, image: image ?? undefined, publisher: { '@type': 'EducationalOrganization', name: settings.name } };
      if (site.seo.structuredData && route.type === 'event' && d.startAt) ld = { '@context': 'https://schema.org', '@type': 'Event', name: t(d.title), startDate: d.startAt, endDate: d.endAt ?? undefined, location: t(d.location) ? { '@type': 'Place', name: t(d.location) } : undefined, organizer: { '@type': 'EducationalOrganization', name: settings.name } };
    }
  } else { status = 404; noindex = true; title = `Page not found — ${siteTitle}`; }

  const url = (l: string) => boot.canonicalBase + sitePath(href, l, def);
  if (!ld && site.seo.structuredData && route.kind === 'home' && status === 200) {
    // Organisation data comes only from what the school entered: nothing is invented (no ratings, no reviews).
    const address = t(site.contact.address);
    ld = {
      '@context': 'https://schema.org', '@type': 'School', name: settings.name, url: url(def),
      logo: boot.school.logoUrl ? absolute(boot.canonicalBase, boot.school.logoUrl) : undefined,
      description: description || undefined, address: address || undefined, telephone: site.contact.phones[0] || undefined, email: site.contact.email || undefined,
      sameAs: Object.values(site.contact.social).filter(Boolean)
    };
    if (!(ld.sameAs as string[]).length) delete ld.sameAs;
  }

  const tags = [
    `<title>${esc(clip(title, 160))}</title>`,
    description ? `<meta name="description" content="${esc(clip(description, 320))}" />` : '',
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}" />`,
    ...(status === 200 ? [
      `<link rel="canonical" href="${esc(url(lang))}" />`,
      ...(langs.length > 1 ? [...langs.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(url(l))}" />`), `<link rel="alternate" hreflang="x-default" href="${esc(url(def))}" />`] : []),
      `<meta property="og:url" content="${esc(url(lang))}" />`
    ] : []),
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="${esc(siteTitle)}" />`,
    `<meta property="og:title" content="${esc(clip(title, 160))}" />`,
    description ? `<meta property="og:description" content="${esc(clip(description, 320))}" />` : '',
    `<meta property="og:locale" content="${lang}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    // "<" is escaped so content can never close the script element.
    ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''
  ].filter(Boolean);
  return { status, lang, dir: isRtlLang(lang) ? 'rtl' : 'ltr', head: tags.join('\n    ') };
}

/** Puts the page-specific head into the built SPA shell. */
export function injectHead(html: string, h: SiteHead): string {
  return html
    .replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${h.lang}" dir="${h.dir}">`)
    .replace(/<title>[^<]*<\/title>/, () => h.head);
}

export async function sitemapXml(): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.website?.enabled) return null;
  const boot = await cached('bootstrap', () => siteBootstrap('published'));
  if (!boot || !(boot.site as SiteContent).seo.allowIndexing) return null;
  const { enabled: langs, default: def } = (boot.site as SiteContent).languages;
  const [pages, items] = await Promise.all([
    WebsitePage.find({ status: 'published', deletedAt: null }).select('slug published.seo publishedAt').lean(),
    WebsiteItem.find({ status: 'published', deletedAt: null, type: $in(Object.keys(DETAIL_PREFIXES)) }).select('type slug updatedAt').limit(5000).lean()
  ]);
  const entries: { href: string; at?: Date | null }[] = [
    ...pages.filter((p) => !(p.published as PageContent | null)?.seo?.noindex).map((p) => ({ href: p.slug === 'home' ? '/' : `/${p.slug}`, at: p.publishedAt })),
    ...items.map((i) => ({ href: `/${DETAIL_PREFIXES[i.type as keyof typeof DETAIL_PREFIXES]}/${i.slug}`, at: i.updatedAt as Date | undefined }))
  ];
  const urls = entries.map((e) => {
    const alts = langs.length > 1 ? langs.map((l) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${esc(boot.canonicalBase + sitePath(e.href, l, def))}" />`).join('') : '';
    return langs.map((l) => `  <url>\n    <loc>${esc(boot.canonicalBase + sitePath(e.href, l, def))}</loc>${e.at ? `\n    <lastmod>${new Date(e.at).toISOString()}</lastmod>` : ''}${alts}\n  </url>`).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

/** The dashboards and API are never indexable; the public site is, when the school allows it. */
export async function robotsTxt(): Promise<string> {
  const lines = ['User-agent: *', 'Disallow: /api/', 'Disallow: /admin', 'Disallow: /teacher', 'Disallow: /login', 'Disallow: /reset-password'];
  const xml = await sitemapXml().catch(() => null);
  if (xml) {
    const boot = await cached('bootstrap', () => siteBootstrap('published'));
    lines.push('Allow: /site', `Sitemap: ${boot!.canonicalBase}/sitemap.xml`);
  } else lines.push('Disallow: /site');
  return lines.join('\n') + '\n';
}
