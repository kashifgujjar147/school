import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCheck, ArrowLeft, Search, CloudOff, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUSES, countStatuses, type AttendanceStatus } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { useT, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { isConnected } from '../store/connectivity';
import { ApiError, NetworkError, post } from '../services/api';
import { db } from '../offline/db';
import { enqueue } from '../sync/outbox';
import { Alert, Badge, Button, Card, ErrorState, Input, Modal, PageHeader, Spinner } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { todayIso, useMyOutbox, type Roster } from './common';

type Marks = Record<string, { status: AttendanceStatus | null; remark?: string; arrivalTime?: string }>;

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white border-emerald-600',
  absent: 'bg-red-600 text-white border-red-600',
  late: 'bg-amber-500 text-white border-amber-500',
  leave: 'bg-sky-600 text-white border-sky-600'
};

export default function MarkAttendance() {
  const t = useT();
  const qc = useQueryClient();
  const { classroomId = '' } = useParams();
  const [params] = useSearchParams();
  const tz = useAuth((s) => s.config?.timeZone);
  const userId = useAuth((s) => s.user?.id)!;
  const [date, setDate] = useState(params.get('date') || todayIso(tz));
  const roster = useGet<Roster>(`/api/attendance/roster?classroomId=${classroomId}&date=${date}`);
  const outbox = useMyOutbox();
  const queued = outbox.find((o) => o.kind === 'attendance.submit' && o.body.classroomId === classroomId && o.body.date === date && o.status !== 'synced');
  const draftKey = `att:${userId}:${classroomId}:${date}`;

  const [marks, setMarks] = useState<Marks>({});
  const [filter, setFilter] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'online' | 'offline' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());

  // Restore an in-progress draft (survives refresh / app restart / device reboot).
  useEffect(() => {
    let alive = true;
    void db.drafts.get(draftKey).then((d) => { if (alive) setMarks((d?.value as Marks) ?? {}); });
    setResult(null); setError(null);
    return () => { alive = false; };
  }, [draftKey]);
  useEffect(() => {
    if (Object.keys(marks).length) void db.drafts.put({ key: draftKey, userId, value: marks, updatedAt: Date.now() });
  }, [marks, draftKey, userId]);

  const r = roster.data?.data;
  const students = useMemo(() => (r?.students ?? []).filter((s) => !filter || s.fullName.toLowerCase().includes(filter.toLowerCase()) || s.admissionNumber.toLowerCase().includes(filter.toLowerCase())), [r, filter]);
  const counts = countStatuses((r?.students ?? []).map((s) => marks[s._id]?.status).filter(Boolean) as AttendanceStatus[]);
  const unmarked = (r?.students.length ?? 0) - counts.total;

  if (roster.isLoading) return <Spinner />;
  if (roster.isError || !r) return <ErrorState error={roster.error} onRetry={() => roster.refetch()} />;

  const alreadySubmitted = Boolean(r.sheet);
  const setStatus = (id: string, status: AttendanceStatus) => {
    setMarks((m) => ({ ...m, [id]: { ...m[id], status } }));
    setHighlight((h) => { const n = new Set(h); n.delete(id); return n; });
  };
  const markAllPresent = () => setMarks((m) => Object.fromEntries(r.students.map((s) => [s._id, { ...m[s._id], status: m[s._id]?.status ?? 'present' }])));

  const submit = async () => {
    setBusy(true); setError(null);
    const clientOpId = crypto.randomUUID();
    const body = {
      classroomId, date, clientOpId, clientCreatedAt: new Date().toISOString(),
      entries: r.students.map((s) => ({ studentId: s._id, status: marks[s._id]!.status!, remark: marks[s._id]?.remark || null, arrivalTime: marks[s._id]?.status === 'late' ? marks[s._id]?.arrivalTime || null : null }))
    };
    const label = `${r.classroom.name} · ${date}`;
    const offlineQueue = async () => {
      await enqueue({ id: clientOpId, userId, kind: 'attendance.submit', method: 'POST', url: '/api/attendance/submit', body, label });
      await db.drafts.delete(draftKey);
      setResult({ kind: 'offline' }); setReviewing(false);
    };
    try {
      if (!isConnected() || useAuth.getState().offlineSession) { await offlineQueue(); return; }
      await post('/api/attendance/submit', body, { 'Idempotency-Key': clientOpId });
      await db.drafts.delete(draftKey);
      setResult({ kind: 'online' }); setReviewing(false);
      void qc.invalidateQueries();
    } catch (e) {
      if (e instanceof NetworkError) { await offlineQueue(); return; }
      if (e instanceof ApiError && e.code === 'ROSTER_CHANGED') {
        const d = e.details as { missing: string[] };
        setHighlight(new Set(d.missing)); setReviewing(false);
        await roster.refetch();
        setError(t('rosterChanged'));
      } else setError(e instanceof Error ? e.message : t('errorGeneric'));
    } finally { setBusy(false); }
  };

  return (
    <div className="pb-28">
      <Link to="/teacher" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('back')}</Link>
      <PageHeader title={`${t('markAttendance')} — ${r.classroom.name}`}
        actions={<Input type="date" value={date} max={todayIso(tz)} onChange={(e) => setDate(e.target.value)} aria-label={t('date')} />} />
      <CacheNotice fromCache={roster.data?.fromCache} />
      {result?.kind === 'online' && <div className="mb-4"><Alert kind="success">{t('submittedOnline')}</Alert></div>}
      {(result?.kind === 'offline' || (queued && (queued.status === 'pending' || queued.status === 'sending'))) && <div className="mb-4"><Alert kind="info" title={t('savedOnDevice')}>{t('submittedOffline')}</Alert></div>}
      {queued && (queued.status === 'conflict' || queued.status === 'failed') && <div className="mb-4"><Alert kind="error" title={t('needsAttention')}>{queued.lastError} — <Link className="underline" to="/teacher/history">{t('navHistory')}</Link></Alert></div>}
      {error && <div className="mb-4"><Alert kind="error">{error}</Alert></div>}

      {alreadySubmitted ? (
        <Card title={t('alreadySubmitted')}>
          <div className="mb-4 flex flex-wrap gap-2">{ATTENDANCE_STATUSES.map((s) => <Badge key={s} color={s === 'present' ? 'green' : s === 'absent' ? 'red' : s === 'late' ? 'amber' : 'blue'}>{t(s)}: {r.sheet!.counts[s] ?? 0}</Badge>)}</div>
          <ul className="divide-y divide-surface-line">
            {r.students.map((s) => { const rec = r.records.find((x) => x.studentId === s._id); return (
              <li key={s._id} className="flex items-center justify-between py-2.5 text-sm"><span>{s.fullName}</span>{rec && <Badge color={rec.status === 'present' ? 'green' : rec.status === 'absent' ? 'red' : rec.status === 'late' ? 'amber' : 'blue'}>{t(rec.status as TKey)}{rec.corrected ? ` (${t('corrected')})` : ''}</Badge>}</li>
            ); })}
          </ul>
          <p className="mt-4 text-sm text-ink-soft">{t('requestCorrection')}: <Link className="text-brand underline" to="/teacher/history">{t('navHistory')}</Link></p>
        </Card>
      ) : !r.canSubmit && r.blockedReason ? (
        <Alert kind="warning">{t(`blocked_${r.blockedReason}` as TKey)}</Alert>
      ) : queued && queued.status !== 'conflict' && queued.status !== 'failed' ? null : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button onClick={markAllPresent} variant="secondary"><CheckCheck className="h-4 w-4" />{t('markAllPresent')}</Button>
            <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" /><input className="input ps-9" placeholder={t('search')} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          </div>
          <Card padded={false}>
            <ul className="divide-y divide-surface-line">
              {students.map((s, idx) => {
                const m = marks[s._id];
                return (
                  <li key={s._id} className={clsx('flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', highlight.has(s._id) && 'bg-amber-50')}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="num w-6 text-end text-xs text-ink-faint">{idx + 1}</span>
                      {s.photoPath ? <img src={s.photoPath} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-muted text-sm font-medium text-ink-soft">{s.fullName[0]}</div>}
                      <div className="min-w-0"><p className="truncate font-medium">{s.fullName}</p><p className="num text-xs text-ink-faint">{s.admissionNumber}</p></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={s.fullName}>
                      {ATTENDANCE_STATUSES.map((st) => (
                        <button key={st} role="radio" aria-checked={m?.status === st} onClick={() => setStatus(s._id, st)}
                          className={clsx('min-w-[4.5rem] rounded-lg border px-3 py-2 text-sm font-medium transition', m?.status === st ? STATUS_STYLE[st] : 'border-surface-line bg-white text-ink-soft hover:border-ink-faint')}>
                          {t(st)}
                        </button>
                      ))}
                      {m?.status === 'late' && <input type="time" className="input w-28 py-2" value={m.arrivalTime ?? ''} onChange={(e) => setMarks((x) => ({ ...x, [s._id]: { ...x[s._id]!, arrivalTime: e.target.value } }))} aria-label={t('arrivalTime')} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-line bg-white/95 px-4 py-3 backdrop-blur lg:ps-72">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge color="green">{t('present')} {counts.present}</Badge><Badge color="red">{t('absent')} {counts.absent}</Badge>
                <Badge color="amber">{t('late')} {counts.late}</Badge><Badge color="blue">{t('leave')} {counts.leave}</Badge>
                {unmarked > 0 && <Badge>{t('unmarked', { n: unmarked })}</Badge>}
              </div>
              <Button disabled={unmarked > 0} onClick={() => setReviewing(true)}>{t('reviewAndSubmit')}</Button>
            </div>
          </div>
        </>
      )}

      <Modal open={reviewing} onClose={() => setReviewing(false)} title={`${t('review')} — ${r.classroom.name} · ${date}`} wide
        footer={<><Button variant="secondary" onClick={() => setReviewing(false)}>{t('back')}</Button><Button loading={busy} onClick={submit}>{isConnected() ? <CheckCircle2 className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}{t('submit')}</Button></>}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ATTENDANCE_STATUSES.map((s) => <div key={s} className="rounded-xl bg-surface-muted p-3 text-center"><p className="text-xs text-ink-soft">{t(s)}</p><p className="num text-xl font-semibold">{counts[s]}</p></div>)}
        </div>
        {!isConnected() && <div className="mb-3"><Alert kind="warning">{t('savedOnDevice')}</Alert></div>}
        <ul className="divide-y divide-surface-line text-sm">
          {r.students.filter((s) => marks[s._id]?.status !== 'present').map((s) => (
            <li key={s._id} className="flex items-center justify-between gap-3 py-2">
              <span>{s.fullName}</span>
              <div className="flex items-center gap-2">
                <input className="input w-40 py-1.5 text-xs" placeholder={t('remark')} value={marks[s._id]?.remark ?? ''} onChange={(e) => setMarks((x) => ({ ...x, [s._id]: { ...x[s._id]!, remark: e.target.value } }))} />
                <Badge color={marks[s._id]?.status === 'absent' ? 'red' : marks[s._id]?.status === 'late' ? 'amber' : 'blue'}>{t(marks[s._id]!.status!)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
