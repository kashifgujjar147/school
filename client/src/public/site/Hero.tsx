import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { activeHeroSlides, cloudinaryUrl, heroSlidePlan, nextSlideIndex, type HeroSlide, type MediaRef } from '@sms/shared';
import { SiteLink, useSite } from './context';
import { SiteImage, posterUrl } from './Media';
import { useMediaQuery, usePageVisible, useReducedMotion } from './hooks';

const HEIGHT = { full: 'min-h-[100svh]', tall: 'min-h-[82svh]', medium: 'min-h-[62svh]' } as const;

/** Which media a slide shows on this screen. On phones a background video is used only when a mobile
 *  video was assigned (or there is no poster to show instead), so large desktop videos are not downloaded. */
function pickMedia(slide: HeroSlide, mobile: boolean): { kind: 'image' | 'video' | 'none'; ref: MediaRef | null } {
  if (slide.mediaType === 'none') return { kind: 'none', ref: null };
  const chosen = (mobile && slide.mobile) || slide.desktop || slide.mobile;
  if (!chosen) return { kind: 'none', ref: null };
  if (chosen.kind === 'video' && mobile && !slide.mobile && slide.poster) return { kind: 'image', ref: slide.poster };
  return { kind: chosen.kind, ref: chosen };
}

/**
 * Hero slider. One timer at a time, owned by a single effect that is torn down on every change:
 *  - image / text slides advance after their CMS duration;
 *  - video slides advance when the video ends, unless the slide enables the override duration;
 *  - a video that cannot play falls back to its poster and the timer, so the hero never freezes;
 *  - rotation pauses while the tab is hidden and is off under prefers-reduced-motion (arrows still work);
 *  - focus and hover never pause it.
 */
export function Hero({ slides: all, height = 'full' }: { slides: HeroSlide[]; height?: keyof typeof HEIGHT }) {
  const { t, s, rtl } = useSite();
  const slides = useMemo(() => activeHeroSlides(all), [all]);
  const mobile = useMediaQuery('(max-width: 767px)');
  const reduced = useReducedMotion();
  const visible = usePageVisible();
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0); // restarts the progress animation when the same slide replays
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const bars = useRef<Record<string, HTMLSpanElement | null>>({});
  const n = slides.length;
  const i = n ? Math.min(index, n - 1) : 0;
  const current = slides[i];
  const media = current ? pickMedia(current, mobile) : null;
  const videoPlayable = Boolean(current && media?.kind === 'video' && !broken[current.id] && !reduced);
  const plan = current ? heroSlidePlan(current.mediaType === 'video' && media?.kind !== 'video' ? { ...current, mediaType: 'image' } : current, videoPlayable) : null;

  const go = useCallback((dir: 1 | -1) => { setIndex((x) => nextSlideIndex(Math.min(x, Math.max(n - 1, 0)), n, dir)); setCycle((c) => c + 1); }, [n]);
  const goTo = (to: number) => { setIndex(to); setCycle((c) => c + 1); };

  useEffect(() => { if (index > n - 1) setIndex(0); }, [n, index]);

  // Playback: the only place a timer or video listener is created.
  useEffect(() => {
    if (!current || !plan) return;
    const video = media?.kind === 'video' ? videos.current[current.id] : null;
    for (const [id, v] of Object.entries(videos.current)) if (v && id !== current.id) { v.pause(); }
    if (video && videoPlayable && visible) {
      try { video.currentTime = 0; } catch { /* not seekable yet */ }
      video.loop = n === 1;
      void video.play().catch(() => setBroken((b) => ({ ...b, [current.id]: true })));
    } else video?.pause();
    if (n < 2 || reduced || !visible) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => go(1);
    if (plan.mode === 'timer') timer = setTimeout(advance, plan.ms);
    else if (video) {
      const bar = bars.current[current.id];
      const onTime = () => { if (bar && video.duration > 0) bar.style.setProperty('--p', String(Math.min(1, video.currentTime / video.duration))); };
      video.addEventListener('ended', advance);
      video.addEventListener('timeupdate', onTime);
      timer = setTimeout(advance, plan.capMs); // safety net for streams that never fire "ended"
      return () => { clearTimeout(timer); video.removeEventListener('ended', advance); video.removeEventListener('timeupdate', onTime); };
    }
    return () => clearTimeout(timer);
    // `cycle` restarts the timer when a visitor navigates manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, plan?.mode, plan && plan.mode === 'timer' ? plan.ms : 0, videoPlayable, visible, reduced, n, cycle, media?.kind]);

  if (!current) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (n < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(rtl ? -1 : 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(rtl ? 1 : -1); }
  };

  return (
    <section className={clsx('site-on-dark relative isolate flex overflow-hidden bg-site-secondary text-white', HEIGHT[height])} aria-roledescription="carousel" aria-label={s('heroLabel')} onKeyDown={onKey}>
      {slides.map((sl, k) => {
        const m = pickMedia(sl, mobile);
        const active = k === i;
        const near = active || k === nextSlideIndex(i, n); // only the current and next slide load media
        const overlay = sl.overlay / 100;
        const tint: CSSProperties = m.kind === 'none' ? {} : sl.overlayStyle === 'solid'
          ? { background: `rgb(8 12 22 / ${overlay})` }
          : { background: `linear-gradient(to top, rgb(8 12 22 / ${Math.min(0.92, overlay + 0.3)}) 0%, rgb(8 12 22 / ${overlay * 0.55}) 45%, rgb(8 12 22 / ${Math.min(0.6, overlay * 0.75)}) 100%)` };
        const showVideo = m.kind === 'video' && !broken[sl.id] && !reduced;
        const poster = posterUrl(m.kind === 'video' ? m.ref : null, sl.poster);
        return (
          <div key={sl.id} className={clsx('site-hero-slide', active && 'is-active')} data-anim={sl.animation} role="group" aria-roledescription="slide" aria-label={s('slide', { n: k + 1, total: n })} aria-hidden={!active} {...(!active ? { inert: '' } as object : {})}>
            {m.kind === 'none' && <div className="site-hero-pattern absolute inset-0" />}
            {m.kind === 'image' && near && <SiteImage media={m.ref} eager={k === 0} sizes="100vw" className="site-hero-media" />}
            {m.kind === 'video' && (showVideo
              ? near && (
                <video ref={(el) => { videos.current[sl.id] = el; }} className="site-hero-media" muted playsInline preload={active ? 'auto' : 'metadata'} poster={poster} aria-hidden tabIndex={-1} disablePictureInPicture
                  onError={() => setBroken((b) => ({ ...b, [sl.id]: true }))}>
                  <source src={m.ref!.provider === 'cloudinary' ? cloudinaryUrl(m.ref!.url, { width: mobile ? 768 : 1920 }) : m.ref!.url} onError={() => setBroken((b) => ({ ...b, [sl.id]: true }))} />
                </video>
              )
              : poster ? <img src={poster} alt="" className="site-hero-media" decoding="async" /> : <div className="site-hero-pattern absolute inset-0" />)}
            <div className="absolute inset-0" style={tint} />
            <div className={clsx('relative z-10 mx-auto flex h-full w-full max-w-site px-6 pb-28 pt-36 sm:px-10 lg:px-14', sl.valign === 'middle' ? 'items-center' : 'items-end', sl.align === 'center' ? 'justify-center text-center' : sl.align === 'end' ? 'justify-end text-end' : 'justify-start text-start')}>
              <div className={clsx('site-hero-text max-w-3xl', sl.align === 'center' && 'flex flex-col items-center', sl.align === 'end' && 'flex flex-col items-end')}>
                {t(sl.eyebrow) && <p className="site-eyebrow mb-5 text-site-accent" style={{ '--i': 0 } as CSSProperties}>{t(sl.eyebrow)}</p>}
                {t(sl.headline) && (k === 0
                  ? <h1 className="text-[clamp(2.5rem,6.2vw,5.25rem)] leading-[1.04]" style={{ '--i': 1 } as CSSProperties}>{t(sl.headline)}</h1>
                  : <h2 className="text-[clamp(2.5rem,6.2vw,5.25rem)] leading-[1.04]" style={{ '--i': 1 } as CSSProperties}>{t(sl.headline)}</h2>)}
                {t(sl.description) && <p className="mt-6 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg" style={{ '--i': 2 } as CSSProperties}>{t(sl.description)}</p>}
                {(sl.cta1 || sl.cta2) && (
                  <div className={clsx('mt-9 flex flex-wrap gap-4', sl.align === 'center' && 'justify-center', sl.align === 'end' && 'justify-end')} style={{ '--i': 3 } as CSSProperties}>
                    {sl.cta1 && t(sl.cta1.label) && <SiteLink href={sl.cta1.href} className="site-btn site-btn-accent">{t(sl.cta1.label)}<ArrowRight aria-hidden /></SiteLink>}
                    {sl.cta2 && t(sl.cta2.label) && <SiteLink href={sl.cta2.href} className="site-btn site-btn-outline is-light">{t(sl.cta2.label)}</SiteLink>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {n > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-20">
          <div className="mx-auto flex max-w-site items-center gap-6 px-6 pb-8 sm:px-10 lg:px-14">
            <span className="num text-xs tracking-[0.2em] text-white/80" aria-hidden>{String(i + 1).padStart(2, '0')} <span className="text-white/40">/ {String(n).padStart(2, '0')}</span></span>
            <div className="flex flex-1 items-center gap-2" role="tablist" aria-label={s('heroLabel')}>
              {slides.map((sl, k) => (
                <button key={sl.id} type="button" role="tab" aria-selected={k === i} aria-label={s('slide', { n: k + 1, total: n })} onClick={() => goTo(k)} className="group flex-1 py-3 sm:max-w-[7rem]">
                  <span key={k === i ? `on-${cycle}` : 'off'} className={clsx('site-progress block', k < i && 'is-done', k === i && plan?.mode === 'timer' && !reduced && visible && 'is-timed', k === i && (reduced || !visible) && 'is-done')} style={{ '--d': plan?.mode === 'timer' ? `${plan.ms}ms` : undefined } as CSSProperties}>
                    <span ref={(el) => { bars.current[sl.id] = el; }} />
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden gap-2 sm:flex">
              <button type="button" onClick={() => go(-1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/40 transition-colors duration-300 hover:bg-white hover:text-site-ink" aria-label={s('previous')}><ChevronLeft className="site-flip h-4 w-4" /></button>
              <button type="button" onClick={() => go(1)} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/40 transition-colors duration-300 hover:bg-white hover:text-site-ink" aria-label={s('next')}><ChevronRight className="site-flip h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}
      <div className="sr-only" aria-live="polite">{t(current.headline)}</div>
    </section>
  );
}
