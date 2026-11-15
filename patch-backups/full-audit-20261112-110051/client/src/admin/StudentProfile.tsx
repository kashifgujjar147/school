import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Pencil, ArrowRightLeft, Archive, RotateCcw, Trash2 } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { del, patch, post, upload } from '../services/api';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Spinner, STATUS_TONE, Table, Textarea, errorMessage } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { StudentForm, type StudentRow } from './Students';
import { classroomOptions, useClassrooms } from './shared';
import { GuardianLinks } from './Guardians';

interface Profile extends StudentRow {
  history: { _id: string; kind: string; reason?: string; at: string; from?: unknown; to?: unknown }[];
  recentAttendance: { _id: string; date: string; status: string; corrected: boolean; originalStatus: string }[];
  attendanceSummary: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null };
  guardians: { _id: string; fullName: string; relation: string; phone: string; smsOptIn: boolean; link: { _id: string; isPrimary: boolean; receivesAlerts: boolean } }[];
}

export default function StudentProfile() {
  const t = useT(); const f = useFormat();
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { can, config } = useAuth();
  const q = useGet<Profile>(`/api/students/${id}`);
  const rooms = useClassrooms();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [move, setMove] = useState({ classroomId: '', kind: 'transfer', reason: '' });
  const [deleting, setDeleting] = useState(false); const [delReason, setDelReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const inv = ['/api/students'];
  const doMove = useAction(() => post(`/api/students/${id}/move`, move), inv);
  const setStatus = useAction((status: string) => patch(`/api/students/${id}`, { status }), inv);
  const doDelete = useAction(() => del(`/api/students/${id}`, { reason: delReason }), inv);
  const doPhoto = useAction((file: File) => upload(`/api/students/${id}/photo`, file), inv);

  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data.data;
  const manage = can('students.manage');

  return (
    <div className="space-y-6">
      <Link to="/admin/students" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('students')}</Link>
      <CacheNotice fromCache={q.data.fromCache} />
      {err && <Alert kind="error">{err}</Alert>}
      <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <div className="relative">
          {s.photoPath ? <img src={s.photoPath} alt="" className="h-24 w-24 rounded-2xl object-cover" /> : <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-brand-soft text-3xl font-semibold text-brand">{s.fullName[0]}</div>}
          {manage && <label className="absolute -bottom-2 -end-2 cursor-pointer rounded-full bg-white p-2 shadow-card ring-1 ring-surface-line" title={t('photo')}><Camera className="h-4 w-4" /><input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) doPhoto.mutate(file, { onError: (x) => setErr(errorMessage(x, t('errorGeneric'))) }); }} /></label>}
        </div>
        <div className="flex-1">
          <PageHeader title={s.fullName} subtitle={<span className="flex flex-wrap items-center gap-2"><span className="num font-mono">{s.admissionNumber}</span>·<span>{s.classroomName}</span><Badge color={STATUS_TONE[s.status]}>{t(s.status as TKey)}</Badge></span>}
            actions={manage && <>
              <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />{t('edit')}</Button>
              {s.status === 'active' && <Button variant="secondary" onClick={() => setMoving(true)}><ArrowRightLeft className="h-4 w-4" />{t('moveStudent')}</Button>}
              {s.status === 'active' ? <Button variant="secondary" onClick={() => setStatus.mutate('archived')}><Archive className="h-4 w-4" />{t('archive')}</Button> : <Button variant="secondary" onClick={() => setStatus.mutate('active')}><RotateCcw className="h-4 w-4" />{t('restore')}</Button>}
              {can('students.delete') && <Button variant="danger" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" />{t('delete')}</Button>}
            </>} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-5">
        {(['present', 'absent', 'late', 'leave'] as const).map((k) => <div key={k} className="card p-4"><p className="text-sm text-ink-soft">{t(k)}</p><p className="num text-2xl font-semibold">{s.attendanceSummary[k]}</p></div>)}
        <div className="card p-4"><p className="text-sm text-ink-soft">{t('attendanceRate')}</p><p className="num text-2xl font-semibold">{f.pct(s.attendanceSummary.percent)}</p></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('fullName')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {([['dateOfBirth', f.date(s.dateOfBirth)], ['gender', s.gender ? t(s.gender as TKey) : '—'], ['admissionDate', f.date(s.admissionDate)], ['emergencyContact', s.emergencyContactName], ['emergencyPhone', s.emergencyContactPhone], ['address', s.address], ['notes', s.notes]] as [TKey, string | undefined][]).map(([k, v]) => (
              <div key={k} className={k === 'notes' || k === 'address' ? 'col-span-2' : ''}><dt className="text-ink-faint">{t(k)}</dt><dd className="mt-0.5 whitespace-pre-line">{v || '—'}</dd></div>
            ))}
          </dl>
        </Card>
        {config?.package === 'standard' && can('guardians.view') ? <GuardianLinks studentId={s._id} guardians={s.guardians} onChange={() => q.refetch()} /> : (
          <Card title={t('guardians')}><EmptyState>{t('standardOnly')}</EmptyState></Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('navAttendance')} padded={false}>
          {s.recentAttendance.length === 0 ? <EmptyState /> : <Table><thead><tr><th>{t('date')}</th><th>{t('status')}</th></tr></thead><tbody>{s.recentAttendance.map((a) => <tr key={a._id}><td className="num">{f.date(a.date)}</td><td><Badge color={STATUS_TONE[a.status]}>{t(a.status as TKey)}</Badge>{a.corrected && <span className="ms-2 text-xs text-ink-faint">{t('original')}: {t(a.originalStatus as TKey)}</span>}</td></tr>)}</tbody></Table>}
        </Card>
        <Card title={t('history')}>
          {s.history.length === 0 ? <EmptyState /> : <ol className="space-y-3 border-s border-surface-line ps-4 text-sm">{s.history.map((h) => <li key={h._id}><p className="font-medium">{h.kind.replace('_', ' ')}</p><p className="text-xs text-ink-faint">{f.dateTime(h.at)}{h.reason ? ` · ${h.reason}` : ''}</p></li>)}</ol>}
        </Card>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={t('editStudent')} wide>
        <StudentForm initial={s} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); void q.refetch(); }} />
      </Modal>
      <Modal open={moving} onClose={() => setMoving(false)} title={t('moveStudent')} footer={<><Button variant="secondary" onClick={() => setMoving(false)}>{t('cancel')}</Button><Button loading={doMove.isPending} disabled={!move.classroomId || move.reason.length < 3} onClick={() => doMove.mutate(undefined, { onSuccess: () => { setMoving(false); void q.refetch(); }, onError: (x) => setErr(errorMessage(x, t('errorGeneric'))) })}>{t('save')}</Button></>}>
        <div className="space-y-4">
          <Select label={t('status')} value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value })} options={[{ value: 'transfer', label: t('transfer') }, { value: 'promotion', label: t('promotion') }, { value: 'section_change', label: t('sectionChange') }]} />
          <Select label={t('classroom')} value={move.classroomId} onChange={(e) => setMove({ ...move, classroomId: e.target.value })} placeholder="—" options={classroomOptions(rooms.data?.data).filter((o) => o.value !== s.classroomId)} />
          <Textarea label={t('reason')} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog open={deleting} danger title={t('delete')} message={t('deleteStudentConfirm')} loading={doDelete.isPending} onCancel={() => setDeleting(false)}
        onConfirm={() => doDelete.mutate(undefined, { onSuccess: () => nav('/admin/students'), onError: (x) => setErr(errorMessage(x, t('errorGeneric'))) })}>
        <Input label={t('reason')} value={delReason} onChange={(e) => setDelReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
