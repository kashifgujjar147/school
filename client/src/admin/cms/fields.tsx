import { useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronDown, Copy, Film, GripVertical, ImageIcon, Plus, Trash2 } from 'lucide-react';
import { WEBSITE_LANGUAGE_NAMES, cloudinaryUrl, isRtlLang, isSafeHref, pickL10n, type L10n, type MediaRef } from '@sms/shared';
import { Button, Checkbox, Input, Modal, Select } from '../../components/ui';
import { newId, useEditLang, useL, type MediaDoc } from './api';
import type { Field } from './defs';
import { MediaLibrary } from './MediaLibrary';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Language tabs for the content being edited. */
export function LangTabs({ languages, value, onChange, defaultLang }: { languages: string[]; value: string; onChange: (l: string) => void; defaultLang: string }) {
  const L = useL();
  if (languages.length < 2) return null;
  return (
    <div className="inline-flex rounded-xl bg-surface-muted p-1" role="tablist" aria-label={L('Content language', 'مواد کی زبان')}>
      {languages.map((l) => (
        <button key={l} type="button" role="tab" aria-selected={l === value} onClick={() => onChange(l)} className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium transition', l === value ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink')}>
          {WEBSITE_LANGUAGE_NAMES[l] ?? l.toUpperCase()}{l === defaultLang && <span className="ms-1 text-[10px] uppercase text-ink-faint">{L('default', 'بنیادی')}</span>}
        </button>
      ))}
    </div>
  );
}

/** One localized text field: edits the selected language, shows the default-language text as a guide. */
export function L10nInput({ label, value, onChange, multiline, rows = 3, max, hint }: { label: string; value: L10n | undefined; onChange: (v: L10n) => void; multiline?: boolean; rows?: number; max?: number; hint?: string }) {
  const { lang, defaultLang } = useEditLang();
  const id = useId();
  const v = value ?? {};
  const text = v[lang] ?? '';
  const guide = lang !== defaultLang ? v[defaultLang] ?? '' : '';
  const missing = lang !== defaultLang && Boolean(guide.trim()) && !text.trim();
  const set = (s: string) => { const next = { ...v }; if (s === '') delete next[lang]; else next[lang] = s; onChange(next); };
  const common = { id, value: text, dir: isRtlLang(lang) ? 'rtl' as const : 'ltr' as const, lang, maxLength: max, placeholder: guide || undefined, className: clsx('input', missing && 'border-amber-400', isRtlLang(lang) && 'font-urdu leading-loose') };
  return (
    <div>
      <label htmlFor={id} className="label flex items-center justify-between gap-2"><span>{label}</span>{missing && <span className="text-[11px] font-normal text-amber-700">Not translated — the {WEBSITE_LANGUAGE_NAMES[defaultLang] ?? defaultLang} text is shown</span>}</label>
      {multiline ? <textarea rows={rows} {...common} onChange={(e) => set(e.target.value)} /> : <input type="text" {...common} onChange={(e) => set(e.target.value)} />}
      {hint && <p className="mt-1 break-words text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function MediaThumb({ media, className }: { media: { kind: string; provider: string; url: string } | null | undefined; className?: string }) {
  if (!media) return <div className={clsx('flex items-center justify-center bg-surface-muted text-ink-faint', className)}><ImageIcon className="h-5 w-5" /></div>;
  const img = media.kind === 'image' ? (media.provider === 'cloudinary' ? cloudinaryUrl(media.url, { width: 480 }) : media.url) : media.provider === 'cloudinary' ? cloudinaryUrl(media.url, { width: 480, poster: true }) : null;
  return (
    <div className={clsx('relative overflow-hidden bg-slate-900', className)}>
      {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
        : media.provider === 'local' ? <video src={media.url} muted preload="metadata" className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-xs uppercase tracking-wide text-white/80">{media.provider}</div>}
      {media.kind === 'video' && <span className="absolute bottom-1 start-1 rounded bg-black/70 p-1 text-white"><Film className="h-3 w-3" /></span>}
    </div>
  );
}

/** Pick an image / video for a field: from the library, by uploading, or by pasting a Cloudinary / video URL. */
export function MediaField({ label, value, onChange, kind, fileOnly, hint }: { label: string; value: MediaRef | null | undefined; onChange: (v: MediaRef | null) => void; kind: 'image' | 'video' | 'any'; fileOnly?: boolean; hint?: string }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const pick = (m: MediaDoc) => { onChange({ id: m._id, kind: m.kind, provider: m.provider, url: m.url, alt: m.alt ?? {} }); setOpen(false); };
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-start gap-3">
        <MediaThumb media={value} className="h-20 w-28 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(true)}>{value ? L('Change', 'تبدیل کریں') : L('Choose or upload', 'منتخب یا اپ لوڈ کریں')}</Button>
            {value && <Button type="button" variant="ghost" onClick={() => onChange(null)}>{L('Remove', 'ہٹائیں')}</Button>}
          </div>
          {value?.kind === 'image' && <L10nInput label={L('Alt text (describes the image for screen readers and search engines)', 'متبادل متن')} value={value.alt} onChange={(alt) => onChange({ ...value, alt })} max={300} />}
        </div>
      </div>
      {hint && <p className="mt-1 break-words text-xs text-ink-faint">{hint}</p>}
      {/* Portalled to <body>: this field usually sits inside the page builder's sticky editor panel, whose
          stacking context would otherwise trap the dialog's z-index under the live-preview column. */}
      {open && typeof document !== 'undefined' && createPortal(
        <Modal open onClose={() => setOpen(false)} title={L('Media library', 'میڈیا لائبریری')} wide>
          <MediaLibrary picker={{ kind, fileOnly, onPick: pick }} />
        </Modal>,
        document.body,
      )}
    </div>
  );
}

export function LinkField({ label, value, onChange }: { label: string; value: { label: L10n; href: string } | null | undefined; onChange: (v: { label: L10n; href: string } | null) => void }) {
  const v = value ?? { label: {}, href: '' };
  const bad = v.href !== '' && !isSafeHref(v.href);
  const update = (next: { label: L10n; href: string }) => onChange(Object.keys(next.label).length === 0 && !next.href ? null : next);
  return (
    <fieldset className="rounded-xl border border-surface-line p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <L10nInput label="Label" value={v.label} onChange={(l) => update({ ...v, label: l })} max={80} />
        <Input label="Goes to" value={v.href} dir="ltr" placeholder="/admissions" onChange={(e) => update({ ...v, href: e.target.value.trim() })} error={bad ? 'Use a page path (/admissions), https://…, mailto: or tel:' : undefined} hint="A page path such as /admissions, or a full https:// link" />
      </div>
    </fieldset>
  );
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]; const [m] = next.splice(from, 1); next.splice(to, 0, m!); return next;
}

/** Sortable list (drag and drop, plus up/down buttons for keyboard and touch). */
export function SortableList<T extends { id: string }>({ items, onChange, render, title, onAdd, addLabel, max, extraActions, orderOnly }: {
  items: T[]; onChange: (items: T[]) => void; render: (item: T, update: (v: T) => void) => ReactNode; title: (item: T, index: number) => ReactNode;
  onAdd?: () => void; addLabel?: string; max?: number; extraActions?: (item: T, index: number) => ReactNode;
  /** Reorder only: hide the built-in duplicate / remove buttons (the caller provides its own actions). */
  orderOnly?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const drag = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={it.id} className={clsx('rounded-xl border bg-white', over === i ? 'border-brand ring-2 ring-brand/20' : 'border-surface-line')}
          onDragOver={(e) => { if (drag.current !== null) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => { e.preventDefault(); if (drag.current !== null && drag.current !== i) onChange(reorder(items, drag.current, i)); drag.current = null; setOver(null); }}>
          <div className="flex items-center gap-1 px-2 py-1.5">
            <span draggable onDragStart={(e) => { drag.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); }} onDragEnd={() => { drag.current = null; setOver(null); }} className="cursor-grab p-1.5 text-ink-faint active:cursor-grabbing" title="Drag to reorder" aria-hidden><GripVertical className="h-4 w-4" /></span>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-start text-sm font-medium" aria-expanded={open === it.id} onClick={() => setOpen(open === it.id ? null : it.id)}>
              <span className="truncate">{title(it, i)}</span><ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-faint transition-transform', open === it.id && 'rotate-180')} />
            </button>
            {extraActions?.(it, i)}
            <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted disabled:opacity-30" disabled={i === 0} onClick={() => onChange(reorder(items, i, i - 1))} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted disabled:opacity-30" disabled={i === items.length - 1} onClick={() => onChange(reorder(items, i, i + 1))} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
            {!orderOnly && <>
              <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted disabled:opacity-30" disabled={max !== undefined && items.length >= max} onClick={() => { const copy = { ...structuredClone(it), id: newId() }; const next = [...items]; next.splice(i + 1, 0, copy); onChange(next); }} aria-label="Duplicate"><Copy className="h-4 w-4" /></button>
            <button type="button" className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={() => onChange(items.filter((x) => x.id !== it.id))} aria-label="Remove"><Trash2 className="h-4 w-4" /></button>
            </>}
          </div>
          {open === it.id && <div className="border-t border-surface-line p-3">{render(it, (v) => onChange(items.map((x) => (x.id === it.id ? v : x))))}</div>}
        </div>
      ))}
      {onAdd && <Button type="button" variant="secondary" disabled={max !== undefined && items.length >= max} onClick={onAdd}><Plus className="h-4 w-4" />{addLabel}</Button>}
    </div>
  );
}

const toLocalInput = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

/** Renders a form from field definitions. `value` is a plain object; every change returns a new object. */
export function FormFields({ fields, value, onChange }: { fields: Field[]; value: Obj; onChange: (v: Obj) => void }) {
  const { lang, defaultLang } = useEditLang();
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-4">
      {fields.filter((f) => !f.when || f.when(value)).map((f) => {
        const v = value[f.k];
        switch (f.type) {
          case 'l10n': return <L10nInput key={f.k} label={f.label} value={v} onChange={(x) => set(f.k, x)} multiline={f.multiline} rows={f.rows} max={f.max} hint={f.hint} />;
          case 'text': return <Input key={f.k} label={f.label} value={v ?? ''} maxLength={f.max} placeholder={f.placeholder} dir={f.ltr ? 'ltr' : undefined} hint={f.hint} onChange={(e) => set(f.k, e.target.value)} />;
          case 'number': return <Input key={f.k} label={f.label} type="number" value={v ?? ''} min={f.min} max={f.max} step={f.step} hint={f.hint} onChange={(e) => set(f.k, e.target.value === '' ? null : Number(e.target.value))} />;
          case 'bool': return <div key={f.k}><Checkbox label={f.label} checked={Boolean(v)} onChange={(x) => set(f.k, x)} /></div>;
          case 'date': return <Input key={f.k} label={f.label} type="date" value={v ?? ''} onChange={(e) => set(f.k, e.target.value)} />;
          case 'datetime': return <Input key={f.k} label={f.label} type="datetime-local" value={toLocalInput(v)} hint={f.hint} onChange={(e) => set(f.k, e.target.value ? new Date(e.target.value).toISOString() : null)} />;
          case 'color': return <div key={f.k}><label className="label">{f.label}</label><div className="flex items-center gap-3"><input type="color" value={v ?? '#000000'} onChange={(e) => set(f.k, e.target.value)} className="h-10 w-14 cursor-pointer rounded border border-surface-line" aria-label={f.label} /><span className="num text-sm text-ink-soft">{v}</span></div></div>;
          case 'select': return <Select key={f.k} label={f.label} value={String(v ?? '')} options={f.options.map(([value, label]) => ({ value, label }))} hint={f.hint} onChange={(e) => set(f.k, f.numeric ? Number(e.target.value) : e.target.value === '' && f.k === 'icon' ? null : e.target.value)} />;
          case 'media': return <MediaField key={f.k} label={f.label} value={v} kind={f.kind} fileOnly={f.fileOnly} hint={f.hint} onChange={(x) => set(f.k, x)} />;
          case 'link': return <LinkField key={f.k} label={f.label} value={v} onChange={(x) => set(f.k, x)} />;
          case 'list': {
            const items = (v ?? []) as (Obj & { id: string })[];
            return (
              <div key={f.k}>
                <span className="label">{f.label} <span className="font-normal text-ink-faint">({items.length}/{f.max})</span></span>
                <SortableList items={items} max={f.max} addLabel={f.addLabel} onChange={(x) => set(f.k, x)}
                  onAdd={() => set(f.k, [...items, { id: newId(), ...(f.blank?.() ?? {}) }])}
                  title={(it, i) => { const raw = f.titleKey ? it[f.titleKey] : null; const text = raw && typeof raw === 'object' ? pickL10n(raw as L10n, lang, defaultLang) : typeof raw === 'string' ? raw : ''; return <>{text || `${f.addLabel.replace(/^Add /, '')} ${i + 1}`}{it.active === false && <span className="ms-2 text-xs font-normal text-ink-faint">(hidden)</span>}</>; }}
                  render={(it, update) => <FormFields fields={f.fields} value={it} onChange={(x) => update(x as Obj & { id: string })} />} />
              </div>
            );
          }
        }
      })}
    </div>
  );
}
