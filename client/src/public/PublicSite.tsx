import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { DETAIL_PREFIXES, isRtlLang, parseSitePath, pickL10n, themeCssVars, type PageContent } from '@sms/shared';
import { ApiError, get, post } from '../services/api';
import { applyDir, useLang } from '../i18n';
import { SiteProvider, makeSiteCtx, type Bootstrap, type PublicItem, type ResolvedPage } from './site/context';
import { siteString } from './site/strings';
import { Footer, Header } from './site/Chrome';
import { SectionView } from './site/Sections';
import { ItemDetail } from './site/Collections';
import { useReveal } from './site/hooks';
import './site.css';

/**
 * Public school website. Everything shown comes from the Website CMS:
 *   /site[/<lang>]                       home page
 *   /site[/<lang>]/<page-slug>           any published page
 *   /site[/<lang>]/news|events|gallery/<slug>   detail pages
 * `?preview=1` shows the saved DRAFT to signed-in editors (authenticated API; never public).
 * `?preview=live` is the page builder's frame: it renders unsaved editor content sent by postMessage.
 */
type PreviewMode = 'off' | 'draft' | 'live';

function Message({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 pb-20 pt-40 text-center">
      <span className="site-rule mb-8" aria-hidden />
      <h1 className="text-4xl sm:text-5xl">{title}</h1>
      <p className="mt-5 max-w-md opacity-75">{body}</p>
      {action && <div className="mt-9">{action}</div>}
    </div>
  );
}

function Skeleton() {
  return <div className="site-root flex min-h-screen items-center justify-center" style={themeCssVars(null) as CSSProperties} role="status" aria-label="Loading"><span className="h-10 w-10 animate-spin rounded-full border border-[#101828]/20 border-t-[#101828]/70" /></div>;
}

export function PublicSite() {
  const loc = useLocation();
  const rest = loc.pathname.replace(/^\/site/, '');
  const q = new URLSearchParams(loc.search).get('preview');
  const mode: PreviewMode = q === 'live' ? 'live' : q === '1' ? 'draft' : 'off';
  const api = mode === 'off' ? '/api/public/site' : '/api/website/preview';

  const bootQ = useQuery({ queryKey: ['site-boot', mode], queryFn: () => get<Bootstrap>(`${api}/bootstrap`), staleTime: mode === 'off' ? 60_000 : 0, retry: (n, e) => !(e instanceof ApiError) && n < 2 });
  const boot = bootQ.data;
  const langs = boot?.site.languages.enabled ?? ['en'];
  const route = useMemo(() => parseSitePath(rest, langs), [rest, langs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const lang = route.lang ?? boot?.site.languages.default ?? 'en';
  const rtl = isRtlLang(lang);

  // Live preview: the builder posts the unsaved page; the server validates it and attaches collection data.
  const [live, setLive] = useState<{ content: PageContent; seq: number } | null>(null);
  useEffect(() => {
    if (mode !== 'live') return;
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; content?: PageContent };
      if (d?.type === 'sms-cms-preview' && d.content) setLive((p) => ({ content: d.content!, seq: (p?.seq ?? 0) + 1 }));
    };
    window.addEventListener('message', onMsg);
    window.parent?.postMessage({ type: 'sms-cms-preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMsg);
  }, [mode]);

  const slug = route.kind === 'home' ? 'home' : route.kind === 'page' ? route.slug : null;
  const pageQ = useQuery({
    queryKey: ['site-page', mode, slug, mode === 'live' ? live?.seq : 0],
    queryFn: () => (mode === 'live' ? post<ResolvedPage>('/api/website/preview/resolve', { content: live!.content }) : get<ResolvedPage>(`${api}/pages/${slug}`)),
    enabled: Boolean(boot) && (mode === 'live' ? Boolean(live) : Boolean(slug)),
    staleTime: mode === 'off' ? 30_000 : 0, placeholderData: mode === 'live' ? (prev) => prev : undefined, retry: (n, e) => !(e instanceof ApiError) && n < 2
  });
  const itemQ = useQuery({
    queryKey: ['site-item', mode, route.kind === 'item' ? `${route.type}/${route.slug}` : null],
    queryFn: () => get<PublicItem>(`${api}/items/${(route as { type: string }).type}/${(route as { slug: string }).slug}`),
    enabled: Boolean(boot) && route.kind === 'item' && mode !== 'live', staleTime: mode === 'off' ? 30_000 : 0, retry: (n, e) => !(e instanceof ApiError) && n < 2
  });

  const ctx = useMemo(() => (boot ? makeSiteCtx(boot, lang, rtl, mode === 'draft' ? '?preview=1' : '') : null), [boot, lang, rtl, mode]);
  const page = pageQ.data; const item = itemQ.data;
  const s = (k: Parameters<typeof siteString>[1]) => siteString(lang, k);

  // Document language / direction / title follow the site while it is open, and are restored afterwards.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    return () => applyDir(useLang.getState().lang);
  }, [lang, rtl]);
  useEffect(() => {
    if (!boot) return;
    const def = boot.site.languages.default;
    const siteTitle = pickL10n(boot.site.seo.siteTitle, lang, def) || boot.school.name;
    const pageTitle = item ? pickL10n(item.data.title, lang, def) : page && route.kind === 'page' ? pickL10n(page.seo?.title, lang, def) || pickL10n(page.title, lang, def) : '';
    const prev = document.title;
    document.title = pageTitle ? `${pageTitle} — ${siteTitle}` : (page && pickL10n(page.seo?.title, lang, def)) || siteTitle;
    const desc = (item ? pickL10n(item.data.summary, lang, def) : page ? pickL10n(page.seo?.description, lang, def) : '') || pickL10n(boot.site.seo.description, lang, def);
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (desc) { if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); } meta.content = desc; }
    return () => { document.title = prev; };
  }, [boot, page, item, lang, route.kind]);
  useEffect(() => { if (mode !== 'live' && !loc.hash) window.scrollTo(0, 0); }, [loc.pathname, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const main = useReveal<HTMLElement>([page, item, loc.pathname]);

  if (bootQ.isLoading) return <Skeleton />;
  if (!boot || !ctx) {
    const denied = bootQ.error instanceof ApiError && (bootQ.error.status === 401 || bootQ.error.status === 403);
    const offline = bootQ.error instanceof ApiError && bootQ.error.status === 404;
    return (
      <div className="site-root min-h-screen" style={themeCssVars(null) as CSSProperties}>
        <Message title={denied ? s('previewBanner') : offline ? s('offlineTitle') : s('errorTitle')} body={denied ? s('previewNeedsLogin') : offline ? s('offlineBody') : s('errorBody')}
          action={offline || denied ? <Link to="/login" className="site-btn site-btn-primary">{s('staffLogin')}</Link> : <button type="button" className="site-btn site-btn-primary" onClick={() => void bootQ.refetch()}>{s('retry')}</button>} />
      </div>
    );
  }

  const loading = (slug && mode !== 'live' && pageQ.isLoading) || (route.kind === 'item' && itemQ.isLoading) || (mode === 'live' && !page);
  const err = route.kind === 'item' ? itemQ.error : pageQ.error;
  const missing = route.kind === 'notfound' || (err instanceof ApiError && err.status === 404);
  const first = page?.sections[0]?.type;
  const overHero = Boolean(item) || first === 'hero' || first === 'pageHeader';
  const pathHref = route.kind === 'home' ? '/' : route.kind === 'page' ? `/${route.slug}` : route.kind === 'item' ? `/${DETAIL_PREFIXES[route.type]}/${route.slug}` : '/';

  return (
    <SiteProvider value={ctx}>
      <div className={clsx('site-root flex min-h-screen flex-col', boot.site.theme.buttonStyle === 'outline' && 'site-buttons-outline')} style={themeCssVars(boot.site.theme, lang) as CSSProperties}>
        {mode === 'draft' && <p className="fixed bottom-4 start-1/2 z-[70] -translate-x-1/2 rounded-full bg-amber-400 px-5 py-2 text-xs font-semibold text-black shadow-lg rtl:translate-x-1/2" role="status">{s('previewBanner')}</p>}
        <Header overHero={overHero && !missing && !loading} pathHref={pathHref} />
        <main id="site-main" ref={main} className="flex-1" tabIndex={-1}>
          {loading ? <div className="flex min-h-screen items-center justify-center" role="status"><span className="h-10 w-10 animate-spin rounded-full border border-site-ink/15 border-t-site-primary" /></div>
            : missing ? <Message title={s('notFoundTitle')} body={s('notFoundBody')} action={<Link to={ctx.url('/') ?? '/site'} className="site-btn site-btn-primary">{s('backHome')}</Link>} />
              : err ? <Message title={s('errorTitle')} body={s('errorBody')} action={<button type="button" className="site-btn site-btn-primary" onClick={() => void (route.kind === 'item' ? itemQ.refetch() : pageQ.refetch())}>{s('retry')}</button>} />
                : item ? <ItemDetail item={item} />
                  : page ? <div key={mode === 'live' ? 'live' : page.slug} className={clsx(mode !== 'live' && 'site-page-enter', !overHero && 'pt-24 xl:pt-36')}>{page.sections.filter((x) => x.visible !== false).map((sec) => <SectionView key={sec.id} section={sec} page={page} />)}</div>
                    : null}
        </main>
        <Footer />
      </div>
    </SiteProvider>
  );
}
