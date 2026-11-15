import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ExternalLink } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { del, patch, post } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Spinner, Table, Textarea, errorMessage } from '../components/ui';

interface Web { enabled: boolean; about?: string; heroTitle?: string; heroSubtitle?: string; showContact: boolean; showAnnouncements: boolean }
interface Ann { _id: string; title: string; body: string; publishedAt: string | null; pinned: boolean }

export default function WebsiteAdmin() {
  const t = useT(); const f = useFormat();
  const s = useGet<{ website: Web }>('/api/settings');
  const anns = useGet<Ann[]>('/api/settings/announcements');
  const [v, setV] = useState<Web | null>(null);
  const [edit, setEdit] = useState<Partial<Ann> | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => { if (s.data && !v) setV(s.data.data.website); }, [s.data, v]);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/settings']);
  const run = (fn: () => Promise<unknown>, after?: () => void) => act.mutate(fn, { onSuccess: () => { setMsg({ kind: 'success', text: t('saved') }); after?.(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  if (!v) return <Spinner />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('navWebsite')} actions={v.enabled && <Link to="/site" target="_blank" className="btn-secondary"><ExternalLink className="h-4 w-4" />/site</Link>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card>
        <div className="space-y-4">
          <Checkbox label={t('websiteEnabled')} checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} />
          <div className="grid gap-4 md:grid-cols-2"><Input label={t('heroTitle')} value={v.heroTitle ?? ''} onChange={(e) => setV({ ...v, heroTitle: e.target.value })} /><Input label={t('heroSubtitle')} value={v.heroSubtitle ?? ''} onChange={(e) => setV({ ...v, heroSubtitle: e.target.value })} /></div>
          <Textarea label={t('about')} rows={6} value={v.about ?? ''} onChange={(e) => setV({ ...v, about: e.target.value })} />
          <div className="flex gap-6"><Checkbox label={t('showContact')} checked={v.showContact} onChange={(x) => setV({ ...v, showContact: x })} /><Checkbox label={t('showAnnouncements')} checked={v.showAnnouncements} onChange={(x) => setV({ ...v, showAnnouncements: x })} /></div>
          <p className="text-xs text-ink-faint">School name, logo, address and contact details come from Settings → School profile.</p>
          <Button loading={act.isPending} onClick={() => run(() => patch('/api/settings/website', v))}>{t('save')}</Button>
        </div>
      </Card>
      <Card title={t('announcements')} actions={<Button onClick={() => setEdit({ title: '', body: '', pinned: false })}><Plus className="h-4 w-4" />{t('addAnnouncement')}</Button>} padded={false}>
        {!anns.data?.data.length ? <EmptyState /> : <Table><tbody>{anns.data.data.map((a) => (
          <tr key={a._id}><td className="font-medium">{a.title} {a.pinned && <Badge color="violet">{t('pinned')}</Badge>}</td><td>{a.publishedAt ? <Badge color="green">{t('published')} {f.date(a.publishedAt)}</Badge> : <Badge>{t('draft')}</Badge>}</td>
            <td className="whitespace-nowrap text-end">
              <Button variant="ghost" onClick={() => run(() => patch(`/api/settings/announcements/${a._id}`, { publishedAt: a.publishedAt ? null : new Date().toISOString() }))}>{a.publishedAt ? t('unpublish') : t('publish')}</Button>
              <Button variant="ghost" onClick={() => setEdit(a)}>{t('edit')}</Button>
              <Button variant="ghost" onClick={() => run(() => del(`/api/settings/announcements/${a._id}`))}>{t('delete')}</Button>
            </td></tr>
        ))}</tbody></Table>}
      </Card>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?._id ? t('edit') : t('addAnnouncement')} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('cancel')}</Button><Button disabled={!edit?.title || !edit.body} onClick={() => run(() => edit!._id ? patch(`/api/settings/announcements/${edit!._id}`, { title: edit!.title, body: edit!.body, pinned: edit!.pinned }) : post('/api/settings/announcements', { title: edit!.title, body: edit!.body, pinned: edit!.pinned }), () => setEdit(null))}>{t('save')}</Button></>}>
        {edit && <div className="space-y-4"><Input label={t('title')} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /><Textarea label={t('body')} rows={6} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /><Checkbox label={t('pinned')} checked={Boolean(edit.pinned)} onChange={(x) => setEdit({ ...edit, pinned: x })} /></div>}
      </Modal>
    </div>
  );
}
