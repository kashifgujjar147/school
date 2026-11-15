import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SECTION_CONTENT, defaultSiteContent, heroSlideSchema, siteContentSchema, type Section, type SiteContent } from '@sms/shared';
import { SiteProvider, makeSiteCtx, type Bootstrap, type ResolvedPage } from './context';
import { siteString } from './strings';
import { SectionView } from './Sections';

const site = siteContentSchema.parse(defaultSiteContent({ name: 'Test School', phone: '0300 1112233' })) as SiteContent;
const boot: Bootstrap = { school: { name: 'Test School', logoUrl: null, faviconUrl: null }, site, pages: [{ slug: 'home', title: { en: 'Home' } }, { slug: 'admissions', title: { en: 'Admissions' } }], canonicalBase: 'http://localhost', preview: false };
const page = (sections: Section[]): ResolvedPage => ({ slug: 'home', status: 'published', title: { en: 'Home' }, seo: {}, sections, collections: {}, announcements: [], stats: null });
const section = (type: Section['type'], content: Record<string, unknown>, id = 's1'): Section => ({ id, type, visible: true, background: 'default', spacing: 'normal', anchor: null, content: SECTION_CONTENT[type].parse(content) as Record<string, unknown> });
const show = (s: Section, lang = 'en', p = page([s])) => render(<MemoryRouter><SiteProvider value={makeSiteCtx(boot, lang, lang === 'ur', '')}><SectionView section={s} page={p} /></SiteProvider></MemoryRouter>);

describe('public site rendering', () => {
  it('interface strings fall back to English for a language without a dictionary', () => {
    expect(siteString('ur', 'readMore')).toBe('مزید پڑھیں');
    expect(siteString('fr', 'readMore')).toBe('Read more');
    expect(siteString('en', 'slide', { n: 2, total: 5 })).toBe('Slide 2 of 5');
  });

  it('shows translated content and falls back to the default language', () => {
    const s = section('cta', { heading: { en: 'Visit us', ur: 'تشریف لائیں' }, intro: { en: 'Only English' } });
    show(s, 'ur');
    expect(screen.getByRole('heading', { name: 'تشریف لائیں' })).toBeInTheDocument();
    expect(screen.getByText('Only English')).toBeInTheDocument();
  });

  it('links to unpublished pages are not rendered; language-specific URLs are used', () => {
    const s = section('cta', { heading: { en: 'x' }, cta1: { label: { en: 'Apply' }, href: '/admissions' }, cta2: { label: { en: 'Hidden' }, href: '/about-us' } });
    show(s, 'ur');
    expect(screen.getByRole('link', { name: /Apply/ })).toHaveAttribute('href', '/site/ur/admissions');
    expect(screen.queryByRole('link', { name: 'Hidden' })).toBeNull();
  });

  it('an empty collection renders nothing publicly (no empty decorative sections)', () => {
    const { container } = show(section('collection', { heading: { en: 'News' }, itemType: 'news' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('statistics show only real numbers', () => {
    const s = section('stats', { items: [{ id: 'a', label: { en: 'Students' }, source: 'students' }, { id: 'b', label: { en: 'Awards' }, source: 'manual', value: null }] });
    const { container } = show(s); // no live counts supplied and no typed value → nothing is invented
    expect(container).toBeEmptyDOMElement();
  });

  it('hero renders each configured slide once, with poster images not counted as slides', () => {
    const slide = (id: string, extra = {}) => heroSlideSchema.parse({ id, headline: { en: `Slide ${id}` }, ...extra });
    const s = section('hero', { slides: [slide('a'), slide('b'), slide('c', { active: false })] });
    show(s);
    expect(screen.getAllByRole('tab')).toHaveLength(2); // the inactive slide is skipped
    expect(screen.getByRole('heading', { level: 1, name: 'Slide a' })).toBeInTheDocument();
  });
});
