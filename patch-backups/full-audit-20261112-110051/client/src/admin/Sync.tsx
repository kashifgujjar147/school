import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { useAuth } from '../store/auth';
import { post } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, StatCard, STATUS_TONE, Table, Textarea, errorMessage } from '../components/ui';

interface SyncData {
  enabled: boolean; mode: string; nodeId: string;
  status: { state: string; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; pending: number; failed: number; conflicts: number; dead: number; lastPushed: number; lastPulled: number };
  operations: { _id: string; collectionName: string; docId: string; kind: string; status: string; attempts: number; lastError?: string; createdAt: string }[];
  conflicts: { _id: string; direction: string; collectionName: string; docId: string; reason: string; localVersion: Record<string, unknown> | null; remoteVersion: Record<string, unknown> | null; createdAt: string }[];
}

const HIDE = new Set(['_id', 'createdAt', 'updatedAt', 'updatedByNode', 'passwordHash']);
function diffKeys(a: Record<string, unknown> | null, b: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => !HIDE.has(k)).sort().map((k) => ({ k, a: a?.[k], b: b?.[k], differs: JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]) }));
}

/** Administrator view of hybrid synchronisation: pending/failed operations and conflict resolution. */
export default function SyncPage() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const q = useGet<SyncData>('/api/system/sync', { refetchInterval: 15_000 });
  const [open, setOpen] = useState<SyncData['conflicts'][number] | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/system']);
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) => act.mutate(fn, { onSuccess: () => { setMsg({ kind: 'success', text: ok }); after?.(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return null;
  const d = q.data.data;
  if (!d.enabled) return <div><PageHeader title={t('navSync')} /><Card><EmptyState title={d.mode}>{d.mode === 'cloud' ? t('syncDisabledCloud') : t('syncDisabledLocal')}</EmptyState></Card></div>;
  const st = d.status;
  return (
    <div className="space-y-6">
      <PageHeader title={t('navSync')} subtitle={`${t('local')}: ${d.nodeId} ⇄ ${t('cloud')}`} actions={can('sync.manage') && <>
        <Button variant="secondary" onClick={() => run(() => post('/api/system/sync/retry-failed'), t('saved'))}>{t('retryFailed')}</Button>
        <Button loading={act.isPending} onClick={() => run(() => post('/api/system/sync/run'), t('syncNow'))}><RefreshCw className="h-4 w-4" />{t('syncNow')}</Button>
      </>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {st.lastError && <Alert kind={st.state === 'offline' ? 'warning' : 'error'}>{st.lastError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={t('syncStatus')} value={<Badge color={st.state === 'online' ? 'green' : st.state === 'offline' ? 'amber' : st.state === 'error' ? 'red' : 'blue'}>{st.state}</Badge>} hint={`${t('lastSuccess')}: ${st.lastSuccessAt ? f.dateTime(st.lastSuccessAt) : t('never')}`} />
        <StatCard label={t('pending')} value={st.pending} tone="blue" />
        <StatCard label={t('failed')} value={st.failed} tone={st.failed ? 'amber' : 'gray'} />
        <StatCard label={t('dead')} value={st.dead} tone={st.dead ? 'red' : 'gray'} />
        <StatCard label={t('conflicts')} value={st.conflicts} tone={st.conflicts ? 'red' : 'gray'} />
      </div>

      <Card title={t('conflicts')} padded={false}>
        {!d.conflicts.length ? <EmptyState title="✓" /> : <Table><thead><tr><th>{t('date')}</th><th>Collection</th><th>Record</th><th>{t('reason')}</th><th /></tr></thead>
          <tbody>{d.conflicts.map((c) => <tr key={c._id}><td className="text-xs">{f.dateTime(c.createdAt)}</td><td className="font-mono text-xs">{c.collectionName}</td><td className="font-mono text-xs">{c.docId.slice(0, 8)}</td><td className="max-w-sm text-xs">{c.reason}</td><td className="text-end">{can('sync.manage') && <Button variant="secondary" onClick={() => { setOpen(c); setNote(''); }}>{t('review')}</Button>}</td></tr>)}</tbody></Table>}
      </Card>

      <Card title={t('operations')} padded={false}>
        {!d.operations.length ? <EmptyState title={t('allSynced')} /> : <div className="max-h-96 overflow-y-auto"><Table><thead><tr><th>{t('date')}</th><th>Collection</th><th>{t('status')}</th><th>{t('attempts')}</th><th>{t('errors')}</th></tr></thead>
          <tbody>{d.operations.map((o) => <tr key={o._id}><td className="text-xs">{f.dateTime(o.createdAt)}</td><td className="font-mono text-xs">{o.collectionName}/{o.docId.slice(0, 8)}</td><td><Badge color={STATUS_TONE[o.status]}>{o.status}</Badge></td><td className="num">{o.attempts}</td><td className="max-w-sm truncate text-xs" title={o.lastError}>{o.lastError}</td></tr>)}</tbody></Table></div>}
      </Card>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} wide title={`${t('conflicts')} — ${open?.collectionName}`}
        footer={open && <>
          <Button variant="secondary" onClick={() => setOpen(null)}>{t('cancel')}</Button>
          <Button variant="secondary" loading={act.isPending} onClick={() => run(() => post(`/api/system/sync/conflicts/${open._id}/resolve`, { resolution: 'keep_remote', note }), t('saved'), () => setOpen(null))}>{t('keepRemote')}</Button>
          <Button loading={act.isPending} onClick={() => run(() => post(`/api/system/sync/conflicts/${open._id}/resolve`, { resolution: 'keep_local', note }), t('saved'), () => setOpen(null))}>{t('keepLocal')}</Button>
        </>}>
        {open && <div className="space-y-4">
          <Alert kind="info">{open.reason}. Both versions are preserved in the audit trail; the version you keep is written to both servers with a new version number.</Alert>
          <div className="max-h-[50vh] overflow-auto rounded-xl border border-surface-line">
            <Table><thead><tr><th>Field</th><th>{t('local')}</th><th>{t('cloud')}</th></tr></thead>
              <tbody>{diffKeys(open.localVersion, open.remoteVersion).map((r) => <tr key={r.k} className={r.differs ? 'bg-amber-50' : ''}><td className="font-mono text-xs">{r.k}</td><td className="break-all text-xs">{JSON.stringify(r.a) ?? '—'}</td><td className="break-all text-xs">{JSON.stringify(r.b) ?? '—'}</td></tr>)}</tbody></Table>
          </div>
          <Textarea label={t('notes')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>}
      </Modal>
    </div>
  );
}
