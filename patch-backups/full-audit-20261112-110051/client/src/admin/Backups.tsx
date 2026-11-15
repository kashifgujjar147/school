import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, ShieldCheck, RotateCcw } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { useAuth } from '../store/auth';
import { downloadFile, patch, post } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, PageHeader, Spinner, STATUS_TONE, Table, errorMessage } from '../components/ui';

interface Backup { _id: string; fileName: string; sizeBytes?: number; kind: string; status: string; createdAt: string; verifiedAt?: string; error?: string; collections?: { name: string; count: number }[] }

export default function Backups() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const list = useGet<Backup[]>('/api/backups');
  const settings = useGet<{ backupSchedule: { enabled: boolean; hour: number; keepLast: number } }>('/api/settings');
  const [sched, setSched] = useState<{ enabled: boolean; hour: number; keepLast: number } | null>(null);
  useEffect(() => { if (settings.data && !sched) setSched(settings.data.data.backupSchedule); }, [settings.data, sched]);
  const [restore, setRestore] = useState<Backup | null>(null); const [phrase, setPhrase] = useState(''); const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/backups', '/api/settings', '/api/system/health']);
  const run = (fn: () => Promise<unknown>, ok: string, after?: () => void) => act.mutate(fn, { onSuccess: () => { setMsg({ kind: 'success', text: ok }); after?.(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  return (
    <div className="space-y-6">
      <PageHeader title={t('backups')} actions={<Button loading={act.isPending} onClick={() => run(() => post('/api/backups'), t('saved'))}><DatabaseBackup className="h-4 w-4" />{t('createBackup')}</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {sched && <Card title={t('schedule')}>
        <div className="flex flex-wrap items-end gap-4">
          <Checkbox label={t('active')} checked={sched.enabled} onChange={(v) => setSched({ ...sched, enabled: v })} />
          <Input type="number" min={0} max={23} label={t('dailyAt')} value={sched.hour} onChange={(e) => setSched({ ...sched, hour: Number(e.target.value) })} className="w-32" />
          <Input type="number" min={1} max={365} label={t('keepLast')} value={sched.keepLast} onChange={(e) => setSched({ ...sched, keepLast: Number(e.target.value) })} className="w-32" />
          <Button variant="secondary" onClick={() => run(() => patch('/api/settings/backup-schedule', sched), t('saved'))}>{t('save')}</Button>
        </div>
        <p className="mt-3 text-xs text-ink-faint">Backups are written to the server's backup folder and verified (checksum + record counts). Copy them off the server regularly — see docs/installation/backup-and-recovery.md.</p>
      </Card>}
      <Card padded={false}>
        {list.isLoading ? <Spinner /> : !list.data?.data.length ? <EmptyState>No backups yet. Create the first one now.</EmptyState> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>Type</th><th>{t('status')}</th><th>Size</th><th>Records</th><th /></tr></thead>
            <tbody>{list.data.data.map((b) => (
              <tr key={b._id}>
                <td className="text-xs">{f.dateTime(b.createdAt)}<span className="block font-mono text-[11px] text-ink-faint">{b.fileName}</span></td><td><Badge>{b.kind}</Badge></td>
                <td><Badge color={STATUS_TONE[b.status]}>{b.status}</Badge>{b.error && <p className="text-xs text-red-700">{b.error}</p>}</td>
                <td className="num text-xs">{b.sizeBytes ? `${(b.sizeBytes / 1e6).toFixed(2)} MB` : '—'}</td>
                <td className="num text-xs">{b.collections?.reduce((a, c) => a + c.count, 0) ?? '—'}</td>
                <td className="whitespace-nowrap text-end">
                  {['completed', 'verified', 'verify_failed'].includes(b.status) && <>
                    <Button variant="ghost" title={t('verify')} onClick={() => run(() => post(`/api/backups/${b._id}/verify`), t('verify'))}><ShieldCheck className="h-4 w-4" /></Button>
                    <Button variant="ghost" title={t('download')} onClick={() => downloadFile(`/api/backups/${b._id}/download`, b.fileName)}><Download className="h-4 w-4" /></Button>
                    {can('backups.restore') && b.status === 'verified' && <Button variant="ghost" title={t('restoreBackup')} onClick={() => { setRestore(b); setPhrase(''); setPw(''); }}><RotateCcw className="h-4 w-4" /></Button>}
                  </>}
                </td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <ConfirmDialog open={Boolean(restore)} danger title={t('restoreBackup')} confirmLabel={t('restoreBackup')} loading={act.isPending} message={<Alert kind="warning">{t('restoreWarning')}</Alert>}
        onCancel={() => setRestore(null)}
        onConfirm={() => { if (phrase !== 'RESTORE' || !pw) return; act.mutate(() => post('/api/backups/restore', { backupId: restore!._id, confirmPhrase: phrase, password: pw }), { onSuccess: () => { window.location.href = '/login'; }, onError: (e) => { setRestore(null); setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } }); }}>
        <p className="font-mono text-xs">{restore?.fileName}</p>
        <Input label={t('typeRestore')} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        <Input type="password" label={t('yourPassword')} value={pw} onChange={(e) => setPw(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
