import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowRight, Clock, Mail, MapPin, Phone, Pin } from 'lucide-react';
import { inquirySchema, isGoogleMapsEmbed, paragraphs, type L10n, type Section } from '@sms/shared';
import { ApiError, post } from '../../services/api';
import { SiteLink, useSite, type ResolvedPage } from './context';
import { Hero } from './Hero';
import { SiteImage, SiteVideo } from './Media';
import { CollectionItems, MediaGrid } from './Collections';
import { SectionIcon } from './icons';
import { useCountUp, useInView } from './hooks';

const BG = { default: '', muted: 'bg-site-primary/[0.045]', dark: 'site-on-dark bg-site-secondary text-white', brand: 'site-on-dark site-brand-bg bg-site-primary text-site-on-primary' } as const;
const PAD = { compact: 'py-14 sm:py-16', normal: 'py-20 sm:py-28', spacious: 'py-28 sm:py-40' } as const;

function Shell({ section, children, wide }: { section: Section; children: ReactNode; wide?: boolean }) {
  return (
    <section id={section.anchor ?? undefined} className={clsx(BG[section.background], PAD[section.spacing], 'scroll-mt-24')}>
      <div className={clsx('mx-auto px-6 sm:px-10 lg:px-14', wide ? 'max-w-site' : 'max-w-site')}>{children}</div>
    </section>
  );
}

function Heading({ c, center, action }: { c: { eyebrow?: L10n; heading?: L10n; intro?: L10n }; center?: boolean; action?: ReactNode }) {
  const { t } = useSite();
  if (!t(c.eyebrow) && !t(c.heading) && !t(c.intro) && !action) return null;
  return (
    <div className={clsx('site-reveal mb-12 flex flex-col gap-6 sm:mb-16', center ? 'items-center text-center' : 'lg:flex-row lg:items-end lg:justify-between')}>
      <div className={clsx('max-w-3xl', center && 'flex flex-col items-center')}>
        {t(c.eyebrow) && <p className="site-eyebrow mb-4 flex items-center gap-4 text-site-accent-text [.site-on-dark_&]:text-site-accent"><span className="site-rule" aria-hidden />{t(c.eyebrow)}</p>}
        {t(c.heading) && <h2 className="text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.1]">{t(c.heading)}</h2>}
        {t(c.intro) && <p className="mt-5 max-w-2xl whitespace-pre-line text-lg leading-relaxed opacity-80">{t(c.intro)}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function Prose({ text, className }: { text: string; className?: string }) {
  return <div className={clsx('site-prose', className)}>{paragraphs(text).map((p, k) => <p key={k}>{p}</p>)}</div>;
}

function PageHeader({ section }: { section: Section }) {
  const { t } = useSite();
  const c = section.content;
  return (
    <header className="site-on-dark relative isolate overflow-hidden bg-site-secondary text-white">
      {c.image ? <><SiteImage media={c.image} eager sizes="100vw" className="absolute inset-0 -z-10 h-full w-full object-cover" /><div className="absolute inset-0 -z-10 bg-gradient-to-t from-[#080c16]/85 via-[#080c16]/45 to-[#080c16]/55" /></> : <div className="site-hero-pattern absolute inset-0 -z-10" />}
      <div className="mx-auto max-w-site px-6 pb-16 pt-44 sm:px-10 sm:pb-24 sm:pt-56 lg:px-14">
        <div className="site-page-enter max-w-3xl">
          {t(c.eyebrow) && <p className="site-eyebrow mb-5 flex items-center gap-4 text-site-accent"><span className="site-rule" aria-hidden />{t(c.eyebrow)}</p>}
          <h1 className="text-[clamp(2.4rem,5.6vw,4.5rem)] leading-[1.05]">{t(c.heading)}</h1>
          {t(c.intro) && <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/80">{t(c.intro)}</p>}
        </div>
      </div>
    </header>
  );
}

function TextImage({ section }: { section: Section }) {
  const { t } = useSite();
  const c = section.content;
  const hasMedia = Boolean(c.image || c.video);
  const text = (
    <div className="site-reveal">
      {t(c.eyebrow) && <p className="site-eyebrow mb-4 flex items-center gap-4 text-site-accent-text [.site-on-dark_&]:text-site-accent"><span className="site-rule" aria-hidden />{t(c.eyebrow)}</p>}
      {t(c.heading) && <h2 className="mb-7 text-[clamp(2rem,4vw,3.25rem)] leading-[1.1]">{t(c.heading)}</h2>}
      {t(c.intro) && <p className="mb-6 font-display text-2xl leading-snug opacity-90">{t(c.intro)}</p>}
      {t(c.body) && <Prose text={t(c.body)} />}
      {t(c.personName) && (
        <p className="mt-8 border-s-2 border-site-accent ps-5"><span className="block font-display text-2xl">{t(c.personName)}</span>{t(c.personTitle) && <span className="site-eyebrow mt-1 block opacity-70">{t(c.personTitle)}</span>}</p>
      )}
      {c.cta && t(c.cta.label) && <div className="mt-9"><SiteLink href={c.cta.href} className="site-link text-site-primary [.site-on-dark_&]:text-white">{t(c.cta.label)}<ArrowRight aria-hidden /></SiteLink></div>}
    </div>
  );
  return (
    <Shell section={section}>
      {hasMedia ? (
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-20">
          <div className="lg:col-span-6">{text}</div>
          <div className={clsx('site-reveal lg:col-span-6', c.imagePosition === 'start' && 'lg:order-first')}>
            {c.image && <div className={clsx('site-frame', c.imagePosition === 'start' && 'is-start')}><div className={clsx('site-media', c.video ? 'aspect-[16/10]' : 'aspect-[4/3] w-full lg:aspect-[4/5] lg:max-h-[42rem]')}><SiteImage media={c.image} fallbackAlt={t(c.personName) || t(c.heading)} sizes="(min-width:1024px) 50vw, 100vw" /></div></div>}
            {c.video && <div className={clsx(c.image && 'mt-5')}><SiteVideo video={c.video} title={t(c.heading)} /></div>}
          </div>
        </div>
      ) : <div className="mx-auto max-w-3xl">{text}</div>}
    </Shell>
  );
}

function Stat({ label, value, suffix, k }: { label: string; value: number; suffix: string; k: number }) {
  const { ref, seen } = useInView<HTMLDivElement>();
  const v = useCountUp(value, seen);
  const { lang } = useSite();
  return (
    <div ref={ref} className="site-reveal text-center" style={{ '--i': k } as CSSProperties}>
      <p className="num font-display text-[clamp(2.75rem,6vw,4.75rem)] leading-none" aria-label={`${value}${suffix}`}>{new Intl.NumberFormat(lang === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB').format(v)}{suffix}</p>
      <span className="site-rule mx-auto my-5" aria-hidden />
      <p className="site-eyebrow opacity-80">{label}</p>
    </div>
  );
}

function Stats({ section, page }: { section: Section; page: ResolvedPage }) {
  const { t } = useSite();
  const c = section.content;
  // Only real numbers are shown: a typed value, or a live count from the school's own records.
  const items = (c.items as { id: string; label: L10n; source: 'manual' | 'students' | 'teachers' | 'classes'; value: number | null; suffix: string }[])
    .map((i) => ({ ...i, n: i.source === 'manual' ? i.value : page.stats?.[i.source] ?? null }))
    .filter((i): i is typeof i & { n: number } => typeof i.n === 'number' && i.n > 0 && Boolean(t(i.label)));
  if (!items.length) return null;
  return (
    <Shell section={section}>
      <Heading c={c} center />
      <div className={clsx('grid gap-y-14', items.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : items.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
        {items.map((i, k) => <Stat key={i.id} label={t(i.label)} value={i.n} suffix={i.suffix} k={k} />)}
      </div>
    </Shell>
  );
}

function FeatureGrid({ section }: { section: Section }) {
  const { t } = useSite();
  const c = section.content;
  const items = (c.items as { id: string; icon: string | null; title: L10n; body: L10n; image: any; link: { label: L10n; href: string } | null }[]).filter((i) => t(i.title) || t(i.body)); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!items.length && !t(c.heading)) return null;
  const cols = c.columns === 2 ? 'md:grid-cols-2' : c.columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <Shell section={section}>
      <Heading c={c} />
      <div className={clsx('grid gap-x-10 gap-y-14', cols)}>
        {items.map((i, k) => (
          <article key={i.id} className={clsx('site-reveal', c.style === 'cards' && 'site-card border site-hair bg-white/60 p-8 [.site-on-dark_&]:bg-white/5', c.style === 'minimal' && 'border-t site-hair pt-8')} style={{ '--i': k % 6, borderRadius: c.style === 'cards' ? 'var(--site-radius)' : undefined } as CSSProperties}>
            {c.style === 'images' && i.image ? <div className="site-media site-zoom mb-6 aspect-[4/3]"><SiteImage media={i.image} fallbackAlt={t(i.title)} sizes="(min-width:1024px) 33vw, 100vw" /></div>
              : i.icon && <div className="mb-6 text-site-accent-text [.site-on-dark_&]:text-site-accent"><SectionIcon name={i.icon} className="h-8 w-8" /></div>}
            <h3 className="text-2xl leading-snug">{t(i.title)}</h3>
            {t(i.body) && <p className="mt-3 whitespace-pre-line leading-relaxed opacity-80">{t(i.body)}</p>}
            {i.link && t(i.link.label) && <div className="mt-5"><SiteLink href={i.link.href} className="site-link text-site-primary [.site-on-dark_&]:text-white">{t(i.link.label)}<ArrowRight aria-hidden /></SiteLink></div>}
          </article>
        ))}
      </div>
    </Shell>
  );
}

function Collection({ section, page }: { section: Section; page: ResolvedPage }) {
  const { t, s, preview } = useSite();
  const c = section.content;
  const items = page.collections[section.id] ?? [];
  // An empty collection renders nothing publicly (no empty decorative sections). Editors see a hint in preview.
  if (!items.length) return preview ? <Shell section={section}><Heading c={c} /><p className="border border-dashed site-hair p-8 text-center opacity-70">{s('nothingYet')} ({c.itemType})</p></Shell> : null;
  const viewAll = c.viewAll && t(c.viewAll.label) ? <SiteLink href={c.viewAll.href} className="site-link text-site-primary [.site-on-dark_&]:text-white">{t(c.viewAll.label)}<ArrowRight aria-hidden /></SiteLink> : null;
  return (
    <Shell section={section}>
      <Heading c={c} center={c.itemType === 'testimonial' || c.itemType === 'faq'} action={c.itemType === 'testimonial' || c.itemType === 'faq' ? undefined : viewAll} />
      <CollectionItems type={c.itemType} items={items} layout={c.layout} />
      {(c.itemType === 'testimonial' || c.itemType === 'faq') && viewAll && <div className="mt-12 text-center">{viewAll}</div>}
    </Shell>
  );
}

function Steps({ section }: { section: Section }) {
  const { t } = useSite();
  const c = section.content;
  const items = (c.items as { id: string; title: L10n; body: L10n }[]).filter((i) => t(i.title));
  if (!items.length) return null;
  return (
    <Shell section={section}>
      <Heading c={c} />
      <ol className={clsx('grid gap-x-10 gap-y-12', items.length >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3')}>
        {items.map((i, k) => (
          <li key={i.id} className="site-reveal border-t site-hair pt-7" style={{ '--i': k % 6 } as CSSProperties}>
            <span className="num font-display text-5xl text-site-accent-text [.site-on-dark_&]:text-site-accent" aria-hidden>{String(k + 1).padStart(2, '0')}</span>
            <h3 className="mt-4 text-2xl leading-snug">{t(i.title)}</h3>
            {t(i.body) && <p className="mt-3 whitespace-pre-line leading-relaxed opacity-80">{t(i.body)}</p>}
          </li>
        ))}
      </ol>
    </Shell>
  );
}

function Cta({ section }: { section: Section }) {
  const { t } = useSite();
  const c = section.content;
  const dark = section.background === 'dark' || section.background === 'brand' || Boolean(c.image);
  return (
    <section id={section.anchor ?? undefined} className={clsx('relative isolate overflow-hidden', c.image ? 'site-on-dark text-white' : BG[section.background], PAD[section.spacing])}>
      {c.image && <><SiteImage media={c.image} sizes="100vw" className="absolute inset-0 -z-10 h-full w-full object-cover" /><div className="absolute inset-0 -z-10 bg-[#080c16]/65" /></>}
      <div className="site-reveal mx-auto flex max-w-4xl flex-col items-center px-6 text-center sm:px-10">
        {t(c.eyebrow) && <p className={clsx('site-eyebrow mb-5', dark ? 'text-site-accent' : 'text-site-accent-text')}>{t(c.eyebrow)}</p>}
        {t(c.heading) && <h2 className="text-[clamp(2.1rem,4.6vw,3.75rem)] leading-[1.08]">{t(c.heading)}</h2>}
        {t(c.intro) && <p className="mt-6 max-w-2xl whitespace-pre-line text-lg leading-relaxed opacity-85">{t(c.intro)}</p>}
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          {c.cta1 && t(c.cta1.label) && <SiteLink href={c.cta1.href} className={clsx('site-btn', dark ? 'site-btn-accent' : 'site-btn-primary')}>{t(c.cta1.label)}<ArrowRight aria-hidden /></SiteLink>}
          {c.cta2 && t(c.cta2.label) && <SiteLink href={c.cta2.href} className={clsx('site-btn site-btn-outline', dark && 'is-light')}>{t(c.cta2.label)}</SiteLink>}
        </div>
      </div>
    </section>
  );
}

function InquiryForm({ kind }: { kind: 'contact' | 'admission' }) {
  const { s, lang } = useSite();
  const [v, setV] = useState({ name: '', phone: '', email: '', grade: '', message: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const parsed = inquirySchema.safeParse({ kind, lang, ...v });
    if (!parsed.success) { setError(parsed.error.issues[0]?.path[0] === 'phone' && !v.phone && !v.email ? s('formNeedContact') : parsed.error.issues[0]?.message ?? s('formError')); return; }
    setState('sending');
    try { await post('/api/public/site/inquiries', parsed.data); setState('sent'); }
    catch (err) { setState('idle'); setError(err instanceof ApiError && err.status === 429 ? s('formTooMany') : s('formError')); }
  };
  if (state === 'sent') return <p className="border-s-2 border-site-accent ps-5 font-display text-2xl leading-snug" role="status">{s('formThanks')}</p>;
  const field = (k: 'name' | 'phone' | 'email' | 'grade', label: string, type = 'text', extra: object = {}) => (
    <label className="block"><span className="site-eyebrow opacity-70">{label}</span><input type={type} className="site-field" value={v[k]} onChange={set(k)} {...extra} /></label>
  );
  return (
    <form onSubmit={submit} noValidate className="space-y-7">
      {field('name', s('formName'), 'text', { required: true, autoComplete: 'name', maxLength: 120 })}
      <div className="grid gap-7 sm:grid-cols-2">
        {field('phone', s('formPhone'), 'tel', { autoComplete: 'tel', maxLength: 30, dir: 'ltr' })}
        {field('email', s('formEmail'), 'email', { autoComplete: 'email', maxLength: 160, dir: 'ltr' })}
      </div>
      {kind === 'admission' && field('grade', s('formGrade'), 'text', { maxLength: 60 })}
      <label className="block"><span className="site-eyebrow opacity-70">{s('formMessage')}</span><textarea className="site-field min-h-[7rem] resize-y" value={v.message} onChange={set('message')} maxLength={3000} /></label>
      {/* Honeypot: hidden from people and assistive technology; bots that fill it are ignored by the server. */}
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={set('website')} /></label></div>
      {error && <p role="alert" className="text-sm text-red-700 [.site-on-dark_&]:text-red-300">{error}</p>}
      <button type="submit" disabled={state === 'sending'} className="site-btn site-btn-primary disabled:opacity-60">{state === 'sending' ? s('formSending') : kind === 'admission' ? s('formSendInquiry') : s('formSend')}<ArrowRight aria-hidden /></button>
    </form>
  );
}

export function ContactDetails({ compact, wide }: { compact?: boolean; wide?: boolean }) {
  const { t, s, boot } = useSite();
  const c = boot.site.contact;
  const row = (icon: ReactNode, label: string, body: ReactNode) => (
    <div className="flex gap-4"><span className="mt-1 text-site-accent-text [.site-on-dark_&]:text-site-accent">{icon}</span><div><p className="site-eyebrow mb-1 opacity-60">{label}</p><div className={compact ? 'text-sm' : 'text-lg'}>{body}</div></div></div>
  );
  const any = t(c.address) || c.phones.length || c.email || t(c.officeHours) || c.admissionsPhone || c.admissionsEmail;
  if (!any) return null;
  return (
    <div className={wide ? 'grid gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-7'}>
      {t(c.address) && row(<MapPin className="h-5 w-5" aria-hidden />, s('address'), <address className="whitespace-pre-line not-italic">{t(c.address)}</address>)}
      {c.phones.length > 0 && row(<Phone className="h-5 w-5" aria-hidden />, s('phone'), c.phones.map((p) => <a key={p} href={`tel:${p.replace(/[^\d+]/g, '')}`} className="num block hover:underline">{p}</a>))}
      {c.email && row(<Mail className="h-5 w-5" aria-hidden />, s('email'), <a href={`mailto:${c.email}`} className="break-all hover:underline" dir="ltr">{c.email}</a>)}
      {t(c.officeHours) && row(<Clock className="h-5 w-5" aria-hidden />, s('officeHours'), <p className="whitespace-pre-line">{t(c.officeHours)}</p>)}
      {(c.admissionsPhone || c.admissionsEmail) && row(<Phone className="h-5 w-5" aria-hidden />, s('admissionsOffice'), <>
        {c.admissionsPhone && <a href={`tel:${c.admissionsPhone.replace(/[^\d+]/g, '')}`} className="num block hover:underline">{c.admissionsPhone}</a>}
        {c.admissionsEmail && <a href={`mailto:${c.admissionsEmail}`} className="block break-all hover:underline" dir="ltr">{c.admissionsEmail}</a>}
      </>)}
    </div>
  );
}

function Contact({ section }: { section: Section }) {
  const { boot, s } = useSite();
  const c = section.content;
  const map = c.showMap && isGoogleMapsEmbed(boot.site.contact.mapEmbedUrl) ? boot.site.contact.mapEmbedUrl : null;
  const details = c.showDetails ? <ContactDetails wide={!c.showForm} /> : null;
  return (
    <Shell section={section}>
      <Heading c={c} />
      <div className={clsx('grid gap-14', c.showForm && c.showDetails && 'lg:grid-cols-2 lg:gap-24')}>
        {details && <div className="site-reveal">{details}</div>}
        {c.showForm && <div className="site-reveal relative" style={{ '--i': 1 } as CSSProperties}><InquiryForm kind={c.formType} /></div>}
      </div>
      {map && <div className="site-reveal site-media mt-16 aspect-[16/9] sm:aspect-[21/8]"><iframe src={map} title={s('map')} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="absolute inset-0 h-full w-full border-0 grayscale-[35%]" /></div>}
    </Shell>
  );
}

function Announcements({ section, page }: { section: Section; page: ResolvedPage }) {
  const { fmtDate, s } = useSite();
  const c = section.content;
  const list = page.announcements.slice(0, c.limit);
  if (!list.length) return null;
  return (
    <Shell section={section}>
      <Heading c={c} />
      <div className="grid gap-x-12 md:grid-cols-2">
        {list.map((a, k) => (
          <article key={a._id} className="site-reveal border-t site-hair py-7" style={{ '--i': k % 6 } as CSSProperties}>
            <p className="site-eyebrow mb-3 flex items-center gap-2 text-site-accent-text [.site-on-dark_&]:text-site-accent">{a.pinned && <><Pin className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">{s('pinned')}</span></>}<span className="num">{fmtDate(a.publishedAt)}</span></p>
            {/* Announcements are written in one language in the dashboard; let the browser pick the direction. */}
            <h3 className="text-2xl leading-snug" dir="auto">{a.title}</h3>
            <p className="mt-3 whitespace-pre-line leading-relaxed opacity-80" dir="auto">{a.body}</p>
          </article>
        ))}
      </div>
    </Shell>
  );
}

/** Renders one CMS section. Unknown types (from a newer version) are skipped instead of breaking the page. */
export function SectionView({ section, page }: { section: Section; page: ResolvedPage }) {
  const { t } = useSite();
  const c = section.content;
  switch (section.type) {
    case 'hero': return <Hero slides={c.slides} height={c.height} />;
    case 'pageHeader': return <PageHeader section={section} />;
    case 'textImage': return <TextImage section={section} />;
    case 'stats': return <Stats section={section} page={page} />;
    case 'featureGrid': return <FeatureGrid section={section} />;
    case 'collection': return <Collection section={section} page={page} />;
    case 'steps': return <Steps section={section} />;
    case 'cta': return <Cta section={section} />;
    case 'contact': return <Contact section={section} />;
    case 'announcements': return <Announcements section={section} page={page} />;
    case 'gallery': return c.images?.some((i: { media: unknown }) => i.media) ? <Shell section={section}><Heading c={c} /><MediaGrid items={c.images} /></Shell> : null;
    case 'video': return c.video ? <Shell section={section}><Heading c={c} center /><div className="site-reveal mx-auto max-w-5xl"><SiteVideo video={c.video} poster={c.poster} title={t(c.heading)} /></div></Shell> : null;
    case 'richText': return t(c.body) || t(c.heading) ? <Shell section={section}><div className="mx-auto max-w-3xl"><Heading c={c} /><div className="site-reveal"><Prose text={t(c.body)} /></div></div></Shell> : null;
    default: return null;
  }
}
