/**
 * Website CMS: real API against an in-memory MongoDB replica set, reading the data back.
 * Covers draft/publish separation, revisions, section ordering, media (uploads, Cloudinary and
 * external URLs, reference checks), collections, languages, SEO output, permissions and that the
 * module never touches existing school data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, type World } from './helpers.js';
import { SchoolSettings, Student, User, WebsiteConfig, WebsiteInquiry, WebsiteItem, WebsiteMedia, WebsitePage, WebsiteRevision } from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';
import { invalidateSettings } from '../src/services/settings.js';
import { signCloudinaryParams } from '../src/services/cloudinary.js';
import { sniffVideo } from '../src/services/uploads.js';
import { publishDueScheduledPages } from '../src/services/website.js';
import { injectHead, renderSiteHead } from '../src/services/website-seo.js';
import { hashPassword } from '../src/security/crypto.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 2)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 3)]);

async function enableSite() {
  await SchoolSettings.updateOne({ _id: 'school' }, { $set: { 'website.enabled': true } });
  invalidateSettings();
}
const pub = (path: string) => request(w.app).get(`/api/public/site${path}`);
async function pageBySlug(p: Awaited<ReturnType<typeof login>>, slug: string) {
  const list = (await p.get('/api/website/pages')).body.data as { _id: string; slug: string }[];
  const id = list.find((x) => x.slug === slug)!._id;
  return (await p.get(`/api/website/pages/${id}`)).body.data;
}

describe('first use and data preservation', () => {
  it('creates the starter website without changing any existing record', async () => {
    const before = { students: await Student.find().lean(), users: await User.find().lean(), settings: await SchoolSettings.findById('school').lean() };
    const p = await login(w.app, 'principal');
    const o = await p.get('/api/website/overview');
    expect(o.status).toBe(200);
    expect(o.body.data.pages.total).toBeGreaterThanOrEqual(22);
    expect(await WebsiteConfig.countDocuments()).toBe(1);
    // Idempotent: a second visit creates nothing new.
    await p.get('/api/website/overview');
    expect(await WebsitePage.countDocuments()).toBe(o.body.data.pages.total);
    expect(await Student.find().lean()).toEqual(before.students);
    const identity = (u: { _id: string; username: string; role: string; status: string; passwordHash: string }) => [u._id, u.username, u.role, u.status, u.passwordHash];
    expect((await User.find().sort({ username: 1 }).lean()).map(identity)).toEqual([...before.users].sort((a, b) => a.username.localeCompare(b.username)).map(identity));
    expect(await SchoolSettings.findById('school').lean()).toEqual(before.settings);
  });

  it('only pages built from real school data are public at first; sample pages stay drafts', async () => {
    await enableSite();
    const boot = await pub('/bootstrap');
    expect(boot.status).toBe(200);
    expect(boot.body.data.school.name).toBe('Test School');
    expect(boot.body.data.pages.map((x: { slug: string }) => x.slug)).toEqual(['home', 'news', 'contact-us']);
    const home = await pub('/pages/home');
    expect(home.status).toBe(200);
    expect(JSON.stringify(home.body.data)).not.toContain('Sample text');
    expect((await pub('/pages/about-us')).status).toBe(404);
    expect((await pub('/pages/admissions')).status).toBe(404);
  });

  it('the whole public API answers 404 while the website is switched off', async () => {
    for (const path of ['/bootstrap', '/pages/home', '/items?type=news']) expect((await pub(path)).status).toBe(404);
    expect((await request(w.app).post('/api/public/site/inquiries').send({ kind: 'contact', name: 'Someone', phone: '0300 1112233' })).status).toBe(404);
  });
});

describe('pages: create, edit, order sections, draft vs published, revisions', () => {
  it('a draft is invisible publicly until published; unpublished changes stay private', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const about = await pageBySlug(p, 'about-us');
    about.draft.sections[0].content.heading = { en: 'About Test School', ur: 'ٹیسٹ اسکول' };
    const saved = await p.patch(`/api/website/pages/${about._id}`, { content: about.draft, version: about.version });
    expect(saved.status).toBe(200);
    expect(saved.body.data.dirty).toBe(true);
    expect((await pub('/pages/about-us')).status).toBe(404);
    // Authenticated preview sees the draft.
    const prev = await p.get('/api/website/preview/pages/about-us');
    expect(prev.body.data.sections[0].content.heading.en).toBe('About Test School');
    expect((await request(w.app).get('/api/website/preview/pages/about-us')).status).toBe(401);

    expect((await p.post(`/api/website/pages/${about._id}/publish`)).status).toBe(200);
    expect((await pub('/pages/about-us')).body.data.sections[0].content.heading.ur).toBe('ٹیسٹ اسکول');

    // Edit again without publishing: public still shows the published version.
    const cur = await pageBySlug(p, 'about-us');
    cur.draft.sections[0].content.heading = { en: 'Work in progress' };
    expect((await p.patch(`/api/website/pages/${cur._id}`, { content: cur.draft, version: cur.version })).body.data.dirty).toBe(true);
    expect((await pub('/pages/about-us')).body.data.sections[0].content.heading.en).toBe('About Test School');
    const stored = await WebsitePage.findById(cur._id).lean();
    expect((stored!.draft as { sections: { content: { heading: { en: string } } }[] }).sections[0]!.content.heading.en).toBe('Work in progress');
    // Discard goes back to the published version.
    expect((await p.post(`/api/website/pages/${cur._id}/discard`)).body.data.dirty).toBe(false);
  });

  it('creates, duplicates and archives a custom page; built-in pages cannot be deleted', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.post('/api/website/pages', { slug: 'news', title: { en: 'x' } })).status).toBe(400);
    const created = await p.post('/api/website/pages', { slug: 'alumni', title: { en: 'Alumni' } });
    expect(created.status).toBe(201);
    expect((await p.post('/api/website/pages', { slug: 'alumni', title: { en: 'Again' } })).status).toBe(409);
    const dup = await p.post(`/api/website/pages/${created.body.data._id}/duplicate`);
    expect(dup.body.data.slug).toBe('alumni-copy');
    expect((await p.del(`/api/website/pages/${created.body.data._id}`)).status).toBe(200);
    expect((await WebsitePage.findById(created.body.data._id).lean())!.deletedAt).toBeTruthy(); // soft delete: still in the database
    expect((await p.post('/api/website/pages', { slug: 'alumni', title: { en: 'Alumni' } })).status).toBe(201); // address is free again
    const home = await pageBySlug(p, 'home');
    expect((await p.del(`/api/website/pages/${home._id}`)).status).toBe(400);
    expect((await p.post(`/api/website/pages/${home._id}/unpublish`)).status).toBe(400);
  });

  it('section order and visibility are persisted and applied publicly', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const page = await pageBySlug(p, 'admissions');
    const ids = page.draft.sections.map((s: { id: string }) => s.id);
    page.draft.sections.reverse();
    page.draft.sections[0].visible = false;
    await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version });
    await p.post(`/api/website/pages/${page._id}/publish`);
    const live = (await pub('/pages/admissions')).body.data.sections.map((s: { id: string }) => s.id);
    expect(live).toEqual([...ids].reverse().slice(1)); // reversed, hidden one removed
    expect((await pageBySlug(p, 'admissions')).draft.sections.map((s: { id: string }) => s.id)).toEqual([...ids].reverse());
  });

  it('rejects unsafe content on the server', async () => {
    const p = await login(w.app, 'principal');
    const page = await pageBySlug(p, 'about-us');
    const bad = (mutate: (d: typeof page.draft) => void) => { const d = structuredClone(page.draft); mutate(d); return p.patch(`/api/website/pages/${page._id}`, { content: d }); };
    expect((await bad((d) => { d.sections.push({ id: 'x', type: 'cta', content: { cta1: { label: { en: 'Go' }, href: 'javascript:alert(1)' } } }); })).status).toBe(400);
    expect((await bad((d) => { d.sections.push({ id: 'x', type: 'html', content: { html: '<script>' } }); })).status).toBe(400);
    expect((await bad((d) => { d.sections[0].content.image = { kind: 'image', provider: 'local', url: '/uploads/students/photo.png' }; })).status).toBe(400);
    expect((await bad((d) => { d.sections[0].content.image = { id: '3f0e5b0a-6a59-4a51-9d55-0d2f4f4f7a11', kind: 'image', provider: 'local', url: '/uploads/website/3f0e5b0a-6a59-4a51-9d55-0d2f4f4f7a11.png' }; })).status).toBe(400); // unknown media id
  });

  it('optimistic concurrency: a stale editor gets 409 instead of overwriting', async () => {
    const p = await login(w.app, 'principal');
    const page = await pageBySlug(p, 'about-us');
    expect((await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version })).status).toBe(200);
    expect((await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version })).status).toBe(409);
  });

  it('revision history restores a previous published version into the draft', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    let page = await pageBySlug(p, 'faqs');
    const setHeading = async (text: string) => {
      page = await pageBySlug(p, 'faqs');
      page.draft.sections[0].content.heading = { en: text };
      await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version });
      await p.post(`/api/website/pages/${page._id}/publish`);
    };
    await setHeading('Version one');
    await setHeading('Version two');
    const revs = (await p.get(`/api/website/revisions?scope=page&pageId=${page._id}`)).body.data;
    expect(revs).toHaveLength(2);
    expect(revs[0].snapshot).toBeUndefined(); // list is light; snapshots stay on the server
    const first = revs[revs.length - 1];
    expect((await p.post(`/api/website/revisions/${first._id}/restore`)).status).toBe(200);
    // Restoring does not change the public page by itself…
    expect((await pub('/pages/faqs')).body.data.sections[0].content.heading.en).toBe('Version two');
    expect((await pageBySlug(p, 'faqs')).draft.sections[0].content.heading.en).toBe('Version one');
    // …publishing the restored draft does.
    await p.post(`/api/website/pages/${page._id}/publish`);
    expect((await pub('/pages/faqs')).body.data.sections[0].content.heading.en).toBe('Version one');
    expect(await WebsiteRevision.countDocuments({ pageId: page._id })).toBe(4);
  });

  it('scheduled publishing publishes the draft when its time arrives', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const page = await pageBySlug(p, 'gallery');
    expect((await p.post(`/api/website/pages/${page._id}/schedule`, { at: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    const at = new Date(Date.now() + 3600_000);
    expect((await p.post(`/api/website/pages/${page._id}/schedule`, { at: at.toISOString() })).status).toBe(200);
    expect(await publishDueScheduledPages(new Date())).toBe(0);
    expect((await pub('/pages/gallery')).status).toBe(404);
    expect(await publishDueScheduledPages(new Date(at.getTime() + 1000))).toBe(1);
    expect((await pub('/pages/gallery')).status).toBe(200);
    expect((await WebsitePage.findById(page._id).lean())!.scheduledAt).toBeNull();
  });
});

describe('site configuration: navigation, theme, languages, publish', () => {
  it('saves parts as a draft and only publishes on request; links to unpublished pages are validated', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const site = (await p.get('/api/website/site')).body.data;
    const theme = { ...site.draft.theme, primary: '#0f3d33', headingFont: 'serif-modern' };
    const r = await p.patch('/api/website/site/theme', { value: theme, version: site.version });
    expect(r.status).toBe(200);
    expect(r.body.data.dirty).toBe(true);
    // Still the published default (the school's navy brand colour) until the draft is published.
    expect((await pub('/bootstrap')).body.data.site.theme.primary).toBe('#1c1f5e');
    expect((await p.post('/api/website/site/publish')).status).toBe(200);
    expect((await pub('/bootstrap')).body.data.site.theme.primary).toBe('#0f3d33');
    // Controlled design tokens only.
    expect((await p.patch('/api/website/site/theme', { value: { ...theme, primary: 'red' } })).status).toBe(400);
    expect((await p.patch('/api/website/site/theme', { value: { ...theme, headingFont: 'Papyrus' } })).status).toBe(400);
    expect((await p.patch('/api/website/site/navigation', { value: { items: [{ id: 'x', label: { en: 'Bad' }, href: 'javascript:void(0)' }] } })).status).toBe(400);
    expect((await p.patch('/api/website/site/unknown', { value: {} })).status).toBe(400);
  });

  it('language settings and the translation report', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/website/site/languages', { value: { enabled: ['en'], default: 'ur' } })).status).toBe(400);
    expect((await p.patch('/api/website/site/languages', { value: { enabled: ['en', 'ur'], default: 'ur' } })).status).toBe(200);
    const t = (await p.get('/api/website/translations')).body.data;
    expect(t.default).toBe('ur');
    expect(t.report[0].lang).toBe('en');
    const back = await p.patch('/api/website/site/languages', { value: { enabled: ['en', 'ur'], default: 'en' } });
    expect(back.status).toBe(200);
    const rep = (await p.get('/api/website/translations')).body.data.report[0];
    expect(rep.lang).toBe('ur');
    expect(rep.missing).toBeGreaterThan(0); // sample body text has no Urdu yet and is reported, not hidden
    expect(rep.rows.find((x: { label: string }) => x.label === 'About Us')).toBeTruthy();
  });
});

describe('media library', () => {
  it('manual image and video uploads are type-checked by content and stored under uploads/website', async () => {
    const p = await login(w.app, 'principal');
    const up = (buf: Buffer, name: string, type: string) => p.agent.post('/api/website/media/upload').set('x-csrf-token', p.csrf).attach('file', buf, { filename: name, contentType: type });
    const img = await up(PNG, 'campus.png', 'image/png');
    expect(img.status).toBe(201);
    expect(img.body.data).toMatchObject({ kind: 'image', provider: 'local', source: 'upload', mime: 'image/png' });
    expect(img.body.data.url).toMatch(/^\/uploads\/website\/[0-9a-f-]{36}\.png$/);
    expect((await request(w.app).get(img.body.data.url)).status).toBe(200);
    const vid = await up(MP4, 'tour.mp4', 'video/mp4');
    expect(vid.body.data).toMatchObject({ kind: 'video', mime: 'video/mp4' });
    expect((await up(WEBM, 'tour.webm', 'video/webm')).body.data.mime).toBe('video/webm');
    // The declared type and extension are ignored: content decides.
    expect((await up(Buffer.from('<?php echo 1; ?> padding padding'), 'shell.png', 'image/png')).status).toBe(400);
    expect((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'x.svg', 'image/svg+xml')).status).toBe(400);
    expect((await up(PNG, '../../evil.png', 'image/png')).body.data.url).toMatch(/^\/uploads\/website\/[0-9a-f-]{36}\.png$/);
    expect(await WebsiteMedia.countDocuments()).toBe(4);
    expect((await request(w.app).post('/api/website/media/upload').attach('file', PNG, 'a.png')).status).toBe(401);
  });

  it('recognises HEIC/QuickTime as not-a-web-video', () => {
    expect(sniffVideo(MP4)).toBe('mp4');
    expect(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]))).toBeNull();
    expect(sniffVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(8)]))).toBeNull();
    expect(sniffVideo(PNG)).toBeNull();
  });

  it('registers Cloudinary and external video URLs without fetching them; rejects everything else', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const p = await login(w.app, 'principal');
    const c = await p.post('/api/website/media/register', { url: 'https://res.cloudinary.com/demo/image/upload/v1/school/hero.jpg' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ kind: 'image', provider: 'cloudinary', source: 'url', publicId: 'school/hero' });
    // Registering the same URL again reuses the asset.
    expect((await p.post('/api/website/media/register', { url: 'https://res.cloudinary.com/demo/image/upload/v1/school/hero.jpg' })).body.data._id).toBe(c.body.data._id);
    const cv = await p.post('/api/website/media/register', { url: 'https://res.cloudinary.com/demo/video/upload/v1/tour.mp4' });
    expect(cv.body.data.kind).toBe('video');
    const yt = await p.post('/api/website/media/register', { url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(yt.body.data).toMatchObject({ provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
    for (const url of ['https://example.org/video.mp4', 'http://169.254.169.254/latest/meta-data', 'https://res.cloudinary.com.evil.example/demo/image/upload/a.jpg', 'file:///etc/passwd', 'https://localhost/x.jpg']) {
      expect((await p.post('/api/website/media/register', { url })).status, url).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await p.post('/api/website/media/cloudinary-ticket', { kind: 'image' })).status).toBe(409); // not configured in tests: reported, not faked
    expect((await p.get('/api/website/media/config')).body.data.cloudinary).toBe(false);
  });

  it('Cloudinary signatures match the documented algorithm', () => {
    // Example from Cloudinary's "Generating authentication signatures" documentation.
    expect(signCloudinaryParams({ timestamp: 1315060510, public_id: 'sample_image', eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop' }, 'abcd')).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('select from the library, reference check on delete, replace repoints content', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const up = async () => (await p.agent.post('/api/website/media/upload').set('x-csrf-token', p.csrf).attach('file', PNG, 'a.png')).body.data;
    const m = await up();
    const ref = { id: m._id, kind: 'image', provider: 'local', url: m.url, alt: { en: 'Campus' } };
    const page = await pageBySlug(p, 'contact-us');
    page.draft.sections[0].content.image = ref;
    expect((await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version })).status).toBe(200);
    await p.post(`/api/website/pages/${page._id}/publish`);
    expect((await pub('/pages/contact-us')).body.data.sections[0].content.image.url).toBe(m.url);
    expect((await p.get(`/api/website/media/${m._id}/usage`)).body.data).toHaveLength(1);
    const del = await p.del(`/api/website/media/${m._id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.details.usage[0].label).toContain('contact-us');
    // Search + metadata.
    expect((await p.patch(`/api/website/media/${m._id}`, { title: 'Main gate', category: 'campus', alt: { en: 'Main gate' } })).status).toBe(200);
    const list = await p.get('/api/website/media?q=gate&kind=image');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.categories).toEqual(['campus']);
    // Replace: same asset id, new file, content repointed, old file gone.
    const rep = await p.agent.post(`/api/website/media/${m._id}/replace`).set('x-csrf-token', p.csrf).attach('file', PNG, 'b.png');
    expect(rep.status).toBe(200);
    expect(rep.body.data.referencesUpdated).toBe(1);
    expect((await pub('/pages/contact-us')).body.data.sections[0].content.image.url).toBe(rep.body.data.media.url);
    expect((await request(w.app).get(m.url)).status).toBe(404);
    expect((await p.agent.post(`/api/website/media/${m._id}/replace`).set('x-csrf-token', p.csrf).attach('file', MP4, 'b.mp4')).status).toBe(400);
    // Unused assets can be deleted; archived ones leave the default list.
    const spare = await up();
    expect((await p.patch(`/api/website/media/${spare._id}`, { archived: true })).status).toBe(200);
    expect((await p.get('/api/website/media')).body.data.map((x: { _id: string }) => x._id)).not.toContain(spare._id);
    expect((await p.del(`/api/website/media/${spare._id}`)).status).toBe(200);
    expect((await request(w.app).get(spare.url)).status).toBe(404);
  });
});

describe('hero slides', () => {
  it('image and video slides with desktop/mobile media, timing and order are stored and served', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const img = (await p.agent.post('/api/website/media/upload').set('x-csrf-token', p.csrf).attach('file', PNG, 'a.png')).body.data;
    const mob = (await p.agent.post('/api/website/media/upload').set('x-csrf-token', p.csrf).attach('file', PNG, 'm.png')).body.data;
    const vid = (await p.agent.post('/api/website/media/upload').set('x-csrf-token', p.csrf).attach('file', MP4, 'v.mp4')).body.data;
    const r = (m: { _id: string; kind: string; url: string }) => ({ id: m._id, kind: m.kind, provider: 'local', url: m.url });
    const home = await pageBySlug(p, 'home');
    const hero = home.draft.sections.find((s: { type: string }) => s.type === 'hero');
    hero.content.slides = [
      { id: 'film', mediaType: 'video', desktop: r(vid), poster: r(img), headline: { en: 'Campus film' }, durationSec: 12, videoOverride: false },
      { id: 'photo', mediaType: 'image', desktop: r(img), mobile: r(mob), headline: { en: 'Welcome', ur: 'خوش آمدید' }, durationSec: 5, cta1: { label: { en: 'Apply' }, href: '/admissions' } },
      { id: 'off', mediaType: 'none', headline: { en: 'Hidden' }, active: false }
    ];
    const saved = await p.patch(`/api/website/pages/${home._id}`, { content: home.draft, version: home.version });
    expect(saved.status).toBe(200);
    await p.post(`/api/website/pages/${home._id}/publish`);
    const slides = (await pub('/pages/home')).body.data.sections[0].content.slides;
    expect(slides.map((s: { id: string }) => s.id)).toEqual(['film', 'photo', 'off']);
    expect(slides[0]).toMatchObject({ mediaType: 'video', videoOverride: false, durationSec: 12 });
    expect(slides[0].poster.url).toBe(img.url); // poster belongs to the slide; it is not a slide of its own
    expect(slides[1]).toMatchObject({ durationSec: 5 });
    expect(slides[1].mobile.url).toBe(mob.url);
    expect(slides[2].active).toBe(false);
    // An image cannot be used as a video slide, and a YouTube player cannot be a background video.
    hero.content.slides[0].desktop = r(img);
    expect((await p.patch(`/api/website/pages/${home._id}`, { content: home.draft })).status).toBe(400);
  });
});

describe('collections (news, events, faculty, FAQs …)', () => {
  it('only published items are public; lists are attached to the pages that show them', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const a = await p.post('/api/website/items', { type: 'news', status: 'published', data: { title: { en: 'Science fair', ur: 'سائنس میلہ' }, summary: { en: 'Short' }, body: { en: 'Long body' }, date: '2026-10-01' } });
    expect(a.status).toBe(201);
    expect(a.body.data.slug).toBe('science-fair');
    const b = await p.post('/api/website/items', { type: 'news', status: 'draft', data: { title: { en: 'Secret draft' } } });
    expect((await p.post('/api/website/items', { type: 'news', status: 'published', data: { title: { en: 'Science fair' } } })).body.data.slug).toBe('science-fair-2');
    const list = (await pub('/items?type=news')).body.data;
    expect(list.map((i: { slug: string }) => i.slug).sort()).toEqual(['science-fair', 'science-fair-2']);
    expect(list[0].data.body).toBeUndefined(); // lists stay light
    expect((await pub('/items/news/science-fair')).body.data.data.body.en).toBe('Long body');
    expect((await pub(`/items/news/${b.body.data.slug}`)).status).toBe(404);
    expect((await pub('/items/faq/anything')).status).toBe(404); // no detail pages for this type
    // The home page receives its news grid in the same response.
    const home = (await pub('/pages/home')).body.data;
    const newsSection = home.sections.find((s: { type: string; content: { itemType?: string } }) => s.type === 'collection' && s.content.itemType === 'news');
    expect(home.collections[newsSection.id].map((i: { slug: string }) => i.slug)).toContain('science-fair');
    // Unpublish → gone publicly, still in the dashboard.
    expect((await p.patch(`/api/website/items/${a.body.data._id}`, { type: 'news', status: 'draft', data: a.body.data.data, version: a.body.data.version })).status).toBe(200);
    expect((await pub('/items/news/science-fair')).status).toBe(404);
    expect((await p.get('/api/website/items?type=news')).body.data).toHaveLength(3);
    expect((await p.del(`/api/website/items/${a.body.data._id}`)).status).toBe(200);
    expect((await WebsiteItem.findById(a.body.data._id).lean())!.deletedAt).toBeTruthy();
  });

  it('validates per type, filters by group and keeps a manual order', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    expect((await p.post('/api/website/items', { type: 'faq', data: { answer: { en: 'No title' } } })).status).toBe(400);
    expect((await p.post('/api/website/items', { type: 'salary', data: { title: { en: 'x' } } })).status).toBe(400);
    const mk = async (name: string, group: string) => (await p.post('/api/website/items', { type: 'faculty', status: 'published', group, data: { title: { en: name }, designation: { en: 'Teacher' } } })).body.data._id as string;
    const [x, y, z] = [await mk('Ms A', 'teacher'), await mk('Mr B', 'leadership'), await mk('Ms C', 'teacher')];
    expect((await pub('/items?type=faculty&group=leadership')).body.data.map((i: { data: { title: { en: string } } }) => i.data.title.en)).toEqual(['Mr B']);
    expect((await p.post('/api/website/items/reorder', { ids: [z, x, y] })).status).toBe(200);
    expect((await pub('/items?type=faculty')).body.data.map((i: { id: string }) => i.id)).toEqual([z, x, y]);
  });

  it('existing announcements keep working and appear on the new site', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    await p.post('/api/settings/announcements', { title: 'Sports day', body: 'Friday', publishedAt: new Date(Date.now() - 1000).toISOString() });
    await p.post('/api/settings/announcements', { title: 'Hidden draft', body: 'x' });
    expect((await pub('/pages/news')).body.data.announcements.map((a: { title: string }) => a.title)).toEqual(['Sports day']);
    // The original lightweight endpoint is untouched.
    expect((await request(w.app).get('/api/public/website')).body.data.announcements).toHaveLength(1);
  });
});

describe('public forms', () => {
  it('stores real inquiries for the office and ignores bots', async () => {
    await enableSite();
    const send = (body: object) => request(w.app).post('/api/public/site/inquiries').send(body);
    expect((await send({ kind: 'admission', name: 'A Parent', phone: '0300 1112233', grade: 'Grade 5', message: 'Is there a place?' })).status).toBe(201);
    expect((await send({ kind: 'admission', name: 'No contact' })).status).toBe(400);
    expect((await send({ kind: 'contact', name: 'Bot', email: 'bot@spam.example', website: 'http://spam.example' })).status).toBe(201);
    expect(await WebsiteInquiry.countDocuments()).toBe(1);
    const p = await login(w.app, 'principal');
    const inbox = await p.get('/api/website/inquiries?status=new');
    expect(inbox.body.meta.total).toBe(1);
    expect(inbox.body.data[0]).toMatchObject({ name: 'A Parent', grade: 'Grade 5', status: 'new' });
    expect((await p.patch(`/api/website/inquiries/${inbox.body.data[0]._id}`, { status: 'closed' })).status).toBe(200);
    expect((await p.get('/api/website/overview')).body.data.newInquiries).toBe(0);
    expect((await request(w.app).get('/api/website/inquiries')).status).toBe(401);
  });
});

describe('SEO output', () => {
  it('head tags, canonical, hreflang and RTL for published pages; 404 + noindex otherwise', async () => {
    await enableSite();
    const p = await login(w.app, 'principal');
    const page = await pageBySlug(p, 'contact-us');
    page.draft.seo = { title: { en: 'Contact the school', ur: 'اسکول سے رابطہ' }, description: { en: 'Address & "phone" <numbers>' } };
    await p.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version });
    await p.post(`/api/website/pages/${page._id}/publish`);
    const en = (await renderSiteHead('/contact-us'))!;
    expect(en).toMatchObject({ status: 200, lang: 'en', dir: 'ltr' });
    expect(en.head).toContain('<title>Contact the school — Test School</title>');
    expect(en.head).toContain('content="Address &amp; &quot;phone&quot; &lt;numbers&gt;"');
    expect(en.head).toContain('<link rel="canonical" href="http://localhost:8080/site/contact-us" />');
    expect(en.head).toContain('hreflang="ur" href="http://localhost:8080/site/ur/contact-us"');
    const ur = (await renderSiteHead('/ur/contact-us'))!;
    expect(ur).toMatchObject({ status: 200, lang: 'ur', dir: 'rtl' });
    expect(ur.head).toContain('اسکول سے رابطہ');
    const draft = (await renderSiteHead('/about-us'))!;
    expect(draft.status).toBe(404);
    expect(draft.head).toContain('noindex');
    expect(draft.head).not.toContain('canonical');
    const home = (await renderSiteHead(''))!;
    expect(home.head).toContain('"@type":"School"');
    expect(home.head).not.toMatch(/aggregateRating|review/i);
    expect(injectHead('<html lang="en" dir="ltr"><head><title>School Management</title></head></html>', ur)).toMatch(/^<html lang="ur" dir="rtl"><head><title>/);
  });

  it('sitemap and robots list only published, indexable pages', async () => {
    expect((await request(w.app).get('/sitemap.xml')).status).toBe(404);
    expect((await request(w.app).get('/robots.txt')).text).toContain('Disallow: /site');
    await enableSite();
    const p = await login(w.app, 'principal');
    await p.post('/api/website/items', { type: 'news', status: 'published', data: { title: { en: 'Open day' } } });
    await p.post('/api/website/items', { type: 'news', status: 'draft', data: { title: { en: 'Not yet' } } });
    const xml = (await request(w.app).get('/sitemap.xml')).text;
    expect(xml).toContain('<loc>http://localhost:8080/site</loc>');
    expect(xml).toContain('<loc>http://localhost:8080/site/ur/contact-us</loc>');
    expect(xml).toContain('/site/news/open-day');
    expect(xml).not.toContain('not-yet');
    expect(xml).not.toContain('about-us');
    const robots = (await request(w.app).get('/robots.txt')).text;
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Sitemap: http://localhost:8080/sitemap.xml');
    const site = (await p.get('/api/website/site')).body.data;
    await p.patch('/api/website/site/seo', { value: { ...site.draft.seo, allowIndexing: false } });
    await p.post('/api/website/site/publish');
    expect((await request(w.app).get('/sitemap.xml')).status).toBe(404);
  });
});

describe('roles and permissions', () => {
  it('teachers and staff cannot use the CMS; an editor without publish rights can only draft', async () => {
    await enableSite();
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/website/overview')).status).toBe(403);
    expect((await t.get('/api/website/pages')).status).toBe(403);
    expect((await t.post('/api/website/pages', { slug: 'x-page', title: { en: 'X' } })).status).toBe(403);
    expect((await t.agent.post('/api/website/media/upload').set('x-csrf-token', t.csrf).attach('file', PNG, 'a.png')).status).toBe(403);
    expect(await WebsiteMedia.countDocuments()).toBe(0);
    expect((await t.get('/api/website/preview/pages/home')).status).toBe(403);

    // A staff member granted only website.manage.
    await createVersioned(User, { username: 'editor', fullName: 'EDITOR', role: 'staff', passwordHash: await hashPassword('Correct-Horse-9'), extraPermissions: ['website.manage'] });
    const e = await login(w.app, 'editor');
    const page = await pageBySlug(e, 'about-us');
    expect((await e.patch(`/api/website/pages/${page._id}`, { content: page.draft, version: page.version })).status).toBe(200);
    expect((await e.post(`/api/website/pages/${page._id}/publish`)).status).toBe(403);
    expect((await e.post('/api/website/site/publish')).status).toBe(403);
    expect((await e.put('/api/website/domain', { domain: 'www.school.example' })).status).toBe(403);
    expect((await e.post('/api/website/items', { type: 'faq', status: 'published', data: { title: { en: 'Q' } } })).status).toBe(403);
    const draft = await e.post('/api/website/items', { type: 'faq', status: 'draft', data: { title: { en: 'Q' } } });
    expect(draft.status).toBe(201);
    expect((await e.del(`/api/website/items/${draft.body.data._id}`)).status).toBe(403);
    expect((await pub('/pages/about-us')).status).toBe(404);

    const a = await login(w.app, 'admin1');
    expect((await a.post(`/api/website/pages/${page._id}/publish`)).status).toBe(200);
  });

  it('state-changing requests need the CSRF token', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.agent.post('/api/website/pages').send({ slug: 'no-csrf', title: { en: 'x' } })).status).toBe(403);
  });
});

describe('custom domain', () => {
  it('validates the domain, issues a TXT token and only becomes canonical after verification', async () => {
    const p = await login(w.app, 'principal');
    for (const bad of ['localhost', '192.168.1.5', 'printer.local', 'not a domain']) expect((await p.put('/api/website/domain', { domain: bad })).status, bad).toBe(400);
    const set = await p.put('/api/website/domain', { domain: 'https://WWW.School-A.example.com/' });
    expect(set.body.data.domain).toMatchObject({ domain: 'www.school-a.example.com', status: 'unverified', txtName: '_school-site.www.school-a.example.com' });
    expect(set.body.data.domain.txtValue).toMatch(/^school-site-verification=[0-9a-f]{32}$/);
    expect((await p.get('/api/website/site')).body.data.canonicalBase).toBe('http://localhost:8080'); // unverified domains are never used
    await WebsiteConfig.updateOne({ _id: 'site' }, { $set: { 'domain.status': 'verified' } });
    expect((await p.get('/api/website/site')).body.data.canonicalBase).toBe('https://www.school-a.example.com');
    expect((await p.put('/api/website/domain', { domain: '' })).body.data.domain).toBeNull();
  });
});

describe('preview, discard and ordering', () => {
  it('live preview validates unsaved content without storing it; draft bootstrap lists unpublished pages', async () => {
    const p = await login(w.app, 'principal');
    const before = await pageBySlug(p, 'about-us');
    const content = structuredClone(before.draft);
    content.sections[0].content.heading = { en: 'Unsaved heading' };
    const r = await p.post('/api/website/preview/resolve', { content });
    expect(r.status).toBe(200);
    expect(r.body.data.sections[0].content.heading.en).toBe('Unsaved heading');
    expect((await pageBySlug(p, 'about-us')).draft).toEqual(before.draft); // nothing was written
    content.sections.push({ id: 'bad', type: 'cta', content: { cta1: { label: { en: 'x' }, href: 'javascript:1' } } });
    expect((await p.post('/api/website/preview/resolve', { content })).status).toBe(400);
    const boot = await p.get('/api/website/preview/bootstrap');
    expect(boot.body.data.preview).toBe(true);
    expect(boot.body.data.pages.map((x: { slug: string }) => x.slug)).toContain('about-us');
    expect((await request(w.app).post('/api/website/preview/resolve').send({ content })).status).toBe(401);
  });

  it('site settings can be discarded back to the published copy; pages can be reordered', async () => {
    const p = await login(w.app, 'principal');
    const site = (await p.get('/api/website/site')).body.data;
    await p.patch('/api/website/site/footer', { value: { ...site.draft.footer, copyright: { en: 'Changed' } } });
    expect((await p.get('/api/website/site')).body.data.dirty).toBe(true);
    expect((await p.post('/api/website/site/discard')).body.data.dirty).toBe(false);
    expect((await p.get('/api/website/site')).body.data.draft.footer.copyright.en).toBe('All rights reserved.');
    const ids = ((await p.get('/api/website/pages')).body.data as { _id: string }[]).map((x) => x._id);
    const moved = [ids[ids.length - 1]!, ...ids.slice(0, -1)];
    expect((await p.post('/api/website/pages/reorder', { ids: moved })).status).toBe(200);
    expect(((await p.get('/api/website/pages')).body.data as { _id: string }[]).map((x) => x._id)).toEqual(moved);
  });
});
