import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Archive, Check, Link2, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { classifyMediaUrl, cloudinaryUrl } from '@sms/shared';
import { useGet } from '../../hooks/useApi';
import { useFormat } from '../../i18n';
import { useAuth } from '../../store/auth';
import { ApiError, del, get, patch, post } from '../../services/api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Input, Modal, Pagination, Select, Spinner, errorMessage } from '../../components/ui';
import { EditLang, fmtBytes, useL, xhrUpload, type MediaConfig, type MediaDoc } from './api';
import { L10nInput, LangTabs, MediaThumb } from './fields';

interface Picker { kind: 'image' | 'video' | 'any'; fileOnly?: boolean; onPick: (m: MediaDoc) => void }
interface Queued { id: string; file: File; preview: string; kind: 'image' | 'video'; progress: number; state: 'ready' | 'uploading' | 'done' | 'error'; error?: string }
interface Ticket { uploadUrl: string; apiKey: string; params: Record<string, string | number>; signature: string; maxBytes: number }

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

/** Reads pixel size (images) or duration (videos) in the browser so layouts can reserve space. */
function probe(file: File, preview: string): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const done = (v: object) => resolve(v);
    if (file.type.startsWith('image/')) { const i = new Image(); i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => done({}); i.src = preview; }
    else { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => done({ width: v.videoWidth || undefined, height: v.videoHeight || undefined, durationSec: Number.isFinite(v.duration) ? Math.round(v.duration) : undefined }); v.onerror = () => done({}); v.src = preview; }
    setTimeout(() => done({}), 4000);
  });
}

/**
 * Media library. Three ways in: upload from the computer (to Cloudinary when the server is
 * configured for it, otherwise to the school server), paste a Cloudinary URL, or paste a YouTube /
 * Vimeo link. In picker mode it selects an asset for a CMS field.
 */
export function MediaLibrary({ picker }: { picker?: Picker }) {
  const L = useL(); const f = useFormat(); const qc = useQueryClient();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const [q, setQ] = useState(''); const [kind, setKind] = useState<string>(picker && picker.kind !== 'any' ? picker.kind : ''); const [category, setCategory] = useState(''); const [archived, setArchived] = useState(false); const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [urlOpen, setUrlOpen] = useState(false); const [url, setUrl] = useState('');
  const [detail, setDetail] = useState<MediaDoc | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [useCloud, setUseCloud] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const cfg = useGet<MediaConfig>('/api/website/media/config');
  const listUrl = `/api/website/media?page=${page}&pageSize=24${q ? `&q=${encodeURIComponent(q)}` : ''}${kind ? `&kind=${kind}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}${archived ? '&archived=true' : ''}`;
  const list = useGet<MediaDoc[]>(listUrl);
  const refresh = () => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/website/media') });
  const categories = ((list.data?.meta as { categories?: string[] } | undefined)?.categories) ?? [];
  const config = cfg.data?.data;
  useEffect(() => { setPage(1); }, [q, kind, category, archived]);
  useEffect(() => () => { queue.forEach((x) => URL.revokeObjectURL(x.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (files: FileList | null) => {
    if (!files || !config) return;
    const next: Queued[] = [];
    for (const file of Array.from(files)) {
      const k = IMAGE_TYPES.includes(file.type) ? 'image' : VIDEO_TYPES.includes(file.type) ? 'video' : null;
      const max = (k === 'image' ? config.imageMaxMb : config.videoMaxMb) * 1048576;
      const error = !k ? L('Only PNG, JPEG, WebP images and MP4, WebM videos are accepted') : file.size > max ? `${L('Too large: maximum')} ${k === 'image' ? config.imageMaxMb : config.videoMaxMb} MB` : undefined;
      next.push({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), kind: k ?? 'image', progress: 0, state: error ? 'error' : 'ready', error });
    }
    setQueue((cur) => [...cur, ...next]);
    if (input.current) input.current.value = '';
  };
  const setItem = (id: string, p: Partial<Queued>) => setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const uploadOne = async (item: Queued) => {
    setItem(item.id, { state: 'uploading', progress: 0, error: undefined });
    try {
      const meta = await probe(item.file, item.preview);
      if (config?.cloudinary && useCloud) {
        // Signed direct upload: the secret stays on the server, the file goes straight to Cloudinary.
        const t = await post<Ticket>('/api/website/media/cloudinary-ticket', { kind: item.kind });
        const form = new FormData();
        form.append('file', item.file); form.append('api_key', t.apiKey); form.append('signature', t.signature);
        for (const [k, v] of Object.entries(t.params)) form.append(k, String(v));
        const r = await xhrUpload<{ secure_url?: string; bytes?: number; width?: number; height?: number; duration?: number; error?: { message?: string } }>(t.uploadUrl, form, (p) => setItem(item.id, { progress: p }), { sameOrigin: false });
        if (!r.secure_url) throw new Error(r.error?.message ?? 'Cloudinary did not return a file URL');
        await post('/api/website/media/register', { url: r.secure_url, uploaded: true, title: item.file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 160), sizeBytes: r.bytes, width: r.width, height: r.height, durationSec: r.duration ? Math.round(r.duration) : undefined });
      } else {
        const form = new FormData();
        form.append('file', item.file);
        if (meta.width) form.append('width', String(meta.width));
        if (meta.height) form.append('height', String(meta.height));
        await xhrUpload<MediaDoc>('/api/website/media/upload', form, (p) => setItem(item.id, { progress: p }), { sameOrigin: true });
      }
      setItem(item.id, { state: 'done', progress: 1 });
      return true;
    } catch (e) { setItem(item.id, { state: 'error', error: e instanceof Error ? e.message : L('Upload failed') }); return false; }
  };
  const uploadAll = async () => {
    let okCount = 0;
    for (const item of queue.filter((x) => x.state === 'ready')) if (await uploadOne(item)) okCount += 1;
    if (okCount) { await refresh(); setMsg({ kind: 'success', text: `${okCount} ${L('file(s) added to the library')}` }); }
    setQueue((cur) => { cur.filter((x) => x.state === 'done').forEach((x) => URL.revokeObjectURL(x.preview)); return cur.filter((x) => x.state !== 'done'); });
  };

  const check = url.trim() ? classifyMediaUrl(url) : null;
  const registerUrl = async () => {
    try { const m = await post<MediaDoc>('/api/website/media/register', { url: url.trim() }); setUrl(''); setUrlOpen(false); await refresh(); if (picker) picker.onPick(m); else setMsg({ kind: 'success', text: L('Added to the library') }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e, L('The URL could not be added')) }); }
  };

  const allowed = (m: MediaDoc) => !picker || ((picker.kind === 'any' || picker.kind === m.kind) && (!picker.fileOnly || m.kind === 'image' || m.provider === 'local' || m.provider === 'cloudinary'));
  const ready = queue.filter((x) => x.state === 'ready').length;
  const busy = queue.some((x) => x.state === 'uploading');

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative min-w-[12rem] flex-1"><span className="sr-only">{L('Search')}</span><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" /><input className="input ps-9" placeholder={L('Search by name or category', 'نام یا زمرہ سے تلاش')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {(!picker || picker.kind === 'any') && <Select aria-label={L('Type')} value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: L('Images and videos') }, { value: 'image', label: L('Images') }, { value: 'video', label: L('Videos') }]} />}
        <Select aria-label={L('Category')} value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: L('All categories') }, ...categories.map((c) => ({ value: c, label: c }))]} />
        {!picker && <label className="inline-flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{L('Include archived')}</label>}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setUrlOpen(true)}><Link2 className="h-4 w-4" />{L('Add from URL', 'یو آر ایل سے')}</Button>
          <Button onClick={() => input.current?.click()} disabled={!config}><Upload className="h-4 w-4" />{L('Upload', 'اپ لوڈ')}</Button>
          <input ref={input} type="file" multiple hidden accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')} onChange={(e) => addFiles(e.target.files)} />
        </div>
      </div>

      {queue.length > 0 && (
        <div className="rounded-xl border border-surface-line bg-surface-muted p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{L('Ready to upload')}: {ready}</p>
            <div className="flex flex-wrap items-center gap-3">
              {config?.cloudinary
                ? <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={useCloud} onChange={(e) => setUseCloud(e.target.checked)} disabled={busy} />{L('Store on Cloudinary')} ({config.cloudName})</label>
                : <span className="text-xs text-ink-faint">{L('Files are stored on the school server (Cloudinary is not configured).')}</span>}
              <Button onClick={() => void uploadAll()} disabled={!ready || busy} loading={busy}>{L('Upload now')}</Button>
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {queue.map((x) => (
              <li key={x.id} className="flex items-center gap-3 rounded-lg bg-white p-2">
                {x.kind === 'image' ? <img src={x.preview} alt="" className="h-14 w-20 shrink-0 rounded object-cover" /> : <video src={x.preview} muted preload="metadata" className="h-14 w-20 shrink-0 rounded bg-black object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{x.file.name}</p>
                  <p className="text-xs text-ink-faint">{fmtBytes(x.file.size)}</p>
                  {x.state === 'uploading' && <div className="mt-1 h-1.5 overflow-hidden rounded bg-surface-line" role="progressbar" aria-valuenow={Math.round(x.progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(x.progress * 100)}%` }} /></div>}
                  {x.error && <p className="text-xs text-red-600">{x.error}</p>}
                </div>
                {x.state !== 'uploading' && <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted" aria-label={L('Remove')} onClick={() => { URL.revokeObjectURL(x.preview); setQueue((cur) => cur.filter((y) => y.id !== x.id)); }}><X className="h-4 w-4" /></button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {list.isLoading ? <Spinner /> : !list.data?.data.length ? <EmptyState title={L('No media yet', 'ابھی کوئی میڈیا نہیں')}>{L('Upload photos and videos, or add a Cloudinary, YouTube or Vimeo link.')}</EmptyState> : (
        <>
          <ul className={clsx('grid grid-cols-2 gap-3 sm:grid-cols-3', picker ? 'md:grid-cols-4' : 'md:grid-cols-4 xl:grid-cols-6')}>
            {list.data.data.map((m) => (
              <li key={m._id}>
                <button type="button" disabled={!allowed(m)} onClick={() => (picker ? picker.onPick(m) : setDetail(m))} className={clsx('group block w-full overflow-hidden rounded-xl border border-surface-line bg-white text-start transition hover:border-brand hover:shadow-card disabled:cursor-not-allowed disabled:opacity-40', m.archivedAt && 'opacity-60')}>
                  <MediaThumb media={m} className="aspect-[4/3] w-full" />
                  <span className="block truncate px-2.5 pt-2 text-xs font-medium">{m.title || m.originalName || m.kind}</span>
                  <span className="flex items-center justify-between gap-2 px-2.5 pb-2 text-[11px] text-ink-faint"><span className="truncate">{m.provider}{m.category ? ` · ${m.category}` : ''}</span>{picker && allowed(m) && <Check className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />}</span>
                </button>
                {picker && <button type="button" className="mt-1 w-full text-center text-[11px] text-ink-faint underline-offset-2 hover:underline" onClick={() => setDetail(m)}>{L('Details')}</button>}
              </li>
            ))}
          </ul>
          {list.data.meta && list.data.meta.total > list.data.meta.pageSize && <Pagination page={page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />}
        </>
      )}

      <Modal open={urlOpen} onClose={() => setUrlOpen(false)} title={L('Add media from a URL')} footer={<><Button variant="secondary" onClick={() => setUrlOpen(false)}>{L('Cancel')}</Button><Button disabled={!check?.ok} onClick={() => void registerUrl()}>{L('Add to library')}</Button></>}>
        <div className="space-y-4">
          <Input label={L('Cloudinary image/video URL, or a YouTube / Vimeo link')} dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://res.cloudinary.com/your-cloud/image/upload/…" error={check && !check.ok ? check.reason : undefined} />
          {check?.ok && (
            <div className="space-y-2">
              <Badge color="green">{check.provider} · {check.kind}</Badge>
              {check.provider === 'cloudinary'
                ? (check.kind === 'image' ? <img src={cloudinaryUrl(check.url, { width: 720 })} alt="" className="max-h-64 w-full rounded-lg bg-surface-muted object-contain" /> : <video src={check.url} controls preload="metadata" className="max-h-64 w-full rounded-lg bg-black" />)
                : <iframe src={check.embedUrl} title="Preview" className="aspect-video w-full rounded-lg" allow="encrypted-media; picture-in-picture" allowFullScreen />}
            </div>
          )}
          <p className="text-xs text-ink-faint">{L('Only Cloudinary delivery URLs and official YouTube / Vimeo links are accepted. Other web addresses are not playable media and are refused.')}</p>
        </div>
      </Modal>

      {detail && <MediaDetail media={detail} canDelete={canPublish} onClose={() => setDetail(null)} onChanged={async (m) => { await refresh(); setDetail(m); }} />}
    </div>
  );
}

function MediaDetail({ media, onClose, onChanged, canDelete }: { media: MediaDoc; onClose: () => void; onChanged: (m: MediaDoc | null) => Promise<void>; canDelete: boolean }) {
  const L = useL(); const f = useFormat();
  const [v, setV] = useState(media);
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const usage = useGet<{ where: string; label: string }[]>(`/api/website/media/${media._id}/usage`);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setV(media), [media]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e instanceof ApiError || e instanceof Error ? e.message : L('Something went wrong')); } finally { setBusy(false); } };
  const save = () => run(async () => { const m = await patch<MediaDoc>(`/api/website/media/${media._id}`, { title: v.title, category: v.category, alt: v.alt ?? {}, caption: v.caption ?? {} }); await onChanged(m); });
  const replace = (fl: File) => run(async () => {
    const form = new FormData(); form.append('file', fl);
    setProgress(0);
    try { const r = await xhrUpload<{ media: MediaDoc }>(`/api/website/media/${media._id}/replace`, form, setProgress, { sameOrigin: true }); await onChanged(r.media); } finally { setProgress(null); }
  });
  const used = usage.data?.data ?? [];
  return (
    <Modal open onClose={onClose} title={v.title || L('Media details')} wide footer={<><Button variant="secondary" onClick={onClose}>{L('Close')}</Button><Button loading={busy} onClick={() => void save()}>{L('Save')}</Button></>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          {v.kind === 'image' ? <img src={v.provider === 'cloudinary' ? cloudinaryUrl(v.url, { width: 960 }) : v.url} alt="" className="max-h-80 w-full rounded-xl bg-surface-muted object-contain" />
            : v.provider === 'local' || v.provider === 'cloudinary' ? <video src={v.url} controls preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />
              : <iframe src={v.embedUrl} title={v.title} className="aspect-video w-full rounded-xl" allow="encrypted-media; picture-in-picture" allowFullScreen />}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-ink-soft">
            <dt>{L('Source')}</dt><dd>{v.provider} ({v.source})</dd>
            {v.mime && <><dt>{L('Format')}</dt><dd>{v.mime}</dd></>}
            {v.sizeBytes ? <><dt>{L('Size')}</dt><dd className="num">{fmtBytes(v.sizeBytes)}</dd></> : null}
            {v.width && v.height ? <><dt>{L('Dimensions')}</dt><dd className="num">{v.width} × {v.height}</dd></> : null}
            <dt>{L('Added')}</dt><dd>{f.dateTime(v.createdAt)}</dd>
            <dt>URL</dt><dd className="break-all" dir="ltr">{v.url}</dd>
          </dl>
          <div>
            <p className="mb-1 text-sm font-medium">{L('Used in')}</p>
            {usage.isLoading ? <p className="text-xs text-ink-faint">…</p> : used.length ? <ul className="list-inside list-disc text-xs text-ink-soft">{used.map((u, i) => <li key={i}>{u.label}</li>)}</ul> : <p className="text-xs text-ink-faint">{L('Not used anywhere yet.')}</p>}
          </div>
        </div>
        <div className="space-y-4">
          {err && <Alert kind="error">{err}</Alert>}
          <Input label={L('Title')} value={v.title} maxLength={160} onChange={(e) => setV({ ...v, title: e.target.value })} />
          <Input label={L('Category')} value={v.category} maxLength={40} hint={L('e.g. campus, events, sports')} onChange={(e) => setV({ ...v, category: e.target.value.toLowerCase().replace(/[^a-z0-9 _-]/g, '') })} />
          <LangTabs languages={['en', 'ur']} value={lang} onChange={setLang} defaultLang="en" />
          <EditLang.Provider value={{ lang, defaultLang: 'en' }}>
            {v.kind === 'image' && <L10nInput label={L('Default alt text')} value={v.alt} onChange={(alt) => setV({ ...v, alt })} max={300} />}
            <L10nInput label={L('Caption')} value={v.caption} onChange={(caption) => setV({ ...v, caption })} max={300} />
          </EditLang.Provider>
          <div className="flex flex-wrap gap-2 border-t border-surface-line pt-4">
            {canDelete && (v.provider === 'local' || v.provider === 'cloudinary') && <><Button variant="secondary" disabled={busy} onClick={() => file.current?.click()}><RefreshCw className="h-4 w-4" />{L('Replace file')}</Button><input ref={file} type="file" hidden accept={v.kind === 'image' ? IMAGE_TYPES.join(',') : VIDEO_TYPES.join(',')} onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void replace(fl); e.target.value = ''; }} /></>}
            <Button variant="secondary" disabled={busy} onClick={() => run(async () => { const m = await patch<MediaDoc>(`/api/website/media/${media._id}`, { archived: !v.archivedAt }); await onChanged(m); })}><Archive className="h-4 w-4" />{v.archivedAt ? L('Restore from archive') : L('Archive')}</Button>
            {canDelete && <Button variant="danger" disabled={busy || used.length > 0} title={used.length ? L('Still used on the website') : undefined} onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />{L('Delete')}</Button>}
          </div>
          {progress !== null && <div className="h-1.5 overflow-hidden rounded bg-surface-line"><div className="h-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          {used.length > 0 && <p className="text-xs text-ink-faint">{L('This file is used on the website, so it cannot be deleted. Replacing it updates every place that uses it.')}</p>}
        </div>
      </div>
      <ConfirmDialog open={confirm} danger title={L('Delete this file?')} message={L('The file is removed from the library permanently.')} loading={busy} onCancel={() => setConfirm(false)}
        onConfirm={() => run(async () => { await del(`/api/website/media/${media._id}`); setConfirm(false); await onChanged(null); onClose(); })} />
    </Modal>
  );
}

export default function MediaLibraryPage() {
  return <MediaLibrary />;
}
// `get` is re-exported for screens that only need the media config.
export const loadMediaConfig = () => get<MediaConfig>('/api/website/media/config');
