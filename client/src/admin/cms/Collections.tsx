import { useState } from 'react';
import { ExternalLink, Plus, Star } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DETAIL_PREFIXES, ITEM_DATA, ITEM_DETAIL_TYPES, pickL10n, type ItemType } from '@sms/shared';
import { useGet } from '../../hooks/useApi';
import { useFormat } from '../../i18n';
import { useAuth } from '../../store/auth';
import { del, patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Select, Spinner, errorMessage } from '../../components/ui';
import { EditLang, useL, type ItemDoc, type SiteDoc } from './api';
import { ITEM_DEFS } from './defs';
import { FormFields, LangTabs, MediaThumb, SortableList } from './fields';

type Draft = { _id?: string; version?: number; slug?: string; status: ItemDoc['status']; featured: boolean; group: string; data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Manager for one content collection (news, events, faculty, …): list, drag to reorder, create,
 * edit per language, publish / unpublish, feature, delete. Only "Published" entries are public.
 */
export function CollectionManager({ type, group, embedded }: { type: ItemType; group?: string; embedded?: boolean }) {
  const L = useL(); const f = useFormat(); const qc = useQueryClient();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const def = ITEM_DEFS[type];
  const site = useGet<SiteDoc>('/api/website/site');
  const list = useGet<ItemDoc[]>(`/api/website/items?type=${type}`);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [lang, setLang] = useState('en');
  const [removing, setRemoving] = useState<ItemDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const languages = site.data?.data.draft.languages.enabled ?? ['en'];
  const defaultLang = site.data?.data.draft.languages.default ?? 'en';
  const refresh = () => qc.invalidateQueries({ predicate: (x) => ['/api/website/items', '/api/website/overview', '/api/website/translations'].some((k) => String(x.queryKey[0] ?? '').startsWith(k)) });
  const run = async (fn: () => Promise<unknown>, okText?: string) => { setBusy(true); setMsg(null); try { await fn(); await refresh(); if (okText) setMsg({ kind: 'success', text: okText }); return true; } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, L('Something went wrong')) }); return false; } finally { setBusy(false); } };
  const all = list.data?.data ?? [];
  const rows = group ? all.filter((i) => i.group === group) : all;
  const body = (d: Draft) => ({ type, slug: d.slug || undefined, status: d.status, featured: d.featured, group: d.group, data: d.data, version: d.version });
  const save = (d: Draft) => run(() => (d._id ? patch(`/api/website/items/${d._id}`, body(d)) : post('/api/website/items', body(d))), L('Saved', 'محفوظ ہو گیا')).then((ok) => { if (ok) setEdit(null); });
  const titleOf = (i: { data: Record<string, any> }) => pickL10n(i.data.title, defaultLang, defaultLang) || '—'; // eslint-disable-line @typescript-eslint/no-explicit-any
  const blank = (): Draft => ({ status: 'draft', featured: false, group: group ?? '', data: ITEM_DATA[type].parse({}) as Record<string, unknown> });

  const content = (
    <>
      {msg && <div className="mb-3 px-5 pt-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {list.isLoading ? <Spinner /> : !rows.length ? <EmptyState title={L('Nothing here yet')}>{L('Add the first entry. It stays a draft until you publish it.')}</EmptyState> : (
        <div className="p-3">
          <SortableList orderOnly items={rows.map((r) => ({ ...r, id: r._id }))} onChange={(next) => { if (next.length === rows.length) void run(() => post('/api/website/items/reorder', { ids: next.map((n) => n._id) })); }}
            title={(r) => (
              <span className="flex items-center gap-3">
                <MediaThumb media={r.data.image} className="h-9 w-12 shrink-0 rounded" />
                <span className="truncate">{titleOf(r)}</span>
                {r.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" aria-label={L('Featured')} />}
                {r.group && <span className="hidden text-xs font-normal text-ink-faint sm:inline">{r.group}</span>}
              </span>
            )}
            extraActions={(r) => <>
              {r.status === 'published' ? <Badge color="green">{L('Published', 'شائع شدہ')}</Badge> : <Badge>{L('Draft', 'مسودہ')}</Badge>}
              <button type="button" className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft" onClick={() => setEdit({ _id: r._id, version: r.version, slug: r.slug, status: r.status, featured: r.featured, group: r.group, data: structuredClone(r.data) })}>{L('Edit', 'ترمیم')}</button>
            </>}
            render={(r) => (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                <span>{L('Updated')} {f.dateTime(r.updatedAt)}</span>
                <span className="flex flex-wrap gap-2">
                  {r.status === 'published' && ITEM_DETAIL_TYPES.includes(type) && <a className="btn-ghost" href={`/site/${DETAIL_PREFIXES[type as keyof typeof DETAIL_PREFIXES]}/${r.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{L('View')}</a>}
                  {canPublish && <Button variant="secondary" disabled={busy} onClick={() => void run(() => patch(`/api/website/items/${r._id}`, { type, status: r.status === 'published' ? 'draft' : 'published', featured: r.featured, group: r.group, data: r.data, version: r.version }))}>{r.status === 'published' ? L('Unpublish') : L('Publish')}</Button>}
                  {canPublish && <Button variant="ghost" onClick={() => setRemoving(r)}>{L('Delete')}</Button>}
                </span>
              </div>
            )} />
          <p className="mt-3 text-xs text-ink-faint">{L('Drag entries to set their order on the website. News is ordered by date; events by start time.')}</p>
        </div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} wide title={`${edit?._id ? L('Edit') : L('New')} ${def.singular}`} footer={<>
        <Button variant="secondary" onClick={() => setEdit(null)}>{L('Cancel')}</Button>
        <Button variant="secondary" loading={busy} disabled={edit?.status === 'published' && !canPublish} onClick={() => edit && void save({ ...edit, status: edit.status === 'published' ? 'published' : 'draft' })}>{edit?.status === 'published' ? L('Save changes') : L('Save draft')}</Button>
        {canPublish && edit?.status !== 'published' && <Button loading={busy} onClick={() => edit && void save({ ...edit, status: 'published' })}>{L('Save and publish')}</Button>}
      </>}>
        {edit && (
          <EditLang.Provider value={{ lang: languages.includes(lang) ? lang : defaultLang, defaultLang }}>
            <div className="space-y-4">
              {msg?.kind === 'error' && <Alert kind="error">{msg.text}</Alert>}
              <LangTabs languages={languages} value={languages.includes(lang) ? lang : defaultLang} onChange={setLang} defaultLang={defaultLang} />
              <FormFields fields={def.fields} value={edit.data} onChange={(data) => setEdit({ ...edit, data })} />
              <div className="grid gap-4 border-t border-surface-line pt-4 sm:grid-cols-2">
                {def.groups.length > 0 && <Select label={L('Group')} value={edit.group} placeholder={L('None')} options={def.groups.map((g) => ({ value: g, label: g[0]!.toUpperCase() + g.slice(1) }))} onChange={(e) => setEdit({ ...edit, group: e.target.value })} />}
                {ITEM_DETAIL_TYPES.includes(type) && edit._id && <Input label={L('Address')} dir="ltr" value={edit.slug ?? ''} onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') })} hint={`/site/${DETAIL_PREFIXES[type as keyof typeof DETAIL_PREFIXES]}/${edit.slug ?? ''}`} />}
                <div className="self-end pb-2"><Checkbox label={L('Featured')} checked={edit.featured} onChange={(v) => setEdit({ ...edit, featured: v })} /></div>
              </div>
            </div>
          </EditLang.Provider>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(removing)} danger title={L('Delete')} message={<>{L('Delete this entry? It disappears from the website.')} <strong>{removing ? titleOf(removing) : ''}</strong></>} loading={busy}
        onCancel={() => setRemoving(null)} onConfirm={() => void run(() => del(`/api/website/items/${removing!._id}`)).then(() => setRemoving(null))} />
    </>
  );
  const add = <Button onClick={() => { setMsg(null); setEdit(blank()); }}><Plus className="h-4 w-4" />{L('Add')} {def.singular}</Button>;
  return <Card title={embedded ? `${def.label}${group ? ` — ${group}` : ''}` : def.label} actions={add} padded={false}>{content}</Card>;
}
