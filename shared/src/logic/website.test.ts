import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeHeroSlides, classifyMediaUrl, cloudinarySrcSet, cloudinaryUrl, collectMediaIds, contrastRatio, countMissingTranslations,
  heroSlidePlan, isGoogleMapsEmbed, isReservedSlug, isRtlLang, isSafeHref, isValidMediaRef, nextSlideIndex, normalizeDomain,
  paragraphs, parseSitePath, patchMediaRefs, pickL10n, readableOn, sitePath, slugify, themeCssVars
} from './website.js';
import {
  heroSlideSchema, inquirySchema, itemSaveSchema, pageContentSchema, pageCreateSchema, pageSectionSchema, siteContentSchema, SITE_PARTS, SECTION_TYPES, SECTION_CONTENT
} from '../schemas/website.js';

const ID = '3f0e5b0a-6a59-4a51-9d55-0d2f4f4f7a11';

describe('localized text', () => {
  test('falls back to the default language, then to any value', () => {
    assert.equal(pickL10n({ en: 'Welcome', ur: 'خوش آمدید' }, 'ur'), 'خوش آمدید');
    assert.equal(pickL10n({ en: 'Welcome', ur: '  ' }, 'ur'), 'Welcome');
    assert.equal(pickL10n({ ur: 'صرف اردو' }, 'en'), 'صرف اردو');
    assert.equal(pickL10n(undefined, 'en'), '');
  });
  test('RTL detection covers Urdu and Arabic', () => {
    assert.equal(isRtlLang('ur'), true); assert.equal(isRtlLang('ar'), true); assert.equal(isRtlLang('en'), false);
  });
  test('translation report counts only fields that have default-language text', () => {
    const page = { title: { en: 'About', ur: 'تعارف' }, sections: [{ id: 's1', content: { heading: { en: 'Our story' }, body: { en: 'Text', ur: '' }, empty: {} } }] };
    assert.deepEqual(countMissingTranslations(page, 'ur'), { total: 3, missing: 2 });
  });
});

describe('site routing', () => {
  const langs = ['en', 'ur'];
  test('home, pages, language prefix and detail pages', () => {
    assert.deepEqual(parseSitePath('', langs), { kind: 'home', lang: null });
    assert.deepEqual(parseSitePath('/ur', langs), { kind: 'home', lang: 'ur' });
    assert.deepEqual(parseSitePath('/admissions', langs), { kind: 'page', lang: null, slug: 'admissions' });
    assert.deepEqual(parseSitePath('/ur/admissions/', langs), { kind: 'page', lang: 'ur', slug: 'admissions' });
    assert.deepEqual(parseSitePath('/news/sports-day', langs), { kind: 'item', lang: null, type: 'news', slug: 'sports-day' });
    assert.deepEqual(parseSitePath('/ur/events/open-house', langs), { kind: 'item', lang: 'ur', type: 'event', slug: 'open-house' });
    assert.deepEqual(parseSitePath('/gallery/campus', langs), { kind: 'item', lang: null, type: 'album', slug: 'campus' });
  });
  test('rejects malformed paths', () => {
    assert.equal(parseSitePath('/a/b/c', langs).kind, 'notfound');
    assert.equal(parseSitePath('/%3Cscript%3E', langs).kind, 'notfound');
    assert.equal(parseSitePath('/unknown/thing', langs).kind, 'notfound');
  });
  test('a language that is not enabled is treated as a page slug, never as a language', () => {
    assert.deepEqual(parseSitePath('/ar', ['en']), { kind: 'page', lang: null, slug: 'ar' });
  });
  test('builds language-aware URLs', () => {
    assert.equal(sitePath('/', 'en', 'en'), '/site');
    assert.equal(sitePath('/admissions', 'en', 'en'), '/site/admissions');
    assert.equal(sitePath('/admissions', 'ur', 'en'), '/site/ur/admissions');
    assert.equal(sitePath('/', 'ur', 'en'), '/site/ur');
    assert.equal(sitePath('https://example.org/x', 'ur', 'en'), 'https://example.org/x');
  });
  test('slugs', () => {
    assert.equal(slugify('  Annual Sports Day 2026! '), 'annual-sports-day-2026');
    assert.equal(slugify('Café & Crème'), 'cafe-creme');
    assert.equal(isReservedSlug('news'), true); assert.equal(isReservedSlug('ur'), true); assert.equal(isReservedSlug('about-us'), false);
  });
});

describe('link safety', () => {
  test('accepts site paths, https, mailto, tel and anchors', () => {
    for (const ok of ['/admissions', '/', '#contact', 'https://example.org/a?b=1', 'mailto:info@school.example', 'tel:+923001112233']) assert.equal(isSafeHref(ok), true, ok);
  });
  test('rejects script, data, protocol-relative, http and credentialed URLs', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//evil.example', 'http://example.org', 'https://user:pw@example.org', '/a\\b', 'vbscript:x', '', ' /x', 'https://localhost']) assert.equal(isSafeHref(bad), false, bad);
  });
  test('only Google Maps embed links are accepted for the map', () => {
    assert.equal(isGoogleMapsEmbed('https://www.google.com/maps/embed?pb=!1m18'), true);
    assert.equal(isGoogleMapsEmbed('https://www.google.com/search?q=x'), false);
    assert.equal(isGoogleMapsEmbed('https://evil.example/maps/embed'), false);
  });
});

describe('media sources', () => {
  test('Cloudinary image and video URLs', () => {
    const img = classifyMediaUrl('https://res.cloudinary.com/demo/image/upload/v1700000000/school/campus_1.jpg');
    assert.equal(img.ok && img.provider, 'cloudinary'); assert.equal(img.ok && img.kind, 'image');
    assert.equal(img.ok && img.provider === 'cloudinary' && img.cloudName, 'demo');
    assert.equal(img.ok && img.provider === 'cloudinary' && img.publicId, 'school/campus_1');
    const vid = classifyMediaUrl('https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/tour.mp4?x=1');
    assert.equal(vid.ok && vid.kind, 'video');
    assert.equal(vid.ok && vid.provider === 'cloudinary' && vid.publicId, 'tour');
    assert.equal(vid.ok && vid.url, 'https://res.cloudinary.com/demo/video/upload/f_auto,q_auto/v1/tour.mp4');
  });
  test('YouTube and Vimeo links become official embed URLs', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=3', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
      const c = classifyMediaUrl(u);
      assert.equal(c.ok && c.provider === 'youtube' && c.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', u);
    }
    const v = classifyMediaUrl('https://vimeo.com/123456789');
    assert.equal(v.ok && v.provider === 'vimeo' && v.embedUrl, 'https://player.vimeo.com/video/123456789');
  });
  test('arbitrary URLs are not pretended to be playable', () => {
    for (const u of ['https://example.org/video.mp4', 'http://res.cloudinary.com/demo/image/upload/a.jpg', 'https://res.cloudinary.com.evil.example/demo/image/upload/a.jpg', 'https://res.cloudinary.com/demo/raw/upload/a.pdf', 'https://res.cloudinary.com/demo/image/upload/../x.jpg', 'https://res.cloudinary.com/demo/image/upload/a.svg', 'not a url', 'https://169.254.169.254/latest', 'https://www.youtube.com/watch?v=<x>']) {
      assert.equal(classifyMediaUrl(u).ok, false, u);
    }
  });
  test('media references: only local website uploads or recognised providers', () => {
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'local', url: `/uploads/website/${ID}.webp` }), true);
    assert.equal(isValidMediaRef({ kind: 'video', provider: 'local', url: `/uploads/website/${ID}.mp4` }), true);
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'local', url: `/uploads/website/${ID}.mp4` }), false);
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'local', url: '/uploads/students/x.png' }), false);
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'local', url: '/uploads/website/../../etc/passwd' }), false);
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'cloudinary', url: 'https://res.cloudinary.com/demo/video/upload/a.mp4' }), false);
    assert.equal(isValidMediaRef({ kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), true);
    assert.equal(isValidMediaRef({ kind: 'image', provider: 'cloudinary', url: 'javascript:alert(1)' }), false);
  });
  test('Cloudinary delivery transformations and responsive sources', () => {
    const u = 'https://res.cloudinary.com/demo/image/upload/v1/school/hero.jpg';
    assert.equal(cloudinaryUrl(u, { width: 1080 }), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1080,c_limit/v1/school/hero.jpg');
    assert.equal(cloudinaryUrl('https://res.cloudinary.com/demo/video/upload/v1/tour.mp4', { poster: true }), 'https://res.cloudinary.com/demo/video/upload/f_auto,q_auto,so_0/v1/tour.jpg');
    assert.equal(cloudinaryUrl('/uploads/website/a.jpg', { width: 400 }), '/uploads/website/a.jpg');
    const set = cloudinarySrcSet(u, 1080)!;
    assert.equal(set.split(', ').length, 3);
    assert.match(set, /w_480,c_limit\/v1\/school\/hero\.jpg 480w/);
    assert.equal(cloudinarySrcSet('/uploads/website/a.jpg'), undefined);
  });
  test('reference tracking and replacement', () => {
    const content = { a: { id: ID, kind: 'image', provider: 'local', url: '/uploads/website/a.png' }, list: [{ media: { id: ID, kind: 'image', provider: 'local', url: '/uploads/website/a.png', alt: { en: 'x' } } }, { id: 'slide-1', headline: { en: 'h' } }] };
    assert.deepEqual([...collectMediaIds(content)], [ID]);
    const r = patchMediaRefs(content, ID, { url: '/uploads/website/b.png' });
    assert.equal(r.changed, 2);
    assert.equal(r.value.a.url, '/uploads/website/b.png');
    assert.equal(content.a.url, '/uploads/website/a.png', 'original is not mutated');
    assert.deepEqual((r.value.list[0] as { media: { alt: unknown } }).media.alt, { en: 'x' });
  });
});

describe('hero playback', () => {
  const img = { mediaType: 'image' as const, durationSec: 6, videoOverride: false };
  const vid = { mediaType: 'video' as const, durationSec: 9, videoOverride: false };
  test('images use the CMS duration', () => assert.deepEqual(heroSlidePlan(img), { mode: 'timer', ms: 6000 }));
  test('videos play to their natural end when no override is configured', () => assert.equal(heroSlidePlan(vid).mode, 'video-end'));
  test('the override duration is respected when enabled', () => assert.deepEqual(heroSlidePlan({ ...vid, videoOverride: true }), { mode: 'timer', ms: 9000 }));
  test('a video that cannot play falls back to the timer instead of freezing', () => assert.deepEqual(heroSlidePlan(vid, false), { mode: 'timer', ms: 9000 }));
  test('durations are clamped to a sane range', () => {
    assert.deepEqual(heroSlidePlan({ ...img, durationSec: 0.2 }), { mode: 'timer', ms: 3000 });
    assert.deepEqual(heroSlidePlan({ ...img, durationSec: 9999 }), { mode: 'timer', ms: 120000 });
    assert.deepEqual(heroSlidePlan({ ...img, durationSec: Number.NaN }), { mode: 'timer', ms: 7000 });
  });
  test('inactive and out-of-schedule slides are skipped', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const slides = [
      { ...img, id: 'a' }, { ...img, id: 'b', active: false },
      { ...img, id: 'c', startAt: '2026-07-01T00:00:00Z' }, { ...img, id: 'd', endAt: '2026-06-01T00:00:00Z' },
      { ...img, id: 'e', startAt: '2026-06-01T00:00:00Z', endAt: '2026-06-30T00:00:00Z' }
    ];
    assert.deepEqual(activeHeroSlides(slides, now).map((s) => s.id), ['a', 'e']);
  });
  test('index wraps in both directions', () => {
    assert.equal(nextSlideIndex(2, 3), 0); assert.equal(nextSlideIndex(0, 3, -1), 2); assert.equal(nextSlideIndex(0, 0), 0);
  });
});

describe('theme tokens', () => {
  test('invalid values fall back to safe defaults', () => {
    const v = themeCssVars({ primary: 'red; background:url(x)', radius: 'huge' as never, headingFont: 'comic' as never });
    assert.equal(v['--site-primary'], '20 40 75');
    assert.equal(v['--site-radius'], '0px');
    assert.match(v['--site-font-heading']!, /Georgia/);
  });
  test('text on the brand colour is always readable', () => {
    assert.equal(readableOn('#14284b'), '#ffffff'); assert.equal(readableOn('#f5e9c8'), '#111827');
    assert.ok(contrastRatio('#14284b', readableOn('#14284b')) >= 4.5);
  });
  test('Urdu uses the Nastaliq stack for headings and body', () => {
    const v = themeCssVars({}, 'ur');
    assert.match(v['--site-font-heading']!, /Nastaliq/); assert.match(v['--site-font-body']!, /Nastaliq/);
  });
});

describe('content validation', () => {
  test('every section type has complete defaults', () => {
    for (const type of SECTION_TYPES) {
      const s = pageSectionSchema.parse({ id: 's1', type });
      assert.equal(s.visible, true); assert.equal(s.background, 'default');
      assert.deepEqual(s.content, SECTION_CONTENT[type].parse({}), type);
    }
  });
  test('rejects unknown section types, unsafe links and non-website media', () => {
    assert.equal(pageSectionSchema.safeParse({ id: 's1', type: 'script' }).success, false);
    assert.equal(pageSectionSchema.safeParse({ id: 's1', type: 'cta', content: { cta1: { label: { en: 'Go' }, href: 'javascript:alert(1)' } } }).success, false);
    assert.equal(pageSectionSchema.safeParse({ id: 's1', type: 'pageHeader', content: { image: { kind: 'image', provider: 'local', url: '/etc/passwd' } } }).success, false);
    assert.equal(pageSectionSchema.safeParse({ id: 's1', type: 'video', content: { video: { kind: 'image', provider: 'local', url: `/uploads/website/${ID}.png` } } }).success, false);
  });
  test('hero slides: defaults, media rules and schedule order', () => {
    const s = heroSlideSchema.parse({ id: 'a' });
    assert.equal(s.durationSec, 7); assert.equal(s.videoOverride, false); assert.equal(s.mediaType, 'none');
    const yt = { kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
    assert.equal(heroSlideSchema.safeParse({ id: 'a', mediaType: 'video', desktop: yt }).success, false, 'YouTube players cannot be a muted background');
    assert.equal(heroSlideSchema.safeParse({ id: 'a', mediaType: 'video', desktop: { kind: 'video', provider: 'cloudinary', url: 'https://res.cloudinary.com/demo/video/upload/tour.mp4' } }).success, true);
    assert.equal(heroSlideSchema.safeParse({ id: 'a', durationSec: 1 }).success, false);
    assert.equal(heroSlideSchema.safeParse({ id: 'a', startAt: '2026-02-01T00:00:00.000Z', endAt: '2026-01-01T00:00:00.000Z' }).success, false);
  });
  test('pages: duplicate section ids are rejected; empty translations are dropped', () => {
    assert.equal(pageContentSchema.safeParse({ title: { en: 'A' }, sections: [{ id: 'x', type: 'cta' }, { id: 'x', type: 'cta' }] }).success, false);
    const p = pageContentSchema.parse({ title: { en: 'About', ur: '   ' }, sections: [] });
    assert.deepEqual(p.title, { en: 'About' });
    assert.equal(pageCreateSchema.safeParse({ slug: 'news', title: { en: 'x' } }).success, false);
    assert.equal(pageCreateSchema.safeParse({ slug: 'Our Story', title: { en: 'x' } }).success, false);
    assert.equal(pageCreateSchema.safeParse({ slug: 'our-story', title: {} }).success, false);
    assert.equal(pageCreateSchema.safeParse({ slug: 'our-story', title: { en: 'Our story' } }).success, true);
  });
  test('site configuration has complete defaults and controlled theme tokens', () => {
    const s = siteContentSchema.parse({});
    assert.deepEqual(s.languages, { enabled: ['en', 'ur'], default: 'en' });
    assert.equal(s.theme.headingFont, 'serif-classic');
    assert.equal(SITE_PARTS.theme.safeParse({ primary: 'blue' }).success, false);
    assert.equal(SITE_PARTS.theme.safeParse({ headingFont: 'Comic Sans' }).success, false);
    assert.equal(SITE_PARTS.languages.safeParse({ enabled: ['en'], default: 'ur' }).success, false);
    assert.equal(SITE_PARTS.contact.safeParse({ mapEmbedUrl: 'https://evil.example/maps/embed' }).success, false);
    assert.equal(SITE_PARTS.contact.safeParse({ social: { facebook: 'javascript:alert(1)' } }).success, false);
  });
  test('collection items are validated per type and need a title', () => {
    assert.equal(itemSaveSchema.safeParse({ type: 'faq', data: { answer: { en: 'Yes' } } }).success, false);
    const ok = itemSaveSchema.parse({ type: 'faq', data: { title: { en: 'Do you offer transport?' }, answer: { en: 'Yes' }, unknown: 'dropped' } });
    assert.equal(ok.status, 'draft'); assert.equal('unknown' in ok.data, false);
    assert.equal(itemSaveSchema.safeParse({ type: 'salary', data: {} }).success, false);
  });
  test('public inquiry form needs a way to reply', () => {
    assert.equal(inquirySchema.safeParse({ kind: 'admission', name: 'Parent' }).success, false);
    assert.equal(inquirySchema.safeParse({ kind: 'admission', name: 'Parent', phone: '0300 1112233' }).success, true);
    assert.equal(inquirySchema.safeParse({ kind: 'contact', name: 'P', email: 'a@b.co' }).success, false);
  });
});

describe('misc', () => {
  test('custom domains are plain public hostnames', () => {
    assert.equal(normalizeDomain('https://WWW.School-A.example.com/path'), 'www.school-a.example.com');
    for (const bad of ['localhost', 'school', '192.168.1.10', 'a..b.com', '-x.com', 'printer.local', 'x.internal', 'exa mple.com']) assert.equal(normalizeDomain(bad), null, bad);
  });
  test('paragraph splitting', () => assert.deepEqual(paragraphs('One\nstill one\n\n\nTwo  '), ['One\nstill one', 'Two']));
});

import { defaultPages, defaultSiteContent, SAMPLE_NOTE, shade } from './website-defaults.js';

describe('starter website', () => {
  const school = { name: 'Test School', description: 'A school', address: '1 Road', phone: '0300 1112233', email: 'info@test.example', primaryColor: '#1e3a5f', accentColor: '#c8963e', defaultLanguage: 'en', heroTitle: 'Welcome', about: 'About text' };
  test('every starter page and the site configuration pass the same validation as editor input', () => {
    const pages = defaultPages(school);
    assert.equal(new Set(pages.map((p) => p.slug)).size, pages.length);
    assert.ok(pages.length >= 22);
    for (const p of pages) {
      assert.doesNotThrow(() => pageContentSchema.parse(p.draft), `draft of ${p.slug}`);
      if (p.published) assert.doesNotThrow(() => pageContentSchema.parse(p.published), `published ${p.slug}`);
    }
    const site = siteContentSchema.parse(defaultSiteContent(school));
    assert.equal(site.theme.primary, '#1e3a5f'); assert.deepEqual(site.contact.phones, ['0300 1112233']);
    assert.equal(siteContentSchema.parse(defaultSiteContent({ name: 'X', phone: 'call us!', email: 'nope' })).contact.email, '');
  });
  test('nothing published at first use contains sample text or invented facts', () => {
    const pages = defaultPages(school);
    const published = pages.filter((p) => p.published);
    assert.deepEqual(published.map((p) => p.slug), ['home', 'news', 'contact-us']);
    assert.equal(JSON.stringify(published.map((p) => p.published)).includes(SAMPLE_NOTE), false);
    const home = pageContentSchema.parse(published[0]!.published);
    assert.equal(home.sections.some((s) => s.type === 'stats'), false);
    assert.equal(home.sections[0]!.content.slides[0].headline.en, 'Welcome');
    const draft = pageContentSchema.parse(pages[0]!.draft);
    assert.ok(draft.sections.length > home.sections.length);
  });
  test('existing website switches are respected', () => {
    const pages = defaultPages({ name: 'X', showContact: false, showAnnouncements: false });
    const home = pages.find((p) => p.slug === 'home')!;
    assert.equal(JSON.stringify(home.published).includes('"announcements"'), false);
    assert.equal(pages.find((p) => p.slug === 'contact-us')!.published, null);
    assert.equal(pageContentSchema.parse(home.published).sections[0]!.content.slides[0].headline.en, 'X');
  });
  test('shade darkens', () => assert.equal(shade('#ffffff', 0.5), '#808080'));
});
