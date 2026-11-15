import { useEffect, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { classifyMediaUrl, cloudinarySrcSet, cloudinaryUrl, type MediaRef } from '@sms/shared';
import { useSite } from './context';

/**
 * Responsive, lazy image for a CMS media reference. Cloudinary assets get automatic format/quality
 * and a width-based srcset; local uploads are served as stored. A broken image collapses to a
 * neutral block instead of the browser's broken-image icon.
 */
export function SiteImage({ media, sizes = '100vw', className, eager, fallbackAlt = '', style }: { media: MediaRef | null | undefined; sizes?: string; className?: string; eager?: boolean; fallbackAlt?: string; style?: CSSProperties }) {
  const { t } = useSite();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media?.url]);
  if (!media || media.kind !== 'image' || failed) return null;
  const cloud = media.provider === 'cloudinary';
  return (
    <img
      src={cloud ? cloudinaryUrl(media.url, { width: 1440 }) : media.url}
      srcSet={cloud ? cloudinarySrcSet(media.url) : undefined} sizes={cloud ? sizes : undefined}
      alt={t(media.alt) || fallbackAlt} className={className} style={style}
      loading={eager ? 'eager' : 'lazy'} decoding="async" {...(eager ? ({ fetchpriority: 'high' } as object) : {})}
      onError={() => setFailed(true)}
    />
  );
}

/** Poster URL for a video reference (Cloudinary can derive one; other sources need an explicit poster image). */
export function posterUrl(video: MediaRef | null | undefined, poster: MediaRef | null | undefined): string | undefined {
  if (poster?.kind === 'image') return poster.provider === 'cloudinary' ? cloudinaryUrl(poster.url, { width: 1440 }) : poster.url;
  if (video?.provider === 'cloudinary') return cloudinaryUrl(video.url, { width: 1440, poster: true });
  return undefined;
}

/**
 * Video for content sections. Uploaded / Cloudinary files use the native player (metadata only
 * until played). YouTube and Vimeo use the provider's official embed, loaded only after the
 * visitor clicks play, so no third-party player loads with the page.
 */
export function SiteVideo({ video, poster, title }: { video: MediaRef | null | undefined; poster?: MediaRef | null; title?: string }) {
  const { s } = useSite();
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!video || video.kind !== 'video' || failed) return null;
  const p = posterUrl(video, poster);
  if (video.provider === 'local' || video.provider === 'cloudinary') {
    return (
      <div className="site-media aspect-video bg-black">
        <video controls playsInline preload="metadata" poster={p} onError={() => setFailed(true)}>
          <source src={video.provider === 'cloudinary' ? cloudinaryUrl(video.url) : video.url} />
        </video>
      </div>
    );
  }
  const c = classifyMediaUrl(video.url);
  if (!c.ok || c.provider === 'cloudinary') return null;
  return (
    <div className="site-media aspect-video bg-site-secondary">
      {active ? (
        <iframe src={`${c.embedUrl}?autoplay=1&rel=0`} title={title || s('playVideo')} className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <button type="button" onClick={() => setActive(true)} className="group absolute inset-0 flex items-center justify-center text-white" aria-label={`${s('playVideo')}${title ? `: ${title}` : ''}`}>
          {p && <img src={p} alt="" className="absolute inset-0" loading="lazy" decoding="async" />}
          <span className="absolute inset-0 bg-black/30 transition-colors duration-500 group-hover:bg-black/45" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/70 backdrop-blur-sm transition-transform duration-500 group-hover:scale-105"><Play className="h-7 w-7 translate-x-0.5 fill-current" /></span>
        </button>
      )}
    </div>
  );
}

export interface LightboxItem { media: MediaRef; caption?: string }

/** Accessible full-screen viewer: Esc closes, arrow keys move, focus is trapped on the dialog and restored on close. */
export function Lightbox({ items, index, onClose, onIndex }: { items: LightboxItem[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const { s, rtl } = useSite();
  const ref = useRef<HTMLDivElement>(null);
  const item = items[index];
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; prev?.focus(); };
  }, []);
  useEffect(() => {
    const step = (d: number) => onIndex((index + d + items.length) % items.length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(rtl ? -1 : 1);
      else if (e.key === 'ArrowLeft') step(rtl ? 1 : -1);
      else if (e.key === 'Tab') {
        const f = Array.from(ref.current?.querySelectorAll<HTMLElement>('button, video, iframe') ?? []);
        if (!f.length) return;
        const first = f[0]!; const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex, rtl]);
  if (!item) return null;
  const many = items.length > 1;
  const nav = 'absolute top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 text-white transition-colors hover:bg-white hover:text-site-ink';
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={s('imageOf', { n: index + 1, total: items.length })} className="site-page-enter fixed inset-0 z-[80] flex flex-col bg-[#0b0f17]/95 text-white outline-none" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex items-center justify-between px-5 py-4">
        <span className="num text-xs tracking-[0.2em] text-white/70">{String(index + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</span>
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/30 transition-colors hover:bg-white hover:text-site-ink" aria-label={s('close')}><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-20" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {many && <button type="button" className={clsx(nav, 'start-3 sm:start-6')} onClick={() => onIndex((index - 1 + items.length) % items.length)} aria-label={s('previous')}><ChevronLeft className="site-flip h-5 w-5" /></button>}
        <div key={item.media.url} className="site-page-enter flex max-h-full w-full max-w-6xl items-center justify-center">
          {item.media.kind === 'image'
            ? <SiteImage media={item.media} eager sizes="100vw" fallbackAlt={item.caption} className="max-h-[74vh] w-auto max-w-full object-contain" />
            : <div className="w-full max-w-4xl"><SiteVideo video={item.media} title={item.caption} /></div>}
        </div>
        {many && <button type="button" className={clsx(nav, 'end-3 sm:end-6')} onClick={() => onIndex((index + 1) % items.length)} aria-label={s('next')}><ChevronRight className="site-flip h-5 w-5" /></button>}
      </div>
      <p className="min-h-[3.5rem] px-6 py-4 text-center text-sm text-white/80" aria-live="polite">{item.caption}</p>
    </div>
  );
}
