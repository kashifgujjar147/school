import { createContext, useContext, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DETAIL_PREFIXES, pickL10n, sitePath, type L10n, type MediaRef, type Section, type SiteContent } from '@sms/shared';
import { siteString, type SiteStrings } from './strings';

export interface Bootstrap {
  school: { name: string; logoUrl: string | null; faviconUrl: string | null };
  site: SiteContent; pages: { slug: string; title: L10n }[]; canonicalBase: string; preview: boolean;
}
export interface PublicItem { id: string; type: keyof typeof DETAIL_PREFIXES | string; slug: string; featured: boolean; group: string; date: string | null; hasDetail: boolean; data: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Announcement { _id: string; title: string; body: string; publishedAt: string; pinned: boolean }
export interface ResolvedPage {
  slug: string; status: string; title: L10n; seo: { title?: L10n; description?: L10n; ogImage?: MediaRef | null; noindex?: boolean };
  sections: Section[]; collections: Record<string, PublicItem[]>; announcements: Announcement[]; stats: { students: number; teachers: number; classes: number } | null;
}

export interface SiteCtx {
  boot: Bootstrap; lang: string; defaultLang: string; rtl: boolean; preview: boolean;
  /** Localized content with fallback to the default language. */
  t: (v: L10n | null | undefined) => string;
  /** Fixed interface strings. */
  s: (key: keyof SiteStrings, vars?: Record<string, string | number>) => string;
  /** Public URL for a CMS href (language-aware); null when it points at a page that is not published. */
  url: (href: string | null | undefined) => string | null;
  fmtDate: (iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) => string;
}

const Ctx = createContext<SiteCtx | null>(null);
export const SiteProvider = Ctx.Provider;
export function useSite(): SiteCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSite outside the public site');
  return c;
}

export function makeSiteCtx(boot: Bootstrap, lang: string, rtl: boolean, previewQuery: string): SiteCtx {
  const def = boot.site.languages.default;
  const live = new Set(boot.pages.map((p) => p.slug));
  const detail = new Set<string>(Object.values(DETAIL_PREFIXES));
  const locale = lang === 'ur' ? 'ur-PK-u-nu-latn' : lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  return {
    boot, lang, defaultLang: def, rtl, preview: boot.preview,
    t: (v) => pickL10n(v, lang, def),
    s: (key, vars) => siteString(lang, key, vars),
    url: (href) => {
      if (!href) return null;
      if (!href.startsWith('/')) return href;
      const [path, hash] = href.split('#') as [string, string | undefined];
      const first = path.split('/').filter(Boolean)[0];
      // Never render a link into a page visitors cannot open.
      if (first && first !== 'home' && !live.has(first) && !detail.has(first)) return null;
      return sitePath(path || '/', lang, def) + previewQuery + (hash ? `#${hash}` : '');
    },
    fmtDate: (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => {
      if (!iso) return '';
      const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
      return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, opts).format(d);
    }
  };
}

/** Link that understands CMS hrefs: internal paths use the router, everything else is a normal anchor. Renders nothing for dead internal links. */
export function SiteLink({ href, className, children, onClick, ariaCurrent }: { href: string | null | undefined; className?: string; children: ReactNode; onClick?: () => void; ariaCurrent?: boolean }) {
  const { url } = useSite();
  const to = url(href);
  if (!to) return null;
  if (to.startsWith('/')) return <Link to={to} className={className} onClick={onClick} aria-current={ariaCurrent ? 'page' : undefined}>{children}</Link>;
  if (to.startsWith('#')) return <a href={to} className={className} onClick={onClick}>{children}</a>;
  const external = to.startsWith('http');
  return <a href={to} className={className} onClick={onClick} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}
