import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Copy, ExternalLink, FileText, Globe, Image as ImageIcon, Inbox, Languages, PencilLine, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ITEM_TYPES, WEBSITE_LANGUAGE_NAMES, pickL10n, slugify, type ItemType, type PublicConfig } from '@sms/shared';
import { useGet, usePaged } from '../../hooks/useApi';
import { useFormat, useT } from '../../i18n';
import { useAuth } from '../../store/auth';
import { del, get, patch, post, put } from '../../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, StatCard, Table, Tabs, Textarea, errorMessage } from '../../components/ui';
import { useL, type DomainInfo, type Overview, type PageSummary, type Revision, type SiteDoc } from './api';
import { ITEM_DEFS } from './defs';
import { CollectionManager } from './Collections';
import { SortableList } from './fields';
import { SitePublishBar } from './SiteParts';

const invalidate = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/website') });

// ---------------------------------------------------------------------------- overview
export function OverviewPage() {
  const L = useL(); const f = useFormat();
  const o = useGet<Overview>('/api/website/overview');
  if (o.isLoading) return <Spinner />;
  const d = o.data?.data;
  if (!d) return <EmptyState title={L('Could not load the website overview')} />;
  return (
    <div className="space-y-6">
      <PageHeader title={L('Website Management', 'ویب سائٹ مینجمنٹ')} subtitle={L('Everything visitors see on the public school website is managed here.')} actions={<>
        <a className="btn-secondary" href="/site?preview=1" target="_blank" rel="noreferrer"><PencilLine className="h-4 w-4" />{L('Preview draft', 'مسودہ دیکھیں')}</a>
        {d.enabled && <a className="btn-primary" href="/site" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{L('View website', 'ویب سائٹ دیکھیں')}</a>}
      </>} />
      {!d.enabled && <Alert kind="warning" title={L('The website is switched off')}>{L('Visitors cannot open it yet. You can prepare and preview everything, then switch it on in')} <Link className="font-medium underline" to="/admin/website/settings">{L('Website settings')}</Link>.</Alert>}
      {d.site.dirty && <Alert kind="info">{L('Site-wide settings (navigation, theme, contact…) have saved changes that are not published yet.')} <Link className="font-medium underline" to="/admin/website/publishing">{L('Review and publish')}</Link></Alert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={L('Published pages')} value={f.num(d.pages.published)} hint={`${f.num(d.pages.drafts)} ${L('drafts')} · ${f.num(d.pages.total)} ${L('total')}`} icon={<FileText className="h-5 w-5" />} tone="green" />
        <StatCard label={L('Pages with unpublished changes')} value={f.num(d.pages.unpublishedChanges)} hint={d.pages.scheduled ? `${f.num(d.pages.scheduled)} ${L('scheduled')}` : undefined} icon={<PencilLine className="h-5 w-5" />} tone={d.pages.unpublishedChanges ? 'amber' : 'gray'} />
        <StatCard label={L('Media files')} value={f.num(d.media)} hint={d.cloudinary ? L('Cloudinary connected') : L('Stored on the school server')} icon={<ImageIcon className="h-5 w-5" />} tone="blue" />
        <StatCard label={L('New inquiries')} value={f.num(d.newInquiries)} icon={<Inbox className="h-5 w-5" />} tone={d.newInquiries ? 'violet' : 'gray'} />
      </div>
      <Card title={L('Content')} padded={false}>
        <Table><thead><tr><th>{L('Collection')}</th><th>{L('Published')}</th><th>{L('Total')}</th><th /></tr></thead><tbody>
          {ITEM_TYPES.map((t) => <tr key={t}><td className="font-medium">{ITEM_DEFS[t].label}</td><td className="num">{f.num(d.items[t]?.published ?? 0)}</td><td className="num">{f.num(d.items[t]?.total ?? 0)}</td><td className="text-end"><Link className="text-sm font-medium text-brand hover:underline" to={`/admin/website/${COLLECTION_ROUTE[t]}`}>{L('Manage')}</Link></td></tr>)}
        </tbody></Table>
      </Card>
      <Card title={L('Public address')}><p className="flex flex-wrap items-center gap-3 text-sm"><Globe className="h-4 w-4 text-brand" /><span dir="ltr" className="font-medium">{d.publicUrl}</span>{d.site.publishedAt && <span className="text-ink-soft">{L('Site settings last published')} {f.dateTime(d.site.publishedAt)}</span>}</p></Card>
    </div>
  );
}
export const COLLECTION_ROUTE: Record<ItemType, string> = { news: 'news', event: 'news', faculty: 'faculty', testimonial: 'testimonials', faq: 'faqs', program: 'academics', facility: 'campus', activity: 'student-life', achievement: 'student-life', album: 'gallery' };

// ---------------------------------------------------------------------------- pages
export function PagesPage() {
  const L = useL(); const f = useFormat(); const qc = useQueryClient(); const nav = useNavigate();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const pages = useGet<PageSummary[]>('/api/website/pages');
  const [create, setCreate] = useState<{ title: string; slug: string; touched: boolean } | null>(null);
  const [removing, setRemoving] = useState<PageSummary | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText?: string) => { setBusy(true); setMsg(null); try { const r = await fn(); await invalidate(qc); if (okText) setMsg({ kind: 'success', text: okText }); return r; } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, L('Something went wrong')) }); return null; } finally { setBusy(false); } };
  if (pages.isLoading) return <Spinner />;
  const rows = pages.data?.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title={L('Pages', 'صفحات')} subtitle={L('Open a page to edit its sections in the page builder. Drag to change the order.')} actions={<Button onClick={() => setCreate({ title: '', slug: '', touched: false })}><Plus className="h-4 w-4" />{L('New page', 'نیا صفحہ')}</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <SortableList orderOnly items={rows.map((p) => ({ ...p, id: p._id }))} onChange={(next) => { if (next.length === rows.length) void run(() => post('/api/website/pages/reorder', { ids: next.map((n) => n._id) })); }}
        title={(p) => <span className="flex min-w-0 items-center gap-3"><span className="truncate">{pickL10n(p.title, 'en') || p.slug}</span><span dir="ltr" className="hidden truncate text-xs font-normal text-ink-faint sm:inline">/site{p.slug === 'home' ? '' : `/${p.slug}`}</span></span>}
        extraActions={(p) => <>
          {p.status === 'published' ? <Badge color="green">{L('Published', 'شائع شدہ')}</Badge> : <Badge>{L('Draft', 'مسودہ')}</Badge>}
          {p.status === 'published' && p.dirty && <Badge color="amber">{L('Changes not published')}</Badge>}
          {p.scheduledAt && <Badge color="violet">{L('Scheduled')}</Badge>}
          <Link className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft" to={`/admin/website/builder/${p._id}`}>{L('Edit', 'ترمیم')}</Link>
        </>}
        render={(p) => (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
            <span>{p.sections} {L('sections')} · {L('updated')} {f.dateTime(p.updatedAt)}{p.system ? ` · ${L('built-in page')}` : ''}</span>
            <span className="flex flex-wrap gap-2">
              <a className="btn-ghost" href={`/site${p.slug === 'home' ? '' : `/${p.slug}`}?preview=1`} target="_blank" rel="noreferrer">{L('Preview draft')}</a>
              {canPublish && (p.status !== 'published' || p.dirty) && <Button variant="secondary" disabled={busy} onClick={() => void run(() => post(`/api/website/pages/${p._id}/publish`), L('Published'))}>{L('Publish')}</Button>}
              {canPublish && p.status === 'published' && p.slug !== 'home' && <Button variant="secondary" disabled={busy} onClick={() => void run(() => post(`/api/website/pages/${p._id}/unpublish`), L('Unpublished'))}>{L('Unpublish')}</Button>}
              <Button variant="secondary" disabled={busy} onClick={() => void run(() => post(`/api/website/pages/${p._id}/duplicate`), L('Duplicated as a draft'))}><Copy className="h-4 w-4" />{L('Duplicate')}</Button>
              {canPublish && !p.system && <Button variant="ghost" onClick={() => setRemoving(p)}>{L('Delete')}</Button>}
            </span>
          </div>
        )} />
      <Modal open={Boolean(create)} onClose={() => setCreate(null)} title={L('New page')} footer={<><Button variant="secondary" onClick={() => setCreate(null)}>{L('Cancel')}</Button><Button loading={busy} disabled={!create?.title.trim() || !create.slug} onClick={async () => { const p = await run(() => post<PageSummary>('/api/website/pages', { slug: create!.slug, title: { en: create!.title.trim() } })) as PageSummary | null; if (p) { setCreate(null); nav(`/admin/website/builder/${p._id}`); } }}>{L('Create and open')}</Button></>}>
        {create && <div className="space-y-4">
          {msg?.kind === 'error' && <Alert kind="error">{msg.text}</Alert>}
          <Input label={L('Page title')} value={create.title} maxLength={160} onChange={(e) => setCreate({ ...create, title: e.target.value, slug: create.touched ? create.slug : slugify(e.target.value) })} />
          <Input label={L('Address')} dir="ltr" value={create.slug} hint={`/site/${create.slug}`} onChange={(e) => setCreate({ ...create, touched: true, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') })} />
        </div>}
      </Modal>
      <ConfirmDialog open={Boolean(removing)} danger title={L('Delete page')} message={<>{L('The page is removed from the website and archived. This cannot be undone from the dashboard.')} <strong>{removing ? pickL10n(removing.title, 'en') : ''}</strong></>} loading={busy} onCancel={() => setRemoving(null)} onConfirm={() => void run(() => del(`/api/website/pages/${removing!._id}`)).then(() => setRemoving(null))} />
    </div>
  );
}

/** Shortcut list of the pages that belong to a topic, each opening in the page builder. */
export function PageLinks({ slugs }: { slugs: string[] }) {
  const L = useL();
  const pages = useGet<PageSummary[]>('/api/website/pages');
  const rows = slugs.map((s) => pages.data?.data.find((p) => p.slug === s)).filter((p): p is PageSummary => Boolean(p));
  if (!rows.length) return null;
  return (
    <Card title={L('Pages', 'صفحات')} padded={false}>
      <ul className="divide-y divide-surface-line">
        {rows.map((p) => (
          <li key={p._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="font-medium">{pickL10n(p.title, 'en')} <span dir="ltr" className="ms-2 text-xs font-normal text-ink-faint">/site/{p.slug}</span></span>
            <span className="flex items-center gap-2">{p.status === 'published' ? <Badge color="green">{L('Published')}</Badge> : <Badge>{L('Draft')}</Badge>}{p.status === 'published' && p.dirty && <Badge color="amber">{L('Changes not published')}</Badge>}<Link className="btn-secondary" to={`/admin/website/builder/${p._id}`}>{L('Edit page')}</Link></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A topic area of the CMS: its pages plus the content collections that feed them. */
export function Hub({ title, subtitle, pages, collections, children }: { title: string; subtitle?: string; pages?: string[]; collections?: { type: ItemType; group?: string }[]; children?: ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={subtitle} />
      {pages && <PageLinks slugs={pages} />}
      {collections?.map((c) => <CollectionManager key={`${c.type}-${c.group ?? ''}`} type={c.type} group={c.group} embedded />)}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------- inquiries
interface Inquiry { _id: string; kind: 'contact' | 'admission'; name: string; phone?: string; email?: string; grade?: string; message?: string; status: 'new' | 'read' | 'closed'; createdAt: string }
export function Inquiries({ kind }: { kind?: 'contact' | 'admission' }) {
  const L = useL(); const f = useFormat(); const qc = useQueryClient();
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1);
  const list = usePaged<Inquiry>(`/api/website/inquiries?page=${page}${status ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}`);
  const setState = async (i: Inquiry, s: Inquiry['status']) => { await patch(`/api/website/inquiries/${i._id}`, { status: s }); await invalidate(qc); };
  return (
    <Card title={kind === 'admission' ? L('Admission inquiries') : L('Messages from the website')} actions={<Select aria-label={L('Status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: '', label: L('All') }, { value: 'new', label: L('New') }, { value: 'read', label: L('Read') }, { value: 'closed', label: L('Closed') }]} />} padded={false}>
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState title={L('No messages')}>{L('Messages sent from the contact and admission forms on the website appear here.')}</EmptyState> : (
        <>
          <ul className="divide-y divide-surface-line">
            {list.data.items.map((i) => (
              <li key={i._id} className="space-y-2 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{i.name} <Badge color={i.kind === 'admission' ? 'violet' : 'blue'}>{i.kind}</Badge> {i.status === 'new' ? <Badge color="amber">{L('New')}</Badge> : i.status === 'closed' ? <Badge color="gray">{L('Closed')}</Badge> : <Badge color="green">{L('Read')}</Badge>}</p>
                  <span className="text-xs text-ink-faint">{f.dateTime(i.createdAt)}</span>
                </div>
                <p className="flex flex-wrap gap-x-5 gap-y-1 text-ink-soft">{i.phone && <a className="num text-brand" href={`tel:${i.phone}`}>{i.phone}</a>}{i.email && <a className="text-brand" href={`mailto:${i.email}`} dir="ltr">{i.email}</a>}{i.grade && <span>{L('Class')}: {i.grade}</span>}</p>
                {i.message && <p className="whitespace-pre-line" dir="auto">{i.message}</p>}
                <div className="flex gap-2">{i.status === 'new' && <Button variant="secondary" onClick={() => void setState(i, 'read')}>{L('Mark as read')}</Button>}{i.status !== 'closed' ? <Button variant="ghost" onClick={() => void setState(i, 'closed')}>{L('Close')}</Button> : <Button variant="ghost" onClick={() => void setState(i, 'new')}>{L('Reopen')}</Button>}</div>
              </li>
            ))}
          </ul>
          {list.data.meta.total > list.data.meta.pageSize && <Pagination page={page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------- announcements (existing feature, unchanged API)
interface Ann { _id: string; title: string; body: string; publishedAt: string | null; pinned: boolean }
export function Announcements() {
  const t = useT(); const f = useFormat(); const qc = useQueryClient();
  const anns = useGet<Ann[]>('/api/settings/announcements');
  const [edit, setEdit] = useState<Partial<Ann> | null>(null); const [removing, setRemoving] = useState<Ann | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { setBusy(true); try { await fn(); await qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/settings') }); setMsg({ kind: 'success', text: t('saved') }); after?.(); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } finally { setBusy(false); } };
  return (
    <Card title={t('announcements')} actions={<Button onClick={() => setEdit({ title: '', body: '', pinned: false })}><Plus className="h-4 w-4" />{t('addAnnouncement')}</Button>} padded={false}>
      {msg && <div className="px-5 pt-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {!anns.data?.data.length ? <EmptyState /> : <Table><tbody>{anns.data.data.map((a) => (
        <tr key={a._id}><td className="font-medium">{a.title} {a.pinned && <Badge color="violet">{t('pinned')}</Badge>}</td><td>{a.publishedAt ? <Badge color="green">{t('published')} {f.date(a.publishedAt)}</Badge> : <Badge>{t('draft')}</Badge>}</td>
          <td className="whitespace-nowrap text-end">
            <Button variant="ghost" onClick={() => void run(() => patch(`/api/settings/announcements/${a._id}`, { publishedAt: a.publishedAt ? null : new Date().toISOString() }))}>{a.publishedAt ? t('unpublish') : t('publish')}</Button>
            <Button variant="ghost" onClick={() => setEdit(a)}>{t('edit')}</Button>
            <Button variant="ghost" onClick={() => setRemoving(a)}>{t('delete')}</Button>
          </td></tr>
      ))}</tbody></Table>}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?._id ? t('edit') : t('addAnnouncement')} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('cancel')}</Button><Button disabled={!edit?.title || !edit.body} loading={busy} onClick={() => void run(() => (edit!._id ? patch(`/api/settings/announcements/${edit!._id}`, { title: edit!.title, body: edit!.body, pinned: edit!.pinned }) : post('/api/settings/announcements', { title: edit!.title, body: edit!.body, pinned: edit!.pinned })), () => setEdit(null))}>{t('save')}</Button></>}>
        {edit && <div className="space-y-4"><Input label={t('title')} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /><Textarea label={t('body')} rows={6} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /><Checkbox label={t('pinned')} checked={Boolean(edit.pinned)} onChange={(x) => setEdit({ ...edit, pinned: x })} /></div>}
      </Modal>
      <ConfirmDialog open={Boolean(removing)} danger title={t('delete')} message={<>{t('deleteAnnouncementConfirm')} <strong>{removing?.title}</strong></>} loading={busy} onCancel={() => setRemoving(null)} onConfirm={() => void run(() => del(`/api/settings/announcements/${removing!._id}`), () => setRemoving(null))} />
    </Card>
  );
}

export function NewsEventsPage() {
  const L = useL();
  const [tab, setTab] = useState<'news' | 'event' | 'ann'>('news');
  return (
    <div className="space-y-5">
      <PageHeader title={L('News & events', 'خبریں اور تقریبات')} subtitle={L('Articles and events have their own pages on the website. Announcements are the short notice board.')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'news', label: L('News & articles') }, { value: 'event', label: L('Events') }, { value: 'ann', label: L('Announcements') }]} />
      {tab === 'ann' ? <Announcements /> : <CollectionManager type={tab} />}
      <PageLinks slugs={['news', 'events']} />
    </div>
  );
}

// ---------------------------------------------------------------------------- website settings (existing switches)
interface Web { enabled: boolean; showContact: boolean; showAnnouncements: boolean }
export function SettingsCard() {
  const t = useT(); const L = useL(); const qc = useQueryClient();
  const s = useGet<{ website: Web }>('/api/settings');
  const [v, setV] = useState<Web | null>(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { if (s.data && !v) setV(s.data.data.website); }, [s.data, v]);
  if (!v) return <Spinner />;
  const save = async () => {
    setBusy(true);
    try { await patch('/api/settings/website', { enabled: v.enabled, showAnnouncements: v.showAnnouncements }); useAuth.getState().setConfig(await get<PublicConfig>('/api/public/config')); await qc.invalidateQueries({ predicate: (x) => ['/api/settings', '/api/website/overview'].some((k) => String(x.queryKey[0] ?? '').startsWith(k)) }); setMsg({ kind: 'success', text: t('saved') }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } finally { setBusy(false); }
  };
  return (
    <Card title={L('Website switch')}>
      <div className="space-y-4">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Checkbox label={t('websiteEnabled')} checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} />
        <p className="text-xs text-ink-faint">{L('While this is off, /site shows "not available" to visitors and search engines are told not to index it. Editors can still preview drafts.')}</p>
        <Checkbox label={t('showAnnouncements')} checked={v.showAnnouncements} onChange={(x) => setV({ ...v, showAnnouncements: x })} />
        <div><Button loading={busy} onClick={() => void save()}>{t('save')}</Button></div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const L = useL();
  return (
    <div className="space-y-5">
      <PageHeader title={L('Website settings', 'ویب سائٹ کی ترتیبات')} />
      <SettingsCard />
      <Card title={L('Where things are')}><ul className="list-inside list-disc space-y-1 text-sm text-ink-soft">
        <li>{L('School name, logo and favicon: Settings → School profile.')}</li>
        <li>{L('Who may edit or publish the website: Staff & users → permissions "website.manage" and "website.publish".')}</li>
        <li>{L('Cloudinary: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the server environment. Without them, uploads are stored on the school server.')}</li>
      </ul></Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- domain & publishing
export function PublishingPage() {
  const L = useL(); const f = useFormat(); const qc = useQueryClient();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const site = useGet<SiteDoc>('/api/website/site');
  const [domain, setDomain] = useState(''); const [info, setInfo] = useState<DomainInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const s = site.data?.data;
  useEffect(() => { if (s) { setInfo(s.domain); setDomain(s.domain?.domain ?? ''); } }, [s?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (site.isLoading || !s) return <Spinner />;
  const run = async (name: string, fn: () => Promise<{ domain: DomainInfo | null }>) => { setBusy(name); setMsg(null); try { const r = await fn(); setInfo(r.domain); await site.refetch(); if (name === 'verify') setMsg(r.domain?.status === 'verified' ? { kind: 'success', text: L('Domain verified.') } : { kind: 'error', text: r.domain?.lastError ?? L('Not verified yet') }); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, 'Failed') }); } finally { setBusy(null); } };
  const txtName = info?.txtName ?? (info ? `_school-site.${info.domain}` : ''); const txtValue = info?.txtValue ?? (info ? `school-site-verification=${info.token}` : '');
  const appHost = (() => { try { return new URL(s.appUrl).hostname; } catch { return s.appUrl; } })();
  return (
    <div className="space-y-5">
      <PageHeader title={L('Domain & publishing', 'ڈومین اور اشاعت')} actions={<a className="btn-secondary" href="/site" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{L('View website', 'ویب سائٹ دیکھیں')}</a>} />
      <SitePublishBar site={s} onChanged={async () => { await site.refetch(); await invalidate(qc); }} />
      <SettingsCard />
      <Card title={L('Public address')}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-soft">{L('Website address in use')}</dt><dd dir="ltr" className="font-medium">{s.canonicalBase}/site</dd></div>
          <div><dt className="text-ink-soft">{L('Server address (APP_URL)')}</dt><dd dir="ltr">{s.appUrl}</dd></div>
          <div><dt className="text-ink-soft">HTTPS</dt><dd>{s.canonicalBase.startsWith('https://') ? <Badge color="green">{L('Address uses HTTPS')}</Badge> : <Badge color="amber">{L('Not HTTPS (fine on a local network; required for a public website)')}</Badge>}</dd></div>
        </dl>
      </Card>
      <Card title={L('Custom domain')}>
        <div className="space-y-4">
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div className="flex flex-wrap items-end gap-3">
            <Input className="min-w-[16rem] flex-1" label={L('Domain name')} dir="ltr" placeholder="www.yourschool.edu" value={domain} disabled={!canPublish} onChange={(e) => setDomain(e.target.value)} />
            {canPublish && <Button loading={busy === 'set'} disabled={!domain.trim() || domain.trim() === info?.domain} onClick={() => run('set', () => put('/api/website/domain', { domain }))}>{L('Save domain')}</Button>}
            {canPublish && info && <Button variant="ghost" onClick={() => run('remove', () => put('/api/website/domain', { domain: '' })).then(() => setDomain(''))}>{L('Remove')}</Button>}
          </div>
          {info && (
            <div className="space-y-4 rounded-xl border border-surface-line p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2"><span className="font-medium" dir="ltr">{info.domain}</span>{info.status === 'verified' ? <Badge color="green"><CheckCircle2 className="h-3 w-3" />{L('Verified')}</Badge> : info.status === 'failed' ? <Badge color="red">{L('Not verified')}</Badge> : <Badge color="amber">{L('Waiting for verification')}</Badge>}{info.checkedAt && <span className="text-xs text-ink-faint">{L('checked')} {f.dateTime(info.checkedAt)}</span>}</p>
              <ol className="list-inside list-decimal space-y-3 text-ink-soft">
                <li>{L('Prove you own the domain: at your DNS provider add this TXT record.')}<div className="mt-2 grid gap-1 rounded-lg bg-surface-muted p-3 font-mono text-xs" dir="ltr"><span>Type: TXT</span><span>Name: {txtName}</span><span className="break-all">Value: {txtValue}</span></div></li>
                <li>{L('Point the domain at this server: add a CNAME record to')} <code dir="ltr">{appHost}</code> {L('(or an A record to the server’s IP address).')}</li>
                <li>{L('Enable HTTPS for the domain on your hosting platform or reverse proxy, and add the domain to CORS_ORIGINS in the server environment.')}</li>
                <li>{L('Click Verify. Once verified, the domain is used for canonical links, the sitemap and social sharing.')}</li>
              </ol>
              {canPublish && <Button variant="secondary" loading={busy === 'verify'} onClick={() => run('verify', () => post('/api/website/domain/verify'))}>{L('Verify now')}</Button>}
              <p className="text-xs text-ink-faint">{L('This screen checks ownership only. DNS records and SSL certificates are not created automatically: they are set up at your DNS provider and host. See docs/website/website-cms.md.')}</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- revisions & translations
export function RevisionsPage() {
  const L = useL(); const f = useFormat(); const qc = useQueryClient(); const nav = useNavigate();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const [scope, setScope] = useState<'' | 'page' | 'site'>('');
  const revs = useGet<Revision[]>(`/api/website/revisions${scope ? `?scope=${scope}` : ''}`);
  const [busy, setBusy] = useState<string | null>(null); const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const restore = async (r: Revision) => {
    setBusy(r._id); setMsg(null);
    try { await post(`/api/website/revisions/${r._id}/restore`); await invalidate(qc); if (r.scope === 'page' && r.pageId) nav(`/admin/website/builder/${r.pageId}`); else setMsg({ kind: 'success', text: L('Restored into the draft site settings. Review, then publish.') }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e, 'Restore failed') }); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-5">
      <PageHeader title={L('Revision history', 'ترمیمی تاریخ')} subtitle={L('A version is stored every time a page or the site settings are published. Restoring copies a version into the draft; nothing changes publicly until you publish.')} actions={<Select aria-label={L('Show')} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} options={[{ value: '', label: L('Everything') }, { value: 'page', label: L('Pages') }, { value: 'site', label: L('Site settings') }]} />} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card padded={false}>
        {revs.isLoading ? <Spinner /> : !revs.data?.data.length ? <EmptyState title={L('No versions yet')} /> : (
          <Table><thead><tr><th>{L('When')}</th><th>{L('What')}</th><th>{L('Action')}</th><th>{L('By')}</th><th /></tr></thead><tbody>
            {revs.data.data.map((r) => (
              <tr key={r._id}><td className="whitespace-nowrap">{f.dateTime(r.createdAt)}</td><td>{r.scope === 'site' ? L('Site settings') : <>{r.title || r.pageSlug} <span dir="ltr" className="text-xs text-ink-faint">/{r.pageSlug}</span></>}</td><td><Badge color={r.action === 'publish' ? 'green' : r.action === 'restore' ? 'violet' : 'gray'}>{r.action}</Badge></td><td>{r.createdByName}</td>
                <td className="text-end">{canPublish && <Button variant="secondary" loading={busy === r._id} onClick={() => void restore(r)}>{L('Restore into draft')}</Button>}</td></tr>
            ))}
          </tbody></Table>
        )}
      </Card>
    </div>
  );
}

interface TrRow { kind: string; id: string; label: string; status: string; total: number; missing: number }
export function TranslationReport() {
  const L = useL();
  const t = useGet<{ default: string; enabled: string[]; report: { lang: string; total: number; missing: number; rows: TrRow[] }[] }>('/api/website/translations');
  if (t.isLoading) return <Spinner />;
  const d = t.data?.data;
  if (!d || !d.report.length) return <Card title={L('Translation status')}><p className="text-sm text-ink-soft">{L('Only one language is enabled, so there is nothing to translate.')}</p></Card>;
  return (
    <>
      {d.report.map((r) => {
        const pct = r.total ? Math.round(((r.total - r.missing) / r.total) * 100) : 100;
        const todo = r.rows.filter((x) => x.missing > 0);
        return (
          <Card key={r.lang} title={<span className="flex items-center gap-2"><Languages className="h-4 w-4" />{WEBSITE_LANGUAGE_NAMES[r.lang] ?? r.lang}: {pct}% {L('translated')}</span>} padded={false}>
            <div className="px-5 py-4"><div className="h-2 overflow-hidden rounded bg-surface-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div><p className="mt-2 text-xs text-ink-soft">{r.total - r.missing} / {r.total} {L('text fields have a translation. Untranslated fields show the default-language text on the website.')}</p></div>
            {todo.length > 0 && <Table><thead><tr><th>{L('Needs translation')}</th><th>{L('Type')}</th><th>{L('Missing')}</th><th /></tr></thead><tbody>
              {todo.slice(0, 100).map((x) => <tr key={`${x.kind}-${x.id}`}><td className="font-medium">{x.label}</td><td>{x.kind}</td><td className="num">{x.missing} / {x.total}</td><td className="text-end">{x.kind === 'page' ? <Link className="text-sm font-medium text-brand hover:underline" to={`/admin/website/builder/${x.id}`}>{L('Open')}</Link> : x.kind === 'site' ? <Link className="text-sm font-medium text-brand hover:underline" to="/admin/website/navigation">{L('Open')}</Link> : (ITEM_TYPES as readonly string[]).includes(x.kind) ? <Link className="text-sm font-medium text-brand hover:underline" to={`/admin/website/${COLLECTION_ROUTE[x.kind as ItemType]}`}>{L('Open')}</Link> : null}</td></tr>)}
            </tbody></Table>}
          </Card>
        );
      })}
    </>
  );
}
