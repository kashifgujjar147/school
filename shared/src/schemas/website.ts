import { z } from 'zod';
import {
  BODY_FONTS, HEADING_FONTS, MEDIA_KINDS, MEDIA_PROVIDERS, SLUG_RE, THEME_BACKGROUNDS, THEME_RADII,
  isGoogleMapsEmbed, isReservedSlug, isSafeHref, isValidMediaRef
} from '../logic/website.js';

/**
 * Validation for everything the Website CMS stores. The API parses every write with these schemas
 * (authoritative); the dashboard reuses them for defaults. Every field has a default, so
 * `schema.parse({})` yields a complete, renderable object.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const keys = <T extends Record<string, unknown>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** Localized text map `{ en: '…', ur: '…' }`. Keys are 2-letter language codes; empty values are dropped. */
export const l10n = (max: number) => z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(max))
  .default({})
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([k, s]) => k !== 'id' && s.trim() !== '')) as Record<string, string>);

export const safeHref = z.string().trim().max(500).refine(isSafeHref, 'Use a page path (/admissions), an https:// link, mailto: or tel:');
export const siteLink = z.object({ label: l10n(80), href: safeHref }).nullable().optional().transform((v) => v ?? null);

export const mediaRef = z.object({
  id: z.string().uuid().nullable().optional(),
  kind: z.enum(MEDIA_KINDS), provider: z.enum(MEDIA_PROVIDERS),
  url: z.string().max(1000), alt: l10n(300)
}).refine(isValidMediaRef, 'Unsupported media source').nullable().optional().transform((v) => v ?? null);

const imageRef = mediaRef.refine((v) => !v || v.kind === 'image', 'Choose an image');
const videoRef = mediaRef.refine((v) => !v || v.kind === 'video', 'Choose a video');
/** Background video for the hero must be a file the browser can autoplay muted (not a YouTube/Vimeo player). */
const fileVideoRef = videoRef.refine((v) => !v || v.provider === 'local' || v.provider === 'cloudinary', 'Hero videos must be uploaded files or Cloudinary videos');

const localId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const dateTime = z.string().datetime().nullable().optional().transform((v) => v ?? null);

// ---------------------------------------------------------------------------- sections
export const SECTION_BACKGROUNDS = ['default', 'muted', 'dark', 'brand'] as const;
export const SECTION_SPACING = ['compact', 'normal', 'spacious'] as const;
export const SECTION_ICONS = ['book', 'flask', 'monitor', 'library', 'trophy', 'trees', 'bus', 'shield', 'palette', 'music', 'globe', 'users', 'graduation', 'heart', 'star', 'compass', 'microscope', 'languages', 'calendar', 'award'] as const;
export const ITEM_TYPES = ['news', 'event', 'faculty', 'testimonial', 'faq', 'program', 'facility', 'activity', 'achievement', 'album'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const heroSlideSchema = z.object({
  id: localId,
  active: z.boolean().default(true),
  mediaType: z.enum(['none', 'image', 'video']).default('none'),
  desktop: mediaRef, mobile: mediaRef, poster: imageRef,
  eyebrow: l10n(120), headline: l10n(200), description: l10n(500),
  cta1: siteLink, cta2: siteLink,
  align: z.enum(['start', 'center', 'end']).default('start'),
  valign: z.enum(['middle', 'bottom']).default('bottom'),
  overlay: z.number().int().min(0).max(85).default(45),
  overlayStyle: z.enum(['gradient', 'solid']).default('gradient'),
  animation: z.enum(['fade', 'zoom', 'slide']).default('zoom'),
  durationSec: z.number().min(3).max(120).default(7),
  /** Video slides normally play to their natural end. When true they advance after durationSec instead. */
  videoOverride: z.boolean().default(false),
  startAt: dateTime, endAt: dateTime
}).superRefine((s, ctx) => {
  if (s.mediaType === 'image') for (const k of ['desktop', 'mobile'] as const) if (s[k] && s[k]!.kind !== 'image') ctx.addIssue({ code: 'custom', path: [k], message: 'Image slides need image media' });
  if (s.mediaType === 'video') for (const k of ['desktop', 'mobile'] as const) {
    const r = fileVideoRef.safeParse(s[k]);
    if (!r.success) ctx.addIssue({ code: 'custom', path: [k], message: 'Hero videos must be uploaded files or Cloudinary videos' });
  }
  if (s.startAt && s.endAt && s.startAt >= s.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End must be after start' });
});
export type HeroSlide = z.infer<typeof heroSlideSchema>;

const heading = { eyebrow: l10n(120), heading: l10n(200), intro: l10n(1200) };
const card = z.object({ id: localId, icon: z.enum(SECTION_ICONS).nullable().optional().transform((v) => v ?? null), title: l10n(160), body: l10n(1200), image: imageRef, link: siteLink });

export const SECTION_CONTENT = {
  hero: z.object({ height: z.enum(['full', 'tall', 'medium']).default('full'), slides: z.array(heroSlideSchema).max(12).default([]) }),
  pageHeader: z.object({ ...heading, image: imageRef }),
  textImage: z.object({
    ...heading, body: l10n(6000), image: imageRef, video: videoRef,
    imagePosition: z.enum(['start', 'end']).default('end'),
    personName: l10n(120), personTitle: l10n(160), cta: siteLink
  }),
  stats: z.object({
    ...heading,
    items: z.array(z.object({
      id: localId, label: l10n(80),
      /** manual = the number typed here; the others are live counts from this school's own records. */
      source: z.enum(['manual', 'students', 'teachers', 'classes']).default('manual'),
      value: z.number().min(0).max(10_000_000).nullable().optional().transform((v) => v ?? null),
      suffix: z.string().max(6).default('')
    })).max(8).default([])
  }),
  featureGrid: z.object({ ...heading, columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3), style: z.enum(['cards', 'images', 'minimal']).default('cards'), items: z.array(card).max(24).default([]) }),
  collection: z.object({
    ...heading, itemType: z.enum(ITEM_TYPES).default('news'),
    group: z.string().trim().max(60).default(''),
    limit: z.number().int().min(1).max(48).default(6),
    layout: z.enum(['grid', 'list', 'carousel']).default('grid'),
    featuredOnly: z.boolean().default(false), viewAll: siteLink
  }),
  gallery: z.object({ ...heading, images: z.array(z.object({ id: localId, media: mediaRef, caption: l10n(200) })).max(60).default([]) }),
  video: z.object({ ...heading, video: videoRef, poster: imageRef }),
  cta: z.object({ ...heading, cta1: siteLink, cta2: siteLink, image: imageRef }),
  steps: z.object({ ...heading, items: z.array(z.object({ id: localId, title: l10n(160), body: l10n(1200) })).max(12).default([]) }),
  richText: z.object({ ...heading, body: l10n(30_000) }),
  contact: z.object({ ...heading, showDetails: z.boolean().default(true), showForm: z.boolean().default(true), formType: z.enum(['contact', 'admission']).default('contact'), showMap: z.boolean().default(true) }),
  announcements: z.object({ ...heading, limit: z.number().int().min(1).max(20).default(5) })
} as const;
export const SECTION_TYPES = keys(SECTION_CONTENT);
export type SectionType = keyof typeof SECTION_CONTENT;
export type SectionContent<T extends SectionType> = z.infer<(typeof SECTION_CONTENT)[T]>;

const sectionBase = z.object({
  id: localId, type: z.enum(SECTION_TYPES),
  visible: z.boolean().default(true),
  background: z.enum(SECTION_BACKGROUNDS).default('default'),
  spacing: z.enum(SECTION_SPACING).default('normal'),
  anchor: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).nullable().optional().transform((v) => v ?? null),
  content: z.unknown()
});
/** A page section: common settings + content validated by the schema for its type. */
export const pageSectionSchema = sectionBase.transform((s, ctx) => {
  const r = SECTION_CONTENT[s.type].safeParse(s.content ?? {});
  if (!r.success) {
    for (const i of r.error.issues) ctx.addIssue({ ...i, path: ['content', ...i.path] });
    return z.NEVER;
  }
  return { ...s, content: r.data as Record<string, unknown> };
});
export interface Section { id: string; type: SectionType; visible: boolean; background: (typeof SECTION_BACKGROUNDS)[number]; spacing: (typeof SECTION_SPACING)[number]; anchor: string | null; content: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------- pages
export const pageSeoSchema = z.object({ title: l10n(160), description: l10n(320), ogImage: imageRef, noindex: z.boolean().default(false) }).default({});
export const pageContentSchema = z.object({
  title: l10n(160),
  sections: z.array(pageSectionSchema).max(40).default([]),
  seo: pageSeoSchema
}).superRefine((p, ctx) => {
  const seen = new Set<string>();
  p.sections.forEach((s, i) => { if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['sections', i, 'id'], message: 'Duplicate section id' }); seen.add(s.id); });
});
export interface PageContent { title: Record<string, string>; sections: Section[]; seo: z.infer<typeof pageSeoSchema> }

export const pageSlug = z.string().trim().toLowerCase().min(1).max(80).regex(SLUG_RE, 'Use lowercase letters, numbers and dashes')
  .refine((s) => !isReservedSlug(s), 'This address is reserved');
export const pageCreateSchema = z.object({ slug: pageSlug, title: l10n(160).refine((t) => Object.keys(t).length > 0, 'Title is required') });
export const pageSaveSchema = z.object({ content: pageContentSchema, slug: pageSlug.optional(), version: z.number().int().optional() });
export const pageScheduleSchema = z.object({ at: z.string().datetime().nullable() });
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

// ---------------------------------------------------------------------------- site-wide configuration
const navChild = z.object({ id: localId, label: l10n(60), href: safeHref });
const socialUrl = z.string().trim().max(300).refine((v) => v === '' || (isSafeHref(v) && v.startsWith('https://')), 'Use a full https:// link').default('');

export const SITE_PARTS = {
  navigation: z.object({
    items: z.array(navChild.extend({ children: z.array(navChild).max(12).default([]) })).max(10).default([]),
    cta: siteLink, showLanguageSwitcher: z.boolean().default(true), showStaffLogin: z.boolean().default(true)
  }),
  footer: z.object({
    about: l10n(600),
    columns: z.array(z.object({ id: localId, title: l10n(60), links: z.array(navChild).max(12).default([]) })).max(4).default([]),
    policyLinks: z.array(navChild).max(6).default([]),
    copyright: l10n(200), showSocial: z.boolean().default(true)
  }),
  contact: z.object({
    address: l10n(400), phones: z.array(z.string().trim().max(30).regex(/^\+?[0-9()\- ]{5,30}$/, 'Invalid phone number')).max(4).default([]),
    email: z.union([z.literal(''), z.string().trim().email().max(160)]).default(''),
    admissionsPhone: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9()\- ]{5,30}$/)]).default(''),
    admissionsEmail: z.union([z.literal(''), z.string().trim().email().max(160)]).default(''),
    officeHours: l10n(300),
    mapEmbedUrl: z.string().trim().max(1200).refine((v) => v === '' || isGoogleMapsEmbed(v), 'Paste the "Embed a map" link from Google Maps (https://www.google.com/maps/embed?…)').default(''),
    social: z.object({ facebook: socialUrl, instagram: socialUrl, youtube: socialUrl, x: socialUrl, linkedin: socialUrl, whatsapp: socialUrl }).default({})
  }),
  theme: z.object({
    preset: z.string().max(30).default('school'), primary: hex.default('#1e3a5f'), secondary: hex.default('#0f2038'), accent: hex.default('#c8963e'),
    background: z.enum(keys(THEME_BACKGROUNDS)).default('ivory'),
    headingFont: z.enum(keys(HEADING_FONTS)).default('serif-classic'), bodyFont: z.enum(keys(BODY_FONTS)).default('sans'),
    radius: z.enum(keys(THEME_RADII)).default('sharp'), buttonStyle: z.enum(['solid', 'outline']).default('solid'),
    headerStyle: z.enum(['overlay', 'solid']).default('overlay'), footerStyle: z.enum(['dark', 'light']).default('dark')
  }),
  seo: z.object({
    siteTitle: l10n(120), description: l10n(320), ogImage: imageRef,
    allowIndexing: z.boolean().default(true), structuredData: z.boolean().default(true)
  }),
  languages: z.object({
    enabled: z.array(z.string().regex(/^[a-z]{2}$/)).min(1).max(8).default(['en', 'ur']),
    default: z.string().regex(/^[a-z]{2}$/).default('en')
  }).refine((l) => l.enabled.includes(l.default), { message: 'The default language must be enabled', path: ['default'] })
    .refine((l) => new Set(l.enabled).size === l.enabled.length, { message: 'Duplicate language', path: ['enabled'] })
} as const;
export const SITE_PART_KEYS = keys(SITE_PARTS);
export type SitePartKey = keyof typeof SITE_PARTS;
export type SitePart<K extends SitePartKey> = z.infer<(typeof SITE_PARTS)[K]>;
export type SiteContent = { [K in SitePartKey]: SitePart<K> };

export const siteContentSchema = z.object({
  navigation: SITE_PARTS.navigation.default({}), footer: SITE_PARTS.footer.default({}), contact: SITE_PARTS.contact.default({}),
  theme: SITE_PARTS.theme.default({}), seo: SITE_PARTS.seo.default({}), languages: SITE_PARTS.languages.default({})
});

// ---------------------------------------------------------------------------- content collections
const common = { title: l10n(200), summary: l10n(600), image: imageRef };
const isoDay = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default('');

export const ITEM_DATA = {
  news: z.object({ ...common, body: l10n(30_000), video: videoRef, date: isoDay }),
  event: z.object({ ...common, body: l10n(30_000), startAt: z.string().datetime().nullable().optional().transform((v) => v ?? null), endAt: dateTime, location: l10n(200) }),
  faculty: z.object({ ...common, designation: l10n(160), qualifications: l10n(300) }),
  testimonial: z.object({ ...common, quote: l10n(1200), relation: l10n(120) }),
  faq: z.object({ ...common, answer: l10n(4000) }),
  program: z.object({ ...common, body: l10n(12_000), grades: l10n(200), subjects: l10n(600) }),
  facility: z.object({ ...common, icon: z.enum(SECTION_ICONS).nullable().optional().transform((v) => v ?? null) }),
  activity: z.object({ ...common }),
  achievement: z.object({ ...common, year: z.string().trim().max(12).default('') }),
  album: z.object({ ...common, media: z.array(z.object({ id: localId, media: mediaRef, caption: l10n(200) })).max(200).default([]) })
} as const;

/** Item types that have their own public detail page (and therefore need a slug). */
export const ITEM_DETAIL_TYPES: ItemType[] = ['news', 'event', 'album'];
/** Suggested groupings per type (free text is allowed; these drive the dashboard dropdown). */
export const ITEM_GROUPS: Partial<Record<ItemType, string[]>> = {
  faculty: ['principal', 'management', 'leadership', 'teacher', 'staff'],
  testimonial: ['parent', 'student', 'alumni'],
  faq: ['general', 'admissions', 'academics', 'fees'],
  activity: ['club', 'sport', 'competition', 'trip', 'cultural'],
  achievement: ['academic', 'award', 'competition', 'milestone'],
  news: ['news', 'announcement'], album: ['campus', 'events', 'sports', 'academics']
};

export const itemSaveSchema = z.object({
  type: z.enum(ITEM_TYPES),
  slug: z.string().trim().toLowerCase().max(80).regex(SLUG_RE).optional(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  featured: z.boolean().default(false),
  group: z.string().trim().toLowerCase().max(60).regex(/^[a-z0-9 _-]*$/).default(''),
  data: z.unknown(), version: z.number().int().optional()
}).transform((v, ctx) => {
  const r = ITEM_DATA[v.type].safeParse(v.data ?? {});
  if (!r.success) { for (const i of r.error.issues) ctx.addIssue({ ...i, path: ['data', ...i.path] }); return z.NEVER; }
  if (Object.keys((r.data as { title: Record<string, string> }).title).length === 0) { ctx.addIssue({ code: 'custom', path: ['data', 'title'], message: 'Title is required' }); return z.NEVER; }
  return { ...v, data: r.data as Record<string, unknown> };
});

// ---------------------------------------------------------------------------- media library
export const mediaRegisterSchema = z.object({ url: z.string().trim().min(10).max(1000), title: z.string().trim().max(160).default(''), category: z.string().trim().toLowerCase().max(40).default('') });
export const mediaUpdateSchema = z.object({
  title: z.string().trim().max(160), category: z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9 _-]*$/),
  alt: l10n(300), caption: l10n(300), archived: z.boolean()
}).partial();
export const mediaListSchema = z.object({
  q: z.string().trim().max(80).optional(), kind: z.enum(MEDIA_KINDS).optional(), category: z.string().trim().max(40).optional(),
  archived: z.enum(['true', 'false']).default('false'), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(40)
});

// ---------------------------------------------------------------------------- public forms / domain
export const inquirySchema = z.object({
  kind: z.enum(['contact', 'admission']),
  name: z.string().trim().min(2).max(120),
  phone: z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9()\- ]{5,30}$/, 'Invalid phone number')]).default(''),
  email: z.union([z.literal(''), z.string().trim().email().max(160)]).default(''),
  grade: z.string().trim().max(60).default(''),
  message: z.string().trim().max(3000).default(''),
  lang: z.string().regex(/^[a-z]{2}$/).default('en'),
  /** Honeypot: real visitors never fill this hidden field. */
  website: z.string().max(200).optional()
}).refine((v) => v.phone !== '' || v.email !== '', { message: 'Enter a phone number or an email address', path: ['phone'] });

export const domainSchema = z.object({ domain: z.string().trim().max(253) });
