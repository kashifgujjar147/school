import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, ChevronDown, LogIn, Facebook, Instagram, Linkedin, Menu, MessageCircle, Twitter, X, Youtube } from 'lucide-react';
import { WEBSITE_LANGUAGE_NAMES, sitePath } from '@sms/shared';
import { SiteLink, useSite } from './context';
import { useScrolled } from './hooks';
import { ContactDetails } from './Sections';
import { BRAND, logoOf, splitSchoolName } from '../../brand';

function Brand({ light, size = 'md' }: { light: boolean; size?: 'md' | 'lg' }) {
  const { boot, url } = useSite();
  const [main, sub] = splitSchoolName(boot.school.name);
  return (
    <Link to={url('/') ?? '/site'} className="site-brand group flex min-w-0 items-center gap-3.5" aria-label={boot.school.name}>
      <img src={logoOf(boot.school.logoUrl)} alt="" className={clsx('site-brand-logo shrink-0 rounded-full bg-white object-contain p-[2px]', size === 'lg' ? 'h-20 w-20' : 'h-12 w-12 sm:h-14 sm:w-14', light ? 'shadow-[0_6px_24px_-6px_rgb(0_0_0/0.45)]' : 'shadow-[0_0_0_1px_rgb(var(--site-primary)/0.08)]')} />
      <span className="min-w-0">
        <span className="line-clamp-2 block font-display text-[1.05rem] font-semibold leading-tight sm:text-[1.3rem]">{main}</span>
        {sub && <span className={clsx('mt-1 block text-[0.66rem] font-semibold uppercase tracking-[0.28em] rtl:tracking-normal', light ? 'text-site-accent' : 'text-site-accent-text')}>{sub}</span>}
      </span>
    </Link>
  );
}

/** Links to the same page in every other enabled language (language-specific URLs, not a cookie). */
function LanguageSwitch({ pathHref, className }: { pathHref: string; className?: string }) {
  const { boot, lang, defaultLang, s } = useSite();
  const { search } = useLocation();
  const langs = boot.site.languages.enabled;
  if (langs.length < 2 || !boot.site.navigation.showLanguageSwitcher) return null;
  return (
    <div className={clsx('flex items-center gap-1 text-xs font-semibold', className)} role="group" aria-label={s('language')}>
      {langs.map((l, k) => (
        <span key={l} className="flex items-center gap-1">
          {k > 0 && <span className="opacity-40" aria-hidden>/</span>}
          <Link to={sitePath(pathHref, l, defaultLang) + search} hrefLang={l} lang={l} aria-current={l === lang ? 'true' : undefined} className={clsx('px-1 py-1 transition-opacity', l === lang ? 'opacity-100 underline underline-offset-4' : 'opacity-60 hover:opacity-100')}>
            {l === 'en' ? 'EN' : WEBSITE_LANGUAGE_NAMES[l] ?? l.toUpperCase()}
          </Link>
        </span>
      ))}
    </div>
  );
}

export function Header({ overHero, pathHref }: { overHero: boolean; pathHref: string }) {
  const { boot, t, s, url } = useSite();
  const nav = boot.site.navigation;
  const scrolled = useScrolled();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drop, setDrop] = useState<string | null>(null);
  const loc = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const light = overHero && !scrolled && !open && boot.site.theme.headerStyle === 'overlay';
  const items = nav.items.map((i) => ({ ...i, children: i.children.filter((c) => url(c.href) && t(c.label)) })).filter((i) => (url(i.href) || i.children.length) && t(i.label));
  const isCurrent = (href: string) => { const u = url(href); return Boolean(u && u.split('?')[0] === loc.pathname); };

  useEffect(() => { setOpen(false); setDrop(null); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('a,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <header className={clsx('site-header fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,color] duration-500', light ? 'is-light text-white' : open ? 'bg-site-bg text-site-ink shadow-[0_1px_0_rgb(16_24_40/0.06)]' : 'bg-white/90 text-site-ink shadow-[0_1px_0_rgb(16_24_40/0.06),0_10px_30px_-18px_rgb(13_16_51/0.35)] backdrop-blur-xl')}>
      <a href="#site-main" className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-[60] focus:bg-white focus:px-4 focus:py-2 focus:text-site-ink">{s('skipToContent')}</a>
      <div className={clsx('mx-auto flex max-w-site items-center justify-between gap-6 px-6 transition-[height] duration-500 sm:px-10 lg:px-14', scrolled ? 'h-[4.5rem] xl:h-16' : 'h-24 xl:h-[5.25rem]')}>
        <Brand light={light} />
        <div className="flex shrink-0 items-center gap-5">
          <LanguageSwitch pathHref={pathHref} className="hidden sm:flex" />
          {nav.showStaffLogin && <Link to="/login" className={clsx('site-login hidden items-center gap-2 text-[0.74rem] font-semibold uppercase tracking-[0.16em] transition-opacity hover:opacity-100 rtl:text-sm rtl:tracking-normal sm:flex', light ? 'opacity-90' : 'text-site-primary opacity-90')}><LogIn className="h-4 w-4" aria-hidden />{s('login')}</Link>}
          {nav.cta && t(nav.cta.label) && <span className="hidden md:block"><SiteLink href={nav.cta.href} className={clsx('site-btn !min-h-[2.75rem] !px-5', light ? 'site-btn-outline is-light' : 'site-btn-primary')}>{t(nav.cta.label)}</SiteLink></span>}
          <button type="button" className="flex h-11 w-11 items-center justify-center xl:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="site-mobile-nav" aria-label={open ? s('close') : s('menu')}>{open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
        </div>
      </div>
      {/* backdrop-blur is dropped while the mobile menu is open: a backdrop-filter would make this header the
          containing block of the fixed menu panel, squeezing it into the header bar. */}
      {/* Desktop: the menu has its own row, so long school names and translated labels never collide. */}
      <div className={clsx('hidden border-t xl:block', light ? 'border-white/20' : 'site-hair')}>
        <nav className="mx-auto flex h-12 max-w-site items-center gap-9 px-6 sm:px-10 lg:px-14" aria-label={s('menu')}>
          {items.map((i) => (
            <div key={i.id} className="site-nav-item relative" data-open={drop === i.id} onMouseLeave={() => setDrop(null)} onKeyDown={(e) => { if (e.key === 'Escape') { setDrop(null); (document.activeElement as HTMLElement | null)?.blur(); } }}>
              <span className="flex items-center gap-1">
                {url(i.href)
                  ? <SiteLink href={i.href} ariaCurrent={isCurrent(i.href)} className="site-nav-link whitespace-nowrap py-1 text-[0.76rem] font-medium uppercase tracking-[0.14em] rtl:text-base rtl:tracking-normal">{t(i.label)}</SiteLink>
                  : <span className="whitespace-nowrap py-1 text-[0.76rem] font-medium uppercase tracking-[0.14em] rtl:text-base rtl:tracking-normal">{t(i.label)}</span>}
                {i.children.length > 0 && <button type="button" className="p-1" aria-expanded={drop === i.id} aria-label={`${t(i.label)}: ${s('menu')}`} onClick={() => setDrop(drop === i.id ? null : i.id)}><ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden /></button>}
              </span>
              {i.children.length > 0 && (
                <div className="site-dropdown absolute start-0 top-full z-10 w-64 pt-3">
                  <ul className="border-t-2 border-site-accent bg-white py-3 text-site-ink shadow-xl">
                    {i.children.map((c) => <li key={c.id}><SiteLink href={c.href} ariaCurrent={isCurrent(c.href)} className="block px-6 py-2.5 text-sm transition-colors duration-200 hover:bg-site-primary/5 hover:text-site-primary">{t(c.label)}</SiteLink></li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
      {open && (
        <div id="site-mobile-nav" ref={panel} className="site-page-enter fixed inset-x-0 bottom-0 top-[4.5rem] overflow-y-auto bg-site-bg text-site-ink xl:hidden" style={{ top: scrolled ? '4.5rem' : '6rem' }}>
          <nav className="mx-auto max-w-site px-6 pb-16 pt-4 sm:px-10" aria-label={s('menu')}>
            <ul>
              {items.map((i) => (
                <li key={i.id} className="border-b site-hair">
                  <div className="flex items-center justify-between">
                    {url(i.href) ? <SiteLink href={i.href} className="flex-1 py-5 font-display text-2xl">{t(i.label)}</SiteLink> : <span className="flex-1 py-5 font-display text-2xl">{t(i.label)}</span>}
                    {i.children.length > 0 && <button type="button" className="flex h-12 w-12 items-center justify-center" aria-expanded={expanded === i.id} aria-label={t(i.label)} onClick={() => setExpanded(expanded === i.id ? null : i.id)}><ChevronDown className={clsx('h-5 w-5 transition-transform duration-300', expanded === i.id && 'rotate-180')} aria-hidden /></button>}
                  </div>
                  {expanded === i.id && <ul className="pb-4 ps-4">{i.children.map((c) => <li key={c.id}><SiteLink href={c.href} className="block py-2.5 text-site-soft">{t(c.label)}</SiteLink></li>)}</ul>}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-5">
              <div className="flex flex-wrap gap-3">
                {nav.cta && t(nav.cta.label) && <SiteLink href={nav.cta.href} className="site-btn site-btn-primary">{t(nav.cta.label)}<ArrowRight aria-hidden /></SiteLink>}
                {nav.showStaffLogin && <Link to="/login" className="site-btn site-btn-outline"><LogIn aria-hidden />{s('login')}</Link>}
              </div>
              <LanguageSwitch pathHref={pathHref} className="text-sm" />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

const SOCIAL = { facebook: Facebook, instagram: Instagram, youtube: Youtube, x: Twitter, linkedin: Linkedin, whatsapp: MessageCircle } as const;

export function Footer() {
  const { boot, t, s, url } = useSite();
  const f = boot.site.footer; const c = boot.site.contact;
  const dark = boot.site.theme.footerStyle === 'dark';
  const social = (Object.keys(SOCIAL) as (keyof typeof SOCIAL)[]).filter((k) => c.social[k]);
  const columns = f.columns.map((col) => ({ ...col, links: col.links.filter((l) => url(l.href) && t(l.label)) })).filter((col) => col.links.length);
  const policies = f.policyLinks.filter((l) => url(l.href) && t(l.label));
  return (
    <footer className={clsx(dark ? 'site-on-dark bg-site-secondary text-white' : 'border-t site-hair bg-white text-site-ink')}>
      <div className="mx-auto grid max-w-site gap-14 px-6 py-20 sm:px-10 lg:grid-cols-12 lg:px-14">
        <div className="lg:col-span-4">
          <Brand light={dark} size="lg" />
          <p className={clsx('mt-6 font-display text-xl italic', dark ? 'text-site-accent' : 'text-site-accent-text')}>{BRAND.tagline}</p>
          {t(f.about) && <p className="mt-6 max-w-sm leading-relaxed opacity-75">{t(f.about)}</p>}
          {f.showSocial && social.length > 0 && (
            <ul className="mt-8 flex gap-3" aria-label={s('followUs')}>
              {social.map((k) => { const I = SOCIAL[k]; return <li key={k}><a href={c.social[k]} target="_blank" rel="noopener noreferrer" aria-label={k} className={clsx('flex h-11 w-11 items-center justify-center rounded-full border transition-colors duration-300', dark ? 'border-white/25 hover:bg-white hover:text-site-ink' : 'border-site-ink/20 hover:bg-site-primary hover:text-site-on-primary')}><I className="h-4 w-4" aria-hidden /></a></li>; })}
            </ul>
          )}
        </div>
        {columns.map((col) => (
          <nav key={col.id} className="lg:col-span-2" aria-label={t(col.title)}>
            <h2 className="site-eyebrow !font-site mb-6 text-site-accent">{t(col.title)}</h2>
            <ul className="space-y-3">{col.links.map((l) => <li key={l.id}><SiteLink href={l.href} className="opacity-80 transition-opacity hover:opacity-100 hover:underline hover:underline-offset-4">{t(l.label)}</SiteLink></li>)}</ul>
          </nav>
        ))}
        <div className={clsx(columns.length >= 2 ? 'lg:col-span-4' : 'lg:col-span-6')}>
          <h2 className="site-eyebrow !font-site mb-6 text-site-accent">{s('contact')}</h2>
          <ContactDetails compact />
        </div>
      </div>
      <div className={clsx('border-t', dark ? 'border-white/15' : 'site-hair')}>
        <div className="mx-auto flex max-w-site flex-col items-start justify-between gap-4 px-6 py-7 text-sm opacity-80 sm:px-10 md:flex-row md:items-center lg:px-14">
          <p>© <span className="num">{new Date().getFullYear()}</span> {boot.school.name}. {t(f.copyright)}</p>
          <ul className="flex flex-wrap gap-x-7 gap-y-2">
            {policies.map((l) => <li key={l.id}><SiteLink href={l.href} className="hover:underline hover:underline-offset-4">{t(l.label)}</SiteLink></li>)}
            {boot.site.navigation.showStaffLogin && <li><Link to="/login" className="hover:underline hover:underline-offset-4">{s('staffLogin')}</Link></li>}
          </ul>
        </div>
      </div>
    </footer>
  );
}
