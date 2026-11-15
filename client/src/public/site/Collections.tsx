import { useMemo, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Images, MapPin, Plus, Quote, Search, UserRound } from 'lucide-react';
import { DETAIL_PREFIXES, paragraphs, type MediaRef } from '@sms/shared';
import { SiteLink, useSite, type PublicItem } from './context';
import { Lightbox, SiteImage, SiteVideo, type LightboxItem } from './Media';
import { SectionIcon } from './icons';

const detailHref = (i: PublicItem) => (i.hasDetail ? `/${DETAIL_PREFIXES[i.type as keyof typeof DETAIL_PREFIXES]}/${i.slug}` : null);
const reveal = (k: number) => ({ className: 'site-reveal', style: { '--i': k % 6 } as CSSProperties });

function Portrait({ media, name, ratio = 'aspect-[4/5]' }: { media: MediaRef | null; name: string; ratio?: string }) {
  return (
    <div className={clsx('site-media site-zoom', ratio)}>
      {media ? <SiteImage media={media} fallbackAlt={name} sizes="(min-width:1024px) 25vw, (min-width:640px) 50vw, 100vw" />
        : <div className="flex h-full w-full items-center justify-center text-site-primary/25" aria-hidden><UserRound className="h-16 w-16" strokeWidth={1} /></div>}
    </div>
  );
}

function NewsCard({ item, k }: { item: PublicItem; k: number }) {
  const { t, s, fmtDate } = useSite();
  const d = item.data;
  return (
    <article {...reveal(k)}>
      <SiteLink href={detailHref(item)} className="group block">
        {d.image && <div className="site-media site-zoom mb-6 aspect-[3/2]"><SiteImage media={d.image} fallbackAlt={t(d.title)} sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" /></div>}
        {(d.date || item.group) && <p className="site-eyebrow mb-3 text-site-accent-text">{fmtDate(d.date) || item.group}</p>}
        <h3 className="text-2xl leading-snug transition-colors duration-300 group-hover:text-site-primary">{t(d.title)}</h3>
        {t(d.summary) && <p className="mt-3 line-clamp-3 text-site-soft">{t(d.summary)}</p>}
        <span className="site-link mt-5 text-site-primary">{s('readMore')}<ArrowRight aria-hidden /></span>
      </SiteLink>
    </article>
  );
}

function EventRow({ item, k }: { item: PublicItem; k: number }) {
  const { t, fmtDate } = useSite();
  const d = item.data;
  const past = d.startAt && Date.parse(d.endAt || d.startAt) < Date.now();
  return (
    <article {...reveal(k)}>
      <SiteLink href={detailHref(item)} className={clsx('group grid grid-cols-[5.5rem_1fr] items-start gap-6 border-t site-hair py-7 sm:grid-cols-[7rem_1fr_auto] sm:items-center', past && 'opacity-60')}>
        <div className="text-center">
          {d.startAt ? <><p className="num font-display text-5xl leading-none">{fmtDate(d.startAt, { day: '2-digit' })}</p><p className="site-eyebrow mt-2 text-site-accent-text">{fmtDate(d.startAt, { month: 'short', year: 'numeric' })}</p></> : <CalendarDays className="mx-auto h-8 w-8 opacity-50" aria-hidden />}
        </div>
        <div className="min-w-0">
          <h3 className="text-2xl leading-snug">{t(d.title)}</h3>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm opacity-75">
            {d.startAt && <span className="num">{fmtDate(d.startAt, { hour: 'numeric', minute: '2-digit' })}</span>}
            {t(d.location) && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden />{t(d.location)}</span>}
          </p>
          {t(d.summary) && <p className="mt-2 line-clamp-2 opacity-80">{t(d.summary)}</p>}
        </div>
        <ArrowRight className="site-flip hidden h-5 w-5 transition-transform duration-500 group-hover:translate-x-1 sm:block" aria-hidden />
      </SiteLink>
    </article>
  );
}

function FacultyCard({ item, k }: { item: PublicItem; k: number }) {
  const { t } = useSite();
  const d = item.data;
  return (
    <article {...reveal(k)}>
      <Portrait media={d.image} name={t(d.title)} />
      <h3 className="mt-5 text-xl">{t(d.title)}</h3>
      {t(d.designation) && <p className="site-eyebrow mt-2 text-site-accent-text">{t(d.designation)}</p>}
      {t(d.qualifications) && <p className="mt-2 text-sm opacity-70">{t(d.qualifications)}</p>}
      {t(d.summary) && <p className="mt-3 text-sm leading-relaxed opacity-80">{t(d.summary)}</p>}
    </article>
  );
}

function InfoCard({ item, k }: { item: PublicItem; k: number }) {
  const { t } = useSite();
  const d = item.data;
  return (
    <article {...reveal(k)}>
      {d.image
        ? <div className="site-media site-zoom mb-6 aspect-[4/3]"><SiteImage media={d.image} fallbackAlt={t(d.title)} sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" /></div>
        : <div className="mb-6 flex h-14 w-14 items-center justify-center border border-site-accent/60 text-site-accent-text" style={{ borderRadius: 'var(--site-radius)' }}><SectionIcon name={d.icon ?? (item.type === 'achievement' ? 'award' : item.type === 'program' ? 'book' : 'star')} /></div>}
      {(d.year || t(d.grades)) && <p className="site-eyebrow mb-2 text-site-accent-text">{d.year || t(d.grades)}</p>}
      <h3 className="text-2xl leading-snug">{t(d.title)}</h3>
      {t(d.summary) && <p className="mt-3 leading-relaxed opacity-80">{t(d.summary)}</p>}
      {t(d.subjects) && <p className="mt-3 text-sm opacity-65">{t(d.subjects)}</p>}
      {t(d.body) && <div className="site-prose mt-4 !text-base">{t(d.body)}</div>}
    </article>
  );
}

function AlbumCard({ item, k }: { item: PublicItem; k: number }) {
  const { t, s } = useSite();
  const d = item.data;
  const cover: MediaRef | null = d.image ?? (d.media?.[0]?.media?.kind === 'image' ? d.media[0].media : null);
  return (
    <article {...reveal(k)}>
      <SiteLink href={detailHref(item)} className="group block">
        <div className="site-media site-zoom aspect-[4/3]">
          {cover ? <SiteImage media={cover} fallbackAlt={t(d.title)} sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" /> : <div className="flex h-full items-center justify-center text-site-primary/30"><Images className="h-10 w-10" aria-hidden /></div>}
          <span className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <span className="num absolute bottom-4 start-4 text-xs tracking-[0.18em] text-white">{s('photos', { n: d.count ?? d.media?.length ?? 0 })}</span>
        </div>
        <h3 className="mt-5 text-2xl leading-snug transition-colors duration-300 group-hover:text-site-primary">{t(d.title)}</h3>
        {t(d.summary) && <p className="mt-2 line-clamp-2 opacity-75">{t(d.summary)}</p>}
      </SiteLink>
    </article>
  );
}

function Testimonials({ items, carousel }: { items: PublicItem[]; carousel: boolean }) {
  const { t, s } = useSite();
  const [i, setI] = useState(0);
  const Card = ({ item, big }: { item: PublicItem; big?: boolean }) => (
    <figure className={clsx(big ? 'mx-auto max-w-4xl text-center' : '')}>
      <Quote className={clsx('h-8 w-8 text-site-accent', big && 'mx-auto')} aria-hidden />
      <blockquote className={clsx('mt-6 font-display leading-snug', big ? 'text-2xl sm:text-4xl' : 'text-2xl')}>{t(item.data.quote) || t(item.data.summary)}</blockquote>
      <figcaption className={clsx('mt-8 flex items-center gap-4', big && 'justify-center')}>
        {item.data.image && <span className="site-media block h-14 w-14 shrink-0 !rounded-full"><SiteImage media={item.data.image} fallbackAlt={t(item.data.title)} sizes="56px" /></span>}
        <span className="text-start"><span className="block font-semibold">{t(item.data.title)}</span>{t(item.data.relation) && <span className="site-eyebrow mt-1 block opacity-70">{t(item.data.relation)}</span>}</span>
      </figcaption>
    </figure>
  );
  if (!carousel || items.length === 1) return <div className="grid gap-14 md:grid-cols-2 lg:grid-cols-3">{items.map((it, k) => <div key={it.id} {...reveal(k)}><Card item={it} /></div>)}</div>;
  const cur = items[Math.min(i, items.length - 1)]!;
  return (
    <div className="site-reveal" aria-roledescription="carousel" aria-label={s('quote')}>
      <div key={cur.id} className="site-page-enter" aria-live="polite"><Card item={cur} big /></div>
      <div className="mt-10 flex items-center justify-center gap-5">
        <button type="button" onClick={() => setI((x) => (x - 1 + items.length) % items.length)} className="flex h-11 w-11 items-center justify-center rounded-full border site-hair transition-colors duration-300 hover:bg-white hover:text-site-ink" aria-label={s('previous')}><ChevronLeft className="site-flip h-4 w-4" /></button>
        <span className="num text-xs tracking-[0.2em] opacity-70">{String(i + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
        <button type="button" onClick={() => setI((x) => (x + 1) % items.length)} className="flex h-11 w-11 items-center justify-center rounded-full border site-hair transition-colors duration-300 hover:bg-white hover:text-site-ink" aria-label={s('next')}><ChevronRight className="site-flip h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Faqs({ items }: { items: PublicItem[] }) {
  const { t, s } = useSite();
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const groups = useMemo(() => [...new Set(items.map((i) => i.group).filter(Boolean))], [items]);
  const shown = items.filter((i) => (!group || i.group === group) && (!q.trim() || `${t(i.data.title)} ${t(i.data.answer)}`.toLowerCase().includes(q.trim().toLowerCase())));
  const searchable = items.length > 6;
  return (
    <div className="mx-auto max-w-3xl">
      {searchable && (
        <div className="site-reveal mb-8 space-y-5">
          <label className="relative block"><span className="sr-only">{s('searchFaqs')}</span><Search className="pointer-events-none absolute start-0 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" aria-hidden /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={s('searchFaqs')} className="site-field !ps-7" /></label>
          {groups.length > 1 && <div className="flex flex-wrap gap-2">{['', ...groups].map((g) => <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g} className={clsx('border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition-colors duration-300', group === g ? 'border-site-primary bg-site-primary text-site-on-primary' : 'site-hair hover:border-current')} style={{ borderRadius: 'var(--site-radius)' }}>{g || s('viewAll')}</button>)}</div>}
        </div>
      )}
      {shown.length === 0 && <p className="py-8 text-center opacity-70">{s('noResults')}</p>}
      {shown.map((it, k) => {
        const isOpen = open === it.id;
        return (
          <div key={it.id} className="site-accordion site-reveal border-t site-hair last:border-b" data-open={isOpen} style={{ '--i': k % 6 } as CSSProperties}>
            <h3><button type="button" className="flex w-full items-center justify-between gap-6 py-6 text-start text-xl" aria-expanded={isOpen} aria-controls={`faq-${it.id}`} onClick={() => setOpen(isOpen ? null : it.id)}>
              <span className="font-display">{t(it.data.title)}</span><Plus className="site-accordion-icon h-5 w-5 shrink-0 text-site-accent-text" aria-hidden />
            </button></h3>
            <div id={`faq-${it.id}`} className="site-accordion-body" role="region" {...(!isOpen ? { inert: '' } as object : {})}><div><div className="site-prose pb-7 pe-10 !text-base">{t(it.data.answer) || t(it.data.summary)}</div></div></div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the items of a collection section in the layout that suits their type. */
export function CollectionItems({ type, items, layout }: { type: string; items: PublicItem[]; layout: 'grid' | 'list' | 'carousel' }) {
  if (type === 'faq') return <Faqs items={items} />;
  if (type === 'testimonial') return <Testimonials items={items} carousel={layout === 'carousel'} />;
  if (type === 'event') return <div className="mx-auto max-w-4xl border-b site-hair">{items.map((it, k) => <EventRow key={it.id} item={it} k={k} />)}</div>;
  if (type === 'faculty') return <div className="grid grid-cols-2 gap-x-5 gap-y-12 sm:gap-x-8 lg:grid-cols-4">{items.map((it, k) => <FacultyCard key={it.id} item={it} k={k} />)}</div>;
  const cols = items.length === 1 ? 'mx-auto max-w-xl' : items.length === 2 ? 'sm:grid-cols-2' : items.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div className={clsx('grid gap-x-10 gap-y-16', cols)}>
      {items.map((it, k) => (type === 'news' ? <NewsCard key={it.id} item={it} k={k} /> : type === 'album' ? <AlbumCard key={it.id} item={it} k={k} /> : <InfoCard key={it.id} item={it} k={k} />))}
    </div>
  );
}

/** Image grid with a keyboard-accessible lightbox (gallery sections and album pages). */
export function MediaGrid({ items }: { items: { id: string; media: MediaRef | null; caption?: Record<string, string> }[] }) {
  const { t, s } = useSite();
  const [open, setOpen] = useState<number | null>(null);
  const list = items.filter((x): x is { id: string; media: MediaRef; caption?: Record<string, string> } => Boolean(x.media));
  const lb: LightboxItem[] = list.map((x) => ({ media: x.media, caption: t(x.caption) || t(x.media.alt) }));
  if (!list.length) return null;
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {list.map((x, k) => (
          <li key={x.id} {...reveal(k)} className={clsx('site-reveal', k % 7 === 0 && 'md:col-span-2 md:row-span-2')}>
            <button type="button" onClick={() => setOpen(k)} className="site-media site-zoom group block aspect-square h-full w-full" aria-label={`${s('openImage')}${lb[k]!.caption ? `: ${lb[k]!.caption}` : ''}`}>
              {x.media.kind === 'image' ? <SiteImage media={x.media} fallbackAlt={lb[k]!.caption} sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 50vw" /> : <span className="flex h-full items-center justify-center bg-site-secondary text-white"><Images className="h-8 w-8" aria-hidden /></span>}
              <span className="absolute inset-0 bg-site-secondary/0 transition-colors duration-500 group-hover:bg-site-secondary/25" />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox items={lb} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </>
  );
}

/** Full page for one news article, event or gallery album. */
export function ItemDetail({ item }: { item: PublicItem }) {
  const { t, s, fmtDate } = useSite();
  const d = item.data;
  const back = item.type === 'news' ? '/news' : item.type === 'event' ? '/events' : '/gallery';
  return (
    <article className="site-page-enter">
      <header className="bg-site-secondary pb-16 pt-40 text-white sm:pb-20 sm:pt-48">
        <div className="mx-auto max-w-4xl px-6 sm:px-10">
          <SiteLink href={back} className="site-link mb-8 text-white/80"><ArrowRight className="rotate-180" aria-hidden />{s('backTo')}</SiteLink>
          <p className="site-eyebrow mb-5 text-site-accent">{item.type === 'event' ? fmtDate(d.startAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : item.type === 'news' ? fmtDate(d.date) : s('photos', { n: d.media?.length ?? 0 })}</p>
          <h1 className="text-[clamp(2.1rem,5vw,3.75rem)] leading-[1.08]">{t(d.title)}</h1>
          {t(d.summary) && <p className="mt-6 max-w-2xl text-lg text-white/80">{t(d.summary)}</p>}
          {item.type === 'event' && (
            <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
              {d.startAt && <span className="num inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden />{fmtDate(d.startAt, { hour: 'numeric', minute: '2-digit' })}{d.endAt ? ` – ${fmtDate(d.endAt, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</span>}
              {t(d.location) && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden />{t(d.location)}</span>}
            </p>
          )}
        </div>
      </header>
      <div className={clsx('mx-auto px-6 py-16 sm:px-10 sm:py-24', item.type === 'album' ? 'max-w-site' : 'max-w-4xl')}>
        {item.type !== 'album' && d.image && <div className="site-media -mt-28 mb-12 aspect-[16/9] shadow-2xl sm:-mt-36"><SiteImage media={d.image} eager fallbackAlt={t(d.title)} sizes="(min-width:900px) 56rem, 100vw" /></div>}
        {t(d.body) && <div className="site-prose mx-auto max-w-3xl">{paragraphs(t(d.body)).map((p, k) => <p key={k}>{p}</p>)}</div>}
        {d.video && <div className="mx-auto mt-12 max-w-3xl"><SiteVideo video={d.video} title={t(d.title)} /></div>}
        {item.type === 'album' && (d.media?.length ? <MediaGrid items={d.media} /> : <p className="text-center opacity-70">{s('nothingYet')}</p>)}
      </div>
    </article>
  );
}
