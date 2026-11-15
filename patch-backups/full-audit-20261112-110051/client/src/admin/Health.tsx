import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Settings2 } from 'lucide-react';
import type { ServiceStatus } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { Badge, Card, ErrorState, PageHeader, Spinner, STATUS_TONE, Table } from '../components/ui';
import { useConnectivity } from '../store/connectivity';
import { useOutbox } from '../sync/outbox';

interface HealthData { services: ServiceStatus[]; storage: Record<string, number | null | string>; workers: { name: string; everySeconds: number; lastRun: string | null; lastError: string | null; running: boolean }[]; lastBackup: { createdAt: string; fileName: string } | null }

const ICON = { ok: CheckCircle2, degraded: AlertTriangle, down: XCircle, not_configured: Settings2, disabled: MinusCircle };
const bytes = (n: unknown) => (typeof n === 'number' ? (n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`) : '—');

/** Every status here comes from a live check; nothing is shown green unless the check passed. */
export default function Health() {
  const t = useT(); const f = useFormat();
  const q = useGet<HealthData>('/api/system/health', { refetchInterval: 30_000 });
  const conn = useConnectivity(); const outbox = useOutbox();
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t('navHealth')} subtitle={q.data.fromCache ? t('cachedDataNotice', { time: f.dateTime(new Date(q.data.fromCache.savedAt)) }) : undefined} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d.services.map((s) => { const I = ICON[s.state]; return (
          <div key={s.name} className="card flex gap-4 p-5">
            <I className={`h-6 w-6 shrink-0 ${s.state === 'ok' ? 'text-emerald-600' : s.state === 'down' ? 'text-red-600' : s.state === 'disabled' ? 'text-ink-faint' : 'text-amber-500'}`} />
            <div className="min-w-0"><div className="flex items-center gap-2"><p className="font-semibold capitalize">{s.name}</p><Badge color={STATUS_TONE[s.state]}>{s.state.replace('_', ' ')}</Badge></div><p className="mt-1 break-words text-sm text-ink-soft">{s.detail}</p><p className="mt-1 text-xs text-ink-faint">{f.dateTime(s.checkedAt)}</p></div>
          </div>
        ); })}
        <div className="card flex gap-4 p-5">
          {conn.serverReachable && conn.browserOnline ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-amber-500" />}
          <div><p className="font-semibold">This device</p><p className="text-sm text-ink-soft">{conn.browserOnline ? t('online') : t('offline')} · {t('pendingSync', { n: outbox.pending })}{outbox.needsAttention ? ` · ${outbox.needsAttention} ${t('needsAttention')}` : ''}</p></div>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('storage')}>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[['Data', d.storage.dataSizeBytes], ['On disk', d.storage.storageSizeBytes], ['Indexes', d.storage.indexSizeBytes], ['Backups', d.storage.backupBytes], ['Free disk', d.storage.diskFreeBytes]].map(([k, v]) => <div key={String(k)}><dt className="text-ink-faint">{k}</dt><dd className="num font-medium">{bytes(v)}</dd></div>)}
          </dl>
          {typeof d.storage.note === 'string' && <p className="mt-3 text-xs text-ink-faint">{d.storage.note}</p>}
        </Card>
        <Card title={t('backgroundJobs')} padded={false}>
          <Table><tbody>{d.workers.map((w) => <tr key={w.name}><td className="font-mono text-xs">{w.name}</td><td className="text-xs">every {w.everySeconds}s</td><td className="text-xs">{w.lastRun ? f.dateTime(w.lastRun) : t('never')}</td><td>{w.lastError ? <Badge color="red" >{w.lastError.slice(0, 40)}</Badge> : <Badge color="green">ok</Badge>}</td></tr>)}</tbody></Table>
        </Card>
      </div>
    </div>
  );
}
