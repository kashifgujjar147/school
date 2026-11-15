import { useState } from 'react';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@sms/shared';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { isConnected } from '../store/connectivity';
import { NetworkError, post } from '../services/api';
import { discardOutboxItem, enqueue, flushOutbox, requeueOutboxItem } from '../sync/outbox';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Select, Spinner, STATUS_TONE, Table, Textarea } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { todayIso, useMyOutbox } from './common';

interface SheetRow { _id: string; date: string; classroomName: string; counts: Record<string, number>; source: string; submittedAt: string }
interface SheetDetail { sheet: SheetRow; records: { _id: string; studentId: string; status: AttendanceStatus; originalStatus: string; corrected: boolean; remark?: string; student?: { fullName: string; admissionNumber: string } }[] }

export default function TeacherHistory() {
  const t = useT(); const f = useFormat();
  const tz = useAuth((s) => s.config?.timeZone);
  const userId = useAuth((s) => s.user?.id)!;
  const to = todayIso(tz);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [toDate, setTo] = useState(to);
  const hist = useGet<SheetRow[]>(`/api/attendance/history?from=${from}&to=${toDate}`);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useGet<SheetDetail>(open ? `/api/attendance/sheets/${open}` : null);
  const [corr, setCorr] = useState<{ attendanceId: string; studentId: string; current: string; name: string } | null>(null);
  const [newStatus, setNewStatus] = useState<AttendanceStatus>('present');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [discard, setDiscard] = useState<string | null>(null);
  const outbox = useMyOutbox();

  const requestCorrection = useAction(async () => {
    const clientOpId = crypto.randomUUID();
    const body = { attendanceId: corr!.attendanceId, studentId: corr!.studentId, newStatus, reason, clientOpId };
    // A correction is only a REQUEST: queued offline it stays pending until the principal reviews it online.
    if (!isConnected()) { await enqueue({ id: clientOpId, userId, kind: 'attendance.correction', method: 'POST', url: '/api/attendance/corrections', body, label: `${t('requestCorrection')}: ${corr!.name}` }); return 'offline'; }
    try { await post('/api/attendance/corrections', body, { 'Idempotency-Key': clientOpId }); return 'online'; } catch (e) {
      if (e instanceof NetworkError) { await enqueue({ id: clientOpId, userId, kind: 'attendance.correction', method: 'POST', url: '/api/attendance/corrections', body, label: `${t('requestCorrection')}: ${corr!.name}` }); return 'offline'; }
      throw e;
    }
  }, ['/api/attendance']);

  const local = outbox.filter((o) => o.status !== 'synced' || (o.syncedAt ?? 0) > Date.now() - 86_400_000);

  return (
    <div className="space-y-6">
      <PageHeader title={t('navHistory')} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {local.length > 0 && (
        <Card title={t('savedOnDevice')} actions={<Button variant="secondary" onClick={() => void flushOutbox()}>{t('syncNow')}</Button>}>
          <ul className="divide-y divide-surface-line text-sm">
            {local.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p className="font-medium">{o.label}</p><p className="text-xs text-ink-faint">{f.dateTime(new Date(o.createdAt))}{o.lastError ? ` · ${o.lastError}` : ''}</p></div>
                <div className="flex items-center gap-2">
                  <Badge color={o.status === 'synced' ? 'green' : o.status === 'pending' || o.status === 'sending' ? 'blue' : 'red'}>{o.status === 'synced' ? t('allSynced') : o.status === 'pending' || o.status === 'sending' ? t('pending') : t('needsAttention')}</Badge>
                  {(o.status === 'failed' || o.status === 'conflict' || o.status === 'auth_required') && <Button variant="secondary" onClick={() => void requeueOutboxItem(o.id).then(() => flushOutbox())}>{t('retry')}</Button>}
                  {o.status !== 'synced' && o.status !== 'sending' && <Button variant="ghost" onClick={() => setDiscard(o.id)}>{t('delete')}</Button>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('submitted')} actions={<div className="flex gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('from')} /><Input type="date" value={toDate} max={to} onChange={(e) => setTo(e.target.value)} aria-label={t('to')} /></div>} padded={false}>
        <div className="px-5 pt-3"><CacheNotice fromCache={hist.data?.fromCache} /></div>
        {hist.isLoading ? <Spinner /> : !hist.data?.data.length ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('classroom')}</th><th>{t('present')}</th><th>{t('absent')}</th><th>{t('late')}</th><th>{t('leave')}</th><th>{t('source')}</th><th /></tr></thead>
            <tbody>{hist.data.data.map((s) => (
              <tr key={s._id}><td className="num">{f.date(s.date)}</td><td>{s.classroomName}</td><td className="num">{s.counts.present}</td><td className="num">{s.counts.absent}</td><td className="num">{s.counts.late}</td><td className="num">{s.counts.leave}</td><td><Badge>{s.source}</Badge></td><td className="text-end"><Button variant="ghost" onClick={() => setOpen(s._id)}>{t('viewSheet')}</Button></td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={detail.data ? `${detail.data.data.sheet.classroomName ?? ''} ${f.date(detail.data.data.sheet.date)}` : t('loading')} wide>
        {!detail.data ? <Spinner /> : (
          <ul className="divide-y divide-surface-line text-sm">
            {detail.data.data.records.map((r) => (
              <li key={r._id} className="flex items-center justify-between gap-3 py-2.5">
                <span>{r.student?.fullName}</span>
                <div className="flex items-center gap-2">
                  {r.corrected && <span className="text-xs text-ink-faint">{t('original')}: {t(r.originalStatus as TKey)}</span>}
                  <Badge color={STATUS_TONE[r.status]}>{t(r.status)}</Badge>
                  <Button variant="ghost" onClick={() => { setCorr({ attendanceId: r._id, studentId: r.studentId, current: r.status, name: r.student?.fullName ?? '' }); setNewStatus(r.status === 'present' ? 'absent' : 'present'); setReason(''); }}>{t('requestCorrection')}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={Boolean(corr)} onClose={() => setCorr(null)} title={`${t('requestCorrection')} — ${corr?.name}`}
        footer={<><Button variant="secondary" onClick={() => setCorr(null)}>{t('cancel')}</Button><Button loading={requestCorrection.isPending} disabled={reason.trim().length < 3 || newStatus === corr?.current} onClick={() => requestCorrection.mutate(undefined, {
          onSuccess: (mode) => { setCorr(null); setMsg({ kind: mode === 'online' ? 'success' : 'info', text: mode === 'online' ? t('correctionRequested') : t('submittedOffline') }); },
          onError: (e) => setMsg({ kind: 'error', text: (e as Error).message })
        })}>{t('submit')}</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">{t('original')}: <Badge color={STATUS_TONE[corr?.current ?? '']}>{corr ? t(corr.current as TKey) : ''}</Badge></p>
          <Select label={t('newStatus')} value={newStatus} onChange={(e) => setNewStatus(e.target.value as AttendanceStatus)} options={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: t(s) }))} />
          <Textarea label={t('reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(discard)} danger title={t('delete')} message="This unsent item will be permanently removed from this device. It has NOT been received by the school server." onCancel={() => setDiscard(null)} onConfirm={() => { void discardOutboxItem(discard!); setDiscard(null); }} />
    </div>
  );
}
