/**
 * Pure logic for the public website + Website CMS. Dependency-free so the server (authoritative
 * validation), the dashboard (forms) and the public site (rendering) all behave identically.
 */

// ---------------------------------------------------------------------------- languages / text
/** Website content languages shipped today. More can be enabled without schema changes: localized
 *  values are stored as `{ <lang>: text }` maps keyed by a 2-letter code. */
export const WEBSITE_LANGUAGES = ['en', 'ur'] as const;
export const WEBSITE_LANGUAGE_NAMES: Record<string, string> = { en: 'English', ur: 'اردو', ar: 'العربية' };
const RTL = new Set(['ur', 'ar', 'fa', 'he', 'ps', 'sd']);
export const isRtlLang = (lang: string): boolean => RTL.has(lang);

/** A localized string: `{ en: 'Welcome', ur: 'خوش آمدید' }`. */
export type L10n = Record<string, string>;

/** Text for `lang`, falling back to the default language, then to any non-empty value. */
export function pickL10n(v: L10n | null | undefined, lang: string, fallback = 'en'): string {
  if (!v) return '';
  const own = v[lang]?.trim();
  if (own) return v[lang]!;
  const fb = v[fallback]?.trim();
  if (fb) return v[fallback]!;
  for (const k of Object.keys(v)) if (v[k]?.trim()) return v[k]!;
  return '';
}

export function isL10n(v: unknown): v is L10n {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => /^[a-z]{2}$/.test(k) && k !== 'id' && typeof (v as Record<string, unknown>)[k] === 'string');
}

/** Counts localized fields that have default-language text but no text in `lang` (translation report). */
export function countMissingTranslations(value: unknown, lang: string, defaultLang = 'en'): { total: number; missing: number } {
  const out = { total: 0, missing: 0 };
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (isL10n(v)) {
      if (v[defaultLang]?.trim()) { out.total += 1; if (!v[lang]?.trim()) out.missing += 1; }
      return;
    }
    Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

// ---------------------------------------------------------------------------- slugs / paths
export function slugify(input: string): string {
  return input.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** First path segments owned by the site router; pages cannot use them as slugs. */
export const DETAIL_PREFIXES = { news: 'news', event: 'events', album: 'gallery' } as const;
export const RESERVED_SLUGS = ['home', 'news', 'events', 'gallery', 'preview', 'api', 'uploads', 'admin', 'login', 'site'];
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug) || /^[a-z]{2}$/.test(slug);
}

export type SiteRoute =
  | { kind: 'home'; lang: string | null }
  | { kind: 'page'; lang: string | null; slug: string }
  | { kind: 'item'; lang: string | null; type: 'news' | 'event' | 'album'; slug: string }
  | { kind: 'notfound'; lang: string | null };

/**
 * Parses the part of the URL after `/site`. An optional leading language code selects the
 * language (`/site/ur/admissions`); the default language uses unprefixed URLs.
 */
export function parseSitePath(rest: string, languages: readonly string[]): SiteRoute {
  const segs = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  let lang: string | null = null;
  if (segs[0] && languages.includes(segs[0])) lang = segs.shift()!;
  if (segs.length === 0) return { kind: 'home', lang };
  if (segs.some((s) => !SLUG_RE.test(s))) return { kind: 'notfound', lang };
  if (segs.length === 1) return segs[0] === 'home' ? { kind: 'home', lang } : { kind: 'page', lang, slug: segs[0]! };
  if (segs.length === 2) {
    const type = (Object.keys(DETAIL_PREFIXES) as (keyof typeof DETAIL_PREFIXES)[]).find((k) => DETAIL_PREFIXES[k] === segs[0]);
    if (type) return { kind: 'item', lang, type, slug: segs[1]! };
  }
  return { kind: 'notfound', lang };
}

/** Builds a public URL path. `href` values stored in the CMS are language-neutral (`/admissions`). */
export function sitePath(href: string, lang: string, defaultLang: string): string {
  if (!href.startsWith('/')) return href;
  const clean = href === '/' || href === '/home' ? '' : href.replace(/\/+$/, '');
  return `/site${lang !== defaultLang ? `/${lang}` : ''}${clean}` || '/site';
}

/** Links an editor may store: site-relative paths, anchors, https, mailto and tel. Never javascript: etc. */
export function isSafeHref(href: string): boolean {
  if (typeof href !== 'string' || href.length === 0 || href.length > 500) return false;
  if (/[\u0000-\u001f\s]/.test(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//') && !href.includes('\\');
  if (href.startsWith('#')) return /^#[A-Za-z0-9_-]*$/.test(href);
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(href)) return true;
  if (/^tel:\+?[0-9()-]{3,20}$/i.test(href)) return true;
  return parseHttpsUrl(href) !== null;
}

function parseHttpsUrl(u: string): URL | null {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
    return url;
  } catch { return null; }
}

// ---------------------------------------------------------------------------- media
export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_PROVIDERS = ['local', 'cloudinary', 'youtube', 'vimeo'] as const;
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

export interface MediaRef { id?: string | null; kind: MediaKind; provider: MediaProvider; url: string; alt?: L10n }

export type MediaClassification =
  | { ok: true; provider: 'cloudinary'; kind: MediaKind; url: string; cloudName: string; publicId: string }
  | { ok: true; provider: 'youtube' | 'vimeo'; kind: 'video'; url: string; videoId: string; embedUrl: string }
  | { ok: false; reason: string };

const CLOUDINARY_HOST = 'res.cloudinary.com';
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;

/**
 * Decides whether a pasted URL is a media source the site can really play/show. Only Cloudinary
 * delivery URLs and official YouTube / Vimeo links are accepted: an arbitrary web page URL is not a
 * playable video, and the server never fetches the URL (no SSRF surface).
 */
export function classifyMediaUrl(input: string): MediaClassification {
  const url = parseHttpsUrl((input ?? '').trim());
  if (!url) return { ok: false, reason: 'Enter a full https:// URL' };
  const host = url.hostname.toLowerCase();
  if (host === CLOUDINARY_HOST) {
    // /<cloud>/<image|video>/upload/[transformations/][v123/]<public id>.<ext>
    const m = url.pathname.match(/^\/([a-z0-9_-]+)\/(image|video)\/upload\/(.+)$/i);
    if (!m) return { ok: false, reason: 'Not a Cloudinary delivery URL (expected …/image/upload/… or …/video/upload/…)' };
    const kind = m[2]!.toLowerCase() as MediaKind;
    const tail = m[3]!;
    if (tail.includes('..') || /[<>"'`]/.test(tail)) return { ok: false, reason: 'Invalid Cloudinary URL' };
    if (kind === 'image' && !IMAGE_EXT.test(tail) && /\.[a-z0-9]{2,5}$/i.test(tail)) return { ok: false, reason: 'Unsupported image format' };
    if (kind === 'video' && !VIDEO_EXT.test(tail) && /\.[a-z0-9]{2,5}$/i.test(tail)) return { ok: false, reason: 'Unsupported video format' };
    const publicId = tail.split('/').filter((s) => !/^v\d+$/.test(s) && !isTransformSegment(s)).join('/').replace(/\.[a-z0-9]{2,5}$/i, '');
    return { ok: true, provider: 'cloudinary', kind, url: `https://${CLOUDINARY_HOST}${url.pathname}`, cloudName: m[1]!, publicId };
  }
  if (host === 'youtu.be' || host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com' || host === 'www.youtube-nocookie.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null;
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else { const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/); id = m ? m[1]! : null; }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return { ok: false, reason: 'Could not find a YouTube video id in this URL' };
    return { ok: true, provider: 'youtube', kind: 'video', url: `https://www.youtube.com/watch?v=${id}`, videoId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const m = url.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/|$)/);
    if (!m) return { ok: false, reason: 'Could not find a Vimeo video id in this URL' };
    return { ok: true, provider: 'vimeo', kind: 'video', url: `https://vimeo.com/${m[1]}`, videoId: m[1]!, embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  }
  return { ok: false, reason: 'Unsupported source. Use a Cloudinary URL, a YouTube or Vimeo link, or upload the file.' };
}

function isTransformSegment(s: string): boolean {
  return /^(?:[a-z]{1,3}_[^,/]+)(?:,[a-z]{1,3}_[^,/]+)*$/.test(s);
}

/** True when a stored media reference points at something this installation is allowed to embed. */
export function isValidMediaRef(ref: { kind: string; provider: string; url: string }): boolean {
  if (ref.provider === 'local') {
    // Uploaded files, or photos bundled with the app (/site-assets/<folder>/<name>.jpg: demo / brand imagery).
    return /^\/(?:uploads\/website|site-assets\/[a-z0-9-]+)\/[a-z0-9-]+\.(png|jpg|webp|mp4|webm)$/.test(ref.url) && (ref.kind === 'video') === /\.(mp4|webm)$/.test(ref.url);
  }
  const c = classifyMediaUrl(ref.url);
  return c.ok && c.provider === ref.provider && c.kind === ref.kind;
}

/** Inserts delivery transformations into a Cloudinary URL (auto format/quality, bounded width). */
export function cloudinaryUrl(url: string, opts: { width?: number; poster?: boolean } = {}): string {
  const c = classifyMediaUrl(url);
  if (!c.ok || c.provider !== 'cloudinary') return url;
  const marker = `/${c.kind}/upload/`;
  const i = c.url.indexOf(marker);
  const head = c.url.slice(0, i + marker.length);
  let tail = c.url.slice(i + marker.length);
  const t = ['f_auto', 'q_auto'];
  if (opts.width) t.push(`w_${Math.round(opts.width)}`, 'c_limit');
  if (c.kind === 'video' && opts.poster) { t.push('so_0'); tail = tail.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg'; }
  return `${head}${t.join(',')}/${tail}`;
}

export const RESPONSIVE_WIDTHS = [480, 768, 1080, 1440, 1920, 2560] as const;
export function cloudinarySrcSet(url: string, max = 2560): string | undefined {
  const c = classifyMediaUrl(url);
  if (!c.ok || c.provider !== 'cloudinary' || c.kind !== 'image') return undefined;
  return RESPONSIVE_WIDTHS.filter((w) => w <= max).map((w) => `${cloudinaryUrl(url, { width: w })} ${w}w`).join(', ');
}

/** Finds every media reference inside arbitrary CMS content (pages, site config, items). */
export function collectMediaIds(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const v of value) collectMediaIds(v, out); return out; }
  const o = value as Record<string, unknown>;
  if (typeof o.id === 'string' && typeof o.url === 'string' && typeof o.provider === 'string' && typeof o.kind === 'string') out.add(o.id);
  for (const v of Object.values(o)) collectMediaIds(v, out);
  return out;
}

/** Returns a copy of `value` with every reference to media `id` patched (used when an asset is replaced). */
export function patchMediaRefs<T>(value: T, id: string, patch: Partial<MediaRef>): { value: T; changed: number } {
  let changed = 0;
  const walk = (v: unknown): unknown => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const o = v as Record<string, unknown>;
    if (o.id === id && typeof o.url === 'string' && typeof o.provider === 'string') { changed += 1; return { ...o, ...patch, id }; }
    const next: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) next[k] = walk(x);
    return next;
  };
  return { value: walk(value) as T, changed };
}

// ---------------------------------------------------------------------------- hero playback
export interface HeroSlideTiming { mediaType: 'image' | 'video' | 'none'; durationSec: number; videoOverride: boolean; active?: boolean; startAt?: string | null; endAt?: string | null }

export const HERO_VIDEO_SAFETY_CAP_MS = 10 * 60_000;

/**
 * How long a slide stays on screen.
 *  - image / text slides: the CMS duration.
 *  - video slides: until the video ends naturally, unless the editor enabled the override duration.
 *    `videoPlayable=false` (load error, autoplay blocked, reduced data) falls back to the timer so
 *    the hero never freezes on a broken video.
 */
export function heroSlidePlan(slide: HeroSlideTiming, videoPlayable = true): { mode: 'timer'; ms: number } | { mode: 'video-end'; capMs: number } {
  const ms = Math.min(120, Math.max(3, Number(slide.durationSec) || 7)) * 1000;
  if (slide.mediaType === 'video' && videoPlayable && !slide.videoOverride) return { mode: 'video-end', capMs: HERO_VIDEO_SAFETY_CAP_MS };
  return { mode: 'timer', ms };
}

/** Slides that should be shown right now: enabled and inside their optional schedule window. */
export function activeHeroSlides<T extends HeroSlideTiming>(slides: T[], now: Date = new Date()): T[] {
  const t = now.getTime();
  return slides.filter((s) => s.active !== false
    && (!s.startAt || Date.parse(s.startAt) <= t)
    && (!s.endAt || Date.parse(s.endAt) > t));
}

export const nextSlideIndex = (i: number, n: number, dir: 1 | -1 = 1): number => (n <= 0 ? 0 : (i + dir + n) % n);

// ---------------------------------------------------------------------------- theme tokens
export const HEADING_FONTS = {
  'serif-classic': '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  'serif-modern': '"Playfair Display", Didot, "Bodoni MT", "Hoefler Text", Georgia, "Times New Roman", serif',
  'sans-refined': '"Inter Variable", Inter, "Helvetica Neue", Helvetica, "Segoe UI", Roboto, Arial, sans-serif',
  'sans-humanist': 'Optima, Candara, "Gill Sans", "Gill Sans MT", "Segoe UI", sans-serif'
} as const;
export const BODY_FONTS = {
  sans: '"Inter Variable", Inter, "Helvetica Neue", Helvetica, "Segoe UI", Roboto, Arial, sans-serif',
  humanist: 'Optima, Candara, "Gill Sans", "Segoe UI", sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
} as const;
export const URDU_FONT = '"Jameel Noori Nastaleeq", "Noto Nastaliq Urdu", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif';
export const ARABIC_FONT = '"Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, sans-serif';

export type HeadingFont = keyof typeof HEADING_FONTS;
export type BodyFont = keyof typeof BODY_FONTS;
export const THEME_BACKGROUNDS = { ivory: '#faf8f3', white: '#ffffff', stone: '#f4f3f0', mist: '#f5f7fa' } as const;
export const THEME_RADII = { sharp: '0px', soft: '6px', round: '16px' } as const;

export interface SiteTheme {
  preset: string; primary: string; secondary: string; accent: string;
  background: keyof typeof THEME_BACKGROUNDS; headingFont: HeadingFont; bodyFont: BodyFont;
  radius: keyof typeof THEME_RADII; buttonStyle: 'solid' | 'outline'; headerStyle: 'overlay' | 'solid'; footerStyle: 'dark' | 'light';
}

export const THEME_PRESETS: Record<string, { name: string } & Omit<SiteTheme, 'preset'>> = {
  // The Alpha School System brand: logo navy + sky blue.
  alpha: { name: 'Alpha Navy & Sky', primary: '#1c1f5e', secondary: '#0d1033', accent: '#29abe2', background: 'mist', headingFont: 'serif-modern', bodyFont: 'sans', radius: 'soft', buttonStyle: 'solid', headerStyle: 'overlay', footerStyle: 'dark' },
  heritage: { name: 'Heritage Navy', primary: '#14284b', secondary: '#0b1830', accent: '#b8924a', background: 'ivory', headingFont: 'serif-classic', bodyFont: 'sans', radius: 'sharp', buttonStyle: 'solid', headerStyle: 'overlay', footerStyle: 'dark' },
  emerald: { name: 'Emerald Classic', primary: '#0f3d33', secondary: '#082620', accent: '#c2a15a', background: 'ivory', headingFont: 'serif-classic', bodyFont: 'sans', radius: 'soft', buttonStyle: 'solid', headerStyle: 'overlay', footerStyle: 'dark' },
  burgundy: { name: 'Burgundy Scholar', primary: '#5a1a2b', secondary: '#3a0f1b', accent: '#c9a66b', background: 'stone', headingFont: 'serif-modern', bodyFont: 'serif', radius: 'sharp', buttonStyle: 'solid', headerStyle: 'overlay', footerStyle: 'dark' },
  modern: { name: 'Modern Slate', primary: '#1f2937', secondary: '#0f172a', accent: '#9a6b2f', background: 'white', headingFont: 'sans-refined', bodyFont: 'sans', radius: 'soft', buttonStyle: 'solid', headerStyle: 'solid', footerStyle: 'light' }
};

const HEX = /^#[0-9a-fA-F]{6}$/;
export function hexToRgb(hex: string): [number, number, number] {
  const h = HEX.test(hex) ? hex : '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Text colour that stays readable on `bg`. */
export const readableOn = (bg: string): '#ffffff' | '#111827' => (contrastRatio(bg, '#ffffff') >= 4.5 ? '#ffffff' : '#111827');

/**
 * Turns the stored theme into CSS custom properties. Only validated tokens reach the page: unknown
 * presets / fonts fall back to safe defaults, so a bad value can never break the design.
 */
export function themeCssVars(theme: Partial<SiteTheme> | null | undefined, lang = 'en'): Record<string, string> {
  const base = THEME_PRESETS.alpha!;
  const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);
  const primary = hex(theme?.primary, base.primary);
  const secondary = hex(theme?.secondary, base.secondary);
  const accent = hex(theme?.accent, base.accent);
  const bg = THEME_BACKGROUNDS[(theme?.background ?? base.background) as keyof typeof THEME_BACKGROUNDS] ?? THEME_BACKGROUNDS.ivory;
  const script = lang === 'ur' ? URDU_FONT : lang === 'ar' || lang === 'fa' ? ARABIC_FONT : null;
  const rgb = (h: string) => hexToRgb(h).join(' ');
  return {
    '--site-primary': rgb(primary), '--site-secondary': rgb(secondary), '--site-accent': rgb(accent),
    '--site-on-primary': rgb(readableOn(primary)), '--site-on-accent': rgb(readableOn(accent)),
    // Accent text on a light page must stay legible; darken by falling back to primary when it is too pale.
    '--site-accent-text': rgb(contrastRatio(accent, bg) >= 3 ? accent : primary),
    '--site-bg': rgb(bg),
    '--site-radius': THEME_RADII[(theme?.radius ?? base.radius) as keyof typeof THEME_RADII] ?? '0px',
    '--site-font-heading': script ?? HEADING_FONTS[(theme?.headingFont ?? base.headingFont) as HeadingFont] ?? HEADING_FONTS['serif-classic'],
    '--site-font-body': script ?? BODY_FONTS[(theme?.bodyFont ?? base.bodyFont) as BodyFont] ?? BODY_FONTS.sans
  };
}

// ---------------------------------------------------------------------------- misc
/** Google Maps embed links only (the iframe `src` copied from Maps → Share → Embed a map). */
export function isGoogleMapsEmbed(u: string): boolean {
  const url = parseHttpsUrl(u);
  return Boolean(url && url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/embed'));
}

export const DOMAIN_RE = /^(?=.{4,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
/** Normalises what an admin types as a custom domain; null when it is not a plain public hostname. */
export function normalizeDomain(input: string): string | null {
  const d = (input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(d)) return null;
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/.test(d)) return null;
  return d;
}

/** Splits editor text into paragraphs (blank line = new paragraph). Rendering never uses raw HTML. */
export function paragraphs(text: string): string[] {
  return (text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}
