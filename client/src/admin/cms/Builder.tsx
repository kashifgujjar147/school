import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, CalendarClock, ExternalLink, Eye, EyeOff, History, Monitor, Plus, Settings2, Smartphone, Tablet, Undo2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SECTION_BACKGROUNDS, SECTION_CONTENT, SECTION_SPACING, pickL10n, sitePath, stableEqual, type PageContent, type Section } from '@sms/shared';
import { useGet } from '../../hooks/useApi';
import { useFormat } from '../../i18n';
import { useAuth } from '../../store/auth';
import { patch, post } from '../../services/api';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Input, Modal, Select, Spinner, ErrorState, errorMessage } from '../../components/ui';
import { EditLang, newId, useL, type PageDoc, type PageSummary, type Revision, type SiteDoc } from './api';
import { SECTION_DEFS, SECTION_TEMPLATES } from './defs';
import { FormFields, L10nInput, LangTabs, MediaField, SortableList } from './fields';

const DEVICES = { desktop: { w: 1366, icon: Monitor, label: 'Desktop' }, tablet: { w: 820, icon: Tablet, label: 'Tablet' }, mobile: { w: 390, icon: Smartphone, label: 'Mobile' } } as const;

/**
 * Page builder. The left column edits the page (sections, order, visibility, settings); the right
 * column is a live preview of the real public renderer in an iframe, fed with the unsaved content.
 * Nothing here is local-only: "Save draft" writes to the database, "Publish" makes it public.
 */
export default function Builder({ fixedSlug, only }: { fixedSlug?: string; only?: 'hero' }) {
  const L = useL(); const f = useFormat(); const nav = useNavigate(); const qc = useQueryClient();
  const params = useParams();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const pages = useGet<PageSummary[]>('/api/website/pages');
  const site = useGet<SiteDoc>('/api/website/site');
  const pageId = fixedSlug ? pages.data?.data.find((p) => p.slug === fixedSlug)?._id : params.id;
  const doc = useGet<PageDoc>(pageId ? `/api/website/pages/${pageId}` : null);

  const [content, setContent] = useState<PageContent | null>(null);
  const [slug, setSlug] = useState('');
  const [saved, setSaved] = useState<{ content: PageContent; slug: string; version: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'sections' | 'settings'>('sections');
  const [lang, setLang] = useState('en');
  const [device, setDevice] = useState<keyof typeof DEVICES>('desktop');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [schedule, setSchedule] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const hasStage = Boolean(content);
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [hasStage]);

  const languages = site.data?.data.draft.languages.enabled ?? ['en'];
  const defaultLang = site.data?.data.draft.languages.default ?? 'en';
  useEffect(() => { if (!languages.includes(lang)) setLang(defaultLang); }, [languages.join(','), defaultLang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load (or reload after another page is chosen). Local edits are replaced only when the server copy is newer.
  const d = doc.data?.data;
  useEffect(() => {
    if (!d) return;
    if (saved && saved.version === d.version && content) return;
    setContent(d.draft); setSlug(d.slug); setSaved({ content: d.draft, slug: d.slug, version: d.version });
    if (only === 'hero') setSelected(d.draft.sections.find((s) => s.type === 'hero')?.id ?? null);
  }, [d?._id, d?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(content && saved && (!stableEqual(content, saved.content) || slug !== saved.slug));
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Live preview: send the current (unsaved) content to the preview frame, debounced.
  const send = useCallback(() => { if (content && frameReady.current) frame.current?.contentWindow?.postMessage({ type: 'sms-cms-preview', content }, window.location.origin); }, [content]);
  useEffect(() => { const t = setTimeout(send, 450); return () => clearTimeout(t); }, [send]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === window.location.origin && e.source === frame.current?.contentWindow && (e.data as { type?: string })?.type === 'sms-cms-preview-ready') { frameReady.current = true; send(); } };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [send]);

  const previewSrc = useMemo(() => `${sitePath('/', lang, defaultLang)}?preview=live`, [lang, defaultLang]);
  useEffect(() => { frameReady.current = false; }, [previewSrc]);

  if (pages.isLoading || site.isLoading || (pageId && doc.isLoading) || (pageId && !content && !doc.isError)) return <Spinner />;
  if (!pageId || doc.isError || !d || !content) return <ErrorState error={doc.error ?? new Error('Page not found')} onRetry={() => void doc.refetch()} />;

  const scale = Math.min(1, (stageSize.w - 24) / DEVICES[device].w);
  const sections = content.sections;
  const update = (next: Partial<PageContent>) => setContent({ ...content, ...next });
  const updateSection = (s: Section) => update({ sections: sections.map((x) => (x.id === s.id ? s : x)) });
  const sel = sections.find((s) => s.id === selected) ?? null;

  const act = async (name: string, fn: () => Promise<void>, okText?: string) => {
    setBusy(name); setMsg(null);
    try { await fn(); if (okText) setMsg({ kind: 'success', text: okText }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e, L('Something went wrong')) }); }
    finally { setBusy(null); }
  };
  const apply = (p: PageDoc) => {
    setContent(p.draft); setSlug(p.slug); setSaved({ content: p.draft, slug: p.slug, version: p.version });
    qc.setQueryData([`/api/website/pages/${p._id}`], (old: unknown) => (old ? { ...(old as object), data: p } : old));
    void qc.invalidateQueries({ predicate: (x) => ['/api/website/pages', '/api/website/overview', '/api/website/revisions', '/api/website/translations'].some((k) => String(x.queryKey[0] ?? '').startsWith(k)) });
  };
  const saveDraft = async () => apply(await patch<PageDoc>(`/api/website/pages/${d._id}`, { content, slug: slug !== saved!.slug ? slug : undefined, version: saved!.version }));
  const publish = () => act('publish', async () => { if (dirty) await saveDraft(); await post(`/api/website/pages/${d._id}/publish`); await doc.refetch(); }, L('Published. The page is now live.', 'شائع ہو گیا۔'));
  const addSection = (tpl: (typeof SECTION_TEMPLATES)[number]) => {
    const id = `${tpl.type}-${newId()}`;
    const s = { id, type: tpl.type, visible: true, background: (tpl.background ?? 'default') as Section['background'], spacing: 'normal' as const, anchor: null, content: SECTION_CONTENT[tpl.type].parse(tpl.content ?? {}) as Record<string, unknown> };
    update({ sections: [...sections, s] }); setSelected(id); setAdding(false);
  };
  const publicPath = sitePath(d.slug === 'home' ? '/' : `/${d.slug}`, lang, defaultLang);
  const title = pickL10n(content.title, lang, defaultLang) || d.slug;

  return (
    <EditLang.Provider value={{ lang, defaultLang }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {!fixedSlug && <Link to="/admin/website/pages" className="btn-ghost !px-2" aria-label={L('Back to pages')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Link>}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">{only === 'hero' ? L('Hero & banners', 'ہیرو اور بینر') : title}</h1>
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <span dir="ltr">/site{d.slug === 'home' ? '' : `/${d.slug}`}</span>
                {d.status === 'published' ? <Badge color="green">{L('Published', 'شائع شدہ')}</Badge> : <Badge>{L('Draft', 'مسودہ')}</Badge>}
                {dirty ? <Badge color="amber">{L('Unsaved changes', 'غیر محفوظ تبدیلیاں')}</Badge> : d.dirty && d.status === 'published' ? <Badge color="blue">{L('Saved draft differs from the live page')}</Badge> : null}
                {d.scheduledAt && <Badge color="violet">{L('Scheduled')}: {f.dateTime(d.scheduledAt)}</Badge>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LangTabs languages={languages} value={lang} onChange={setLang} defaultLang={defaultLang} />
            <Button variant="secondary" loading={busy === 'save'} disabled={!dirty || Boolean(busy)} onClick={() => act('save', saveDraft, L('Draft saved', 'مسودہ محفوظ ہو گیا'))}>{L('Save draft', 'مسودہ محفوظ کریں')}</Button>
            <a className={clsx('btn-secondary', dirty && 'pointer-events-none opacity-50')} href={`${publicPath}?preview=1`} target="_blank" rel="noreferrer" title={dirty ? L('Save the draft first') : undefined}><Eye className="h-4 w-4" />{L('Preview draft', 'مسودہ دیکھیں')}</a>
            {canPublish && <Button loading={busy === 'publish'} disabled={Boolean(busy) || (!dirty && !d.dirty && d.status === 'published')} onClick={publish}>{L('Publish', 'شائع کریں')}</Button>}
          </div>
        </div>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

        {/* Editor and live preview are separate panels: stacked below xl, side by side from xl. Each panel scrolls
            inside itself and is its own stacking context, so neither can paint over the other. */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)]">
          <div className="card isolate flex max-h-[75vh] min-h-0 min-w-0 flex-col overflow-hidden xl:sticky xl:top-20 xl:max-h-[calc(100vh-11rem)]">
            {sel ? (
              <>
                <div className="flex items-center gap-2 border-b border-surface-line px-3 py-2.5">
                  {only !== 'hero' && <button type="button" className="btn-ghost !px-2" onClick={() => setSelected(null)} aria-label={L('Back to sections')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></button>}
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{SECTION_DEFS[sel.type].label}</p><p className="truncate text-xs text-ink-faint">{SECTION_DEFS[sel.type].about}</p></div>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
                  <FormFields fields={SECTION_DEFS[sel.type].fields} value={sel.content} onChange={(c) => updateSection({ ...sel, content: c })} />
                  {sel.type !== 'hero' && sel.type !== 'pageHeader' && (
                    <fieldset className="space-y-3 rounded-xl border border-surface-line p-3">
                      <legend className="px-1 text-sm font-medium">{L('Layout')}</legend>
                      <Select label={L('Background')} value={sel.background} options={SECTION_BACKGROUNDS.map((b) => ({ value: b, label: { default: 'Page background', muted: 'Soft tint', dark: 'Dark', brand: 'Brand colour' }[b] }))} onChange={(e) => updateSection({ ...sel, background: e.target.value as Section['background'] })} />
                      <Select label={L('Spacing')} value={sel.spacing} options={SECTION_SPACING.map((b) => ({ value: b, label: b[0]!.toUpperCase() + b.slice(1) }))} onChange={(e) => updateSection({ ...sel, spacing: e.target.value as Section['spacing'] })} />
                      <Input label={L('Anchor (optional)')} dir="ltr" value={sel.anchor ?? ''} placeholder="admissions" hint={L('Lets a button jump here: /page#anchor')} onChange={(e) => updateSection({ ...sel, anchor: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '') || null })} />
                    </fieldset>
                  )}
                  <Checkbox label={L('Visible on the website')} checked={sel.visible} onChange={(v) => updateSection({ ...sel, visible: v })} />
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-1 border-b border-surface-line p-2" role="tablist">
                  <button type="button" role="tab" aria-selected={panel === 'sections'} onClick={() => setPanel('sections')} className={clsx('flex-1 rounded-lg px-3 py-2 text-sm font-medium', panel === 'sections' ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted')}>{L('Sections', 'حصے')} ({sections.length})</button>
                  <button type="button" role="tab" aria-selected={panel === 'settings'} onClick={() => setPanel('settings')} className={clsx('flex-1 rounded-lg px-3 py-2 text-sm font-medium', panel === 'settings' ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted')}><Settings2 className="me-1 inline h-4 w-4" />{L('Page & SEO', 'صفحہ اور SEO')}</button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                  {panel === 'sections' ? (
                    <div className="space-y-3">
                      <SortableList items={sections} onChange={(s) => update({ sections: s })} max={40}
                        title={(s) => { const c = s.content as { heading?: Record<string, string>; itemType?: string; slides?: unknown[] }; const head = pickL10n(c.heading, lang, defaultLang); return <span className={clsx('block min-w-0 leading-tight', !s.visible && 'text-ink-faint line-through')}><span className="block truncate">{head || SECTION_DEFS[s.type]?.label || s.type}</span><span className="block truncate text-[11px] font-normal text-ink-faint">{SECTION_DEFS[s.type]?.label ?? s.type}{c.itemType ? ` · ${c.itemType}` : ''}{c.slides ? ` · ${c.slides.length} slides` : ''}</span></span>; }}
                        extraActions={(s) => <>
                          <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted" onClick={() => updateSection({ ...s, visible: !s.visible })} aria-label={s.visible ? L('Hide section') : L('Show section')} aria-pressed={!s.visible}>{s.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
                          <button type="button" className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft" onClick={() => setSelected(s.id)}>{L('Edit', 'ترمیم')}</button>
                        </>}
                        render={(s) => <div className="flex items-center justify-between gap-3 text-xs text-ink-soft"><span>{SECTION_DEFS[s.type]?.about}</span><Button variant="secondary" onClick={() => setSelected(s.id)}>{L('Edit content')}</Button></div>} />
                      <Button variant="secondary" className="w-full" disabled={sections.length >= 40} onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{L('Add section', 'حصہ شامل کریں')}</Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <L10nInput label={L('Page title')} value={content.title} onChange={(t) => update({ title: t })} max={160} />
                      <Input label={L('Address')} dir="ltr" value={slug} disabled={d.system} hint={d.system ? L('Built-in pages keep their address.') : `/site/${slug}`} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))} />
                      <fieldset className="space-y-4 rounded-xl border border-surface-line p-3">
                        <legend className="px-1 text-sm font-medium">{L('Search engines & sharing')}</legend>
                        <L10nInput label={L('SEO title (optional)')} value={content.seo.title} onChange={(t) => update({ seo: { ...content.seo, title: t } })} max={160} hint={L('Defaults to the page title.')} />
                        <L10nInput label={L('Meta description')} value={content.seo.description} onChange={(t) => update({ seo: { ...content.seo, description: t } })} multiline max={320} hint={L('One or two sentences shown in search results.')} />
                        <MediaField label={L('Social sharing image')} kind="image" value={content.seo.ogImage} onChange={(m) => update({ seo: { ...content.seo, ogImage: m ? { ...m, alt: m.alt ?? {} } : null } })} />
                        <Checkbox label={L('Hide this page from search engines')} checked={content.seo.noindex} onChange={(v) => update({ seo: { ...content.seo, noindex: v } })} />
                      </fieldset>
                      <div className="flex flex-wrap gap-2 border-t border-surface-line pt-4">
                        <Button variant="secondary" onClick={() => setHistory(true)}><History className="h-4 w-4" />{L('Revision history')}</Button>
                        {canPublish && <Button variant="secondary" onClick={() => setSchedule(d.scheduledAt ? new Date(new Date(d.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')}><CalendarClock className="h-4 w-4" />{L('Schedule publishing')}</Button>}
                        {d.hasPublished && <Button variant="secondary" onClick={() => setConfirmDiscard(true)}><Undo2 className="h-4 w-4" />{L('Discard draft changes')}</Button>}
                        {canPublish && d.status === 'published' && d.slug !== 'home' && <Button variant="secondary" loading={busy === 'unpublish'} onClick={() => act('unpublish', async () => { await post(`/api/website/pages/${d._id}/unpublish`); await doc.refetch(); await pages.refetch(); }, L('Unpublished. Visitors can no longer open this page.'))}>{L('Unpublish')}</Button>}
                        {d.status === 'published' && <a className="btn-secondary" href={publicPath} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{L('View live page')}</a>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="card relative isolate min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-line px-3 py-2">
              <p className="text-xs text-ink-soft">{L('Live preview of your unsaved changes', 'غیر محفوظ تبدیلیوں کا براہ راست پیش منظر')}</p>
              <div className="flex gap-1" role="group" aria-label={L('Preview size')}>
                {(Object.keys(DEVICES) as (keyof typeof DEVICES)[]).map((k) => { const I = DEVICES[k].icon; return <button key={k} type="button" aria-pressed={device === k} aria-label={DEVICES[k].label} title={DEVICES[k].label} onClick={() => setDevice(k)} className={clsx('rounded-lg p-2', device === k ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted')}><I className="h-4 w-4" /></button>; })}
              </div>
            </div>
            {/* The frame always renders at the real device width and is scaled down to fit, so "Desktop" shows the desktop layout. */}
            <div ref={stage} className="relative h-[70vh] min-h-[24rem] overflow-hidden bg-slate-200/70 xl:h-[calc(100vh-15rem)] xl:min-h-[32rem]">
              <iframe ref={frame} key={previewSrc} src={previewSrc} title={L('Page preview')} className="absolute start-1/2 top-3 origin-top border border-surface-line bg-white shadow-card"
                style={{ width: DEVICES[device].w, height: `${Math.max(200, (stageSize.h - 24) / scale)}px`, transform: `translateX(${document.documentElement.dir === 'rtl' ? '50%' : '-50%'}) scale(${scale})` }} />
            </div>
          </div>
        </div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title={L('Add a section')} wide>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTION_TEMPLATES.map((tpl) => (
            <button key={tpl.label} type="button" onClick={() => addSection(tpl)} className="rounded-xl border border-surface-line p-4 text-start transition hover:border-brand hover:shadow-card">
              <span className="block text-sm font-semibold">{tpl.label}</span><span className="mt-1 block text-xs text-ink-soft">{SECTION_DEFS[tpl.type].about}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={schedule !== null} onClose={() => setSchedule(null)} title={L('Schedule publishing')} footer={<>
        {d.scheduledAt && <Button variant="secondary" onClick={() => act('schedule', async () => { await post(`/api/website/pages/${d._id}/schedule`, { at: null }); setSchedule(null); await doc.refetch(); }, L('Schedule cleared'))}>{L('Clear schedule')}</Button>}
        <Button disabled={!schedule || dirty} loading={busy === 'schedule'} onClick={() => act('schedule', async () => { await post(`/api/website/pages/${d._id}/schedule`, { at: new Date(schedule!).toISOString() }); setSchedule(null); await doc.refetch(); }, L('Scheduled. The saved draft will be published automatically.'))}>{L('Schedule')}</Button>
      </>}>
        <div className="space-y-3">
          {dirty && <Alert kind="warning">{L('Save the draft first: the schedule publishes the saved draft.')}</Alert>}
          <Input type="datetime-local" label={L('Publish the saved draft at')} value={schedule ?? ''} onChange={(e) => setSchedule(e.target.value)} />
          <p className="text-xs text-ink-faint">{L('The server checks once a minute. It must be running at that time.')}</p>
        </div>
      </Modal>

      {history && <RevisionList pageId={d._id} canRestore={canPublish} onClose={() => setHistory(false)} onRestored={async () => { setSaved(null); await doc.refetch(); setHistory(false); setMsg({ kind: 'success', text: L('Restored into the draft. Review it, then publish.') }); }} />}

      <ConfirmDialog open={confirmDiscard} danger title={L('Discard draft changes?')} message={L('The draft goes back to the version that is live now. Unsaved and saved draft edits are lost.')} loading={busy === 'discard'} onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => act('discard', async () => { apply(await post<PageDoc>(`/api/website/pages/${d._id}/discard`)); setConfirmDiscard(false); nav('.', { replace: true }); }, L('Draft reset to the live version'))} />
    </EditLang.Provider>
  );
}

export function RevisionList({ pageId, scope = 'page', onClose, onRestored, canRestore }: { pageId?: string; scope?: 'page' | 'site'; onClose: () => void; onRestored: () => Promise<void> | void; canRestore: boolean }) {
  const L = useL(); const f = useFormat();
  const revs = useGet<Revision[]>(`/api/website/revisions?scope=${scope}${pageId ? `&pageId=${pageId}` : ''}`);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState('');
  return (
    <Modal open onClose={onClose} title={L('Revision history', 'ترمیمی تاریخ')} wide>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {revs.isLoading ? <Spinner /> : !revs.data?.data.length ? <p className="py-6 text-center text-sm text-ink-soft">{L('No versions yet. A version is saved every time you publish.')}</p> : (
        <ul className="divide-y divide-surface-line">
          {revs.data.data.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-medium">{f.dateTime(r.createdAt)} <Badge color={r.action === 'publish' ? 'green' : r.action === 'restore' ? 'violet' : 'gray'}>{r.action}</Badge></p><p className="text-xs text-ink-soft">{r.createdByName}{r.pageSlug ? ` · /${r.pageSlug}` : ''}</p></div>
              {canRestore && <Button variant="secondary" loading={busy === r._id} onClick={async () => { setBusy(r._id); setErr(''); try { await post(`/api/website/revisions/${r._id}/restore`); await onRestored(); } catch (e) { setErr(errorMessage(e, 'Restore failed')); } finally { setBusy(null); } }}>{L('Restore into draft')}</Button>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-ink-faint">{L('Restoring copies that version into the draft. The live website changes only when you publish.')}</p>
    </Modal>
  );
}
