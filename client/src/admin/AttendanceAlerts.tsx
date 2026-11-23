import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CheckCircle2, Clock, MessageCircle, PencilLine, PhoneOff, UserX } from 'lucide-react';
import { DEFAULT_ATTENDANCE_WHATSAPP, renderAttendanceWhatsapp, type AlertStatus } from '@sms/shared';
import { useAction, useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { useAuth } from '../store/auth';
import { patch, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, Select, Spinner, Table, errorMessage } from '../components/ui';
import { SentBadge, TemplateEditor, WA_GREEN, WhatsappQueue, openWhatsapp } from '../components/WhatsappFree';
import { classroomOptions, useClassrooms } from './shared';

interface AlertRow {
  studentId: string; fullName: string; admissionNumber: string; classroomId: string; classroomName: string;
  status: AlertStatus; arrivalTime: string | null; remark: string | null;
  parentName: string; phone: string | null; whatsapp: string | null; lastSentAt: string | null;
}
interface AlertsData { date: string; schoolName: string; templates: Record<AlertStatus, string | null>; totals: { absent: number; late: number; noPhone: number }; rows: AlertRow[] }

/** Absent and late students of a day, and free WhatsApp messages to their parents (no API). */
export function AttendanceAlerts({ date }: { date: string }) {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const rooms = useClassrooms();
  const [flt, setFlt] = useState<{ classroomId: string; status: '' | AlertStatus }>({ classroomId: '', status: '' });
  const q = useGet<AlertsData>(`/api/attendance/alerts${qs({ date, ...flt })}`);
  const d = q.data?.data;
  const [runner, setRunner] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mark = useAction((r: AlertRow) => post(`/api/attendance/alerts/${r.studentId}/whatsapp`, { date, status: r.status }), []);

  const message = (r: AlertRow, template: string | null | undefined = d?.templates[r.status]) => renderAttendanceWhatsapp(r.status, template, {
    parent: r.parentName || 'Parent', student: r.fullName, class: r.classroomName, date: f.date(date), time: r.arrivalTime ?? '-', school: d?.schoolName ?? ''
  });
  const send = (r: AlertRow) => {
    if (!r.whatsapp) return;
    openWhatsapp(r.whatsapp, message(r));
    mark.mutate(r, { onSuccess: () => void q.refetch(), onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) });
  };
  const sample = (s: AlertStatus): AlertRow => d?.rows.find((r) => r.status === s) ?? { studentId: '', fullName: 'Ali Khan', admissionNumber: '', classroomId: '', classroomName: '5-A', status: s, arrivalTime: '08:20', remark: null, parentName: 'Mr. Khan', phone: null, whatsapp: null, lastSentAt: null };

  return (
    <div className="space-y-5">
      {err && <Alert kind="error">{err}</Alert>}
      {d && <div className="grid gap-4 sm:grid-cols-2">
        <button type="button" onClick={() => setFlt({ ...flt, status: flt.status === 'absent' ? '' : 'absent' })} className={clsx('card flex items-center gap-4 p-5 text-start transition', flt.status === 'absent' && 'ring-2 ring-red-400')}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-700"><UserX className="h-6 w-6" /></span>
          <span><span className="block text-[0.95rem] font-medium text-ink-soft">{t('absent')}</span><span className="num block text-[1.9rem] font-semibold leading-tight">{f.num(d.totals.absent)}</span></span>
        </button>
        <button type="button" onClick={() => setFlt({ ...flt, status: flt.status === 'late' ? '' : 'late' })} className={clsx('card flex items-center gap-4 p-5 text-start transition', flt.status === 'late' && 'ring-2 ring-amber-400')}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Clock className="h-6 w-6" /></span>
          <span><span className="block text-[0.95rem] font-medium text-ink-soft">{t('late')}</span><span className="num block text-[1.9rem] font-semibold leading-tight">{f.num(d.totals.late)}</span></span>
        </button>
      </div>}

      <Card padded={false}
        title={<span className="text-lg">{d ? t('alertsHeadline', { absent: f.num(d.totals.absent), late: f.num(d.totals.late) }) : t('alertsTab')} <span className="num text-sm font-normal text-ink-faint">· {f.date(date)}</span></span>}
        actions={d && <>
          {can('settings.manage') && <Button variant="secondary" onClick={() => setEditing(true)}><PencilLine className="h-4 w-4" />{t('waEditMessage')}</Button>}
          {d.rows.length > 0 && <Button className={WA_GREEN} disabled={!d.rows.some((r) => r.whatsapp)} onClick={() => setRunner(true)}><MessageCircle className="h-4 w-4" />{t('waSendAll', { n: d.rows.filter((r) => r.whatsapp).length })}</Button>}
        </>}>
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-2">
          <Select aria-label={t('classroom')} value={flt.classroomId} onChange={(e) => setFlt({ ...flt, classroomId: e.target.value })} placeholder={`${t('classroom')}: ${t('all')}`} options={classroomOptions(rooms.data?.data)} />
          <Select aria-label={t('status')} value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value as '' | AlertStatus })} placeholder={`${t('absent')} + ${t('late')}`} options={[{ value: 'absent', label: t('absent') }, { value: 'late', label: t('late') }]} />
        </div>
        {d && d.rows.length > 0 && <p className="border-b border-surface-line bg-emerald-50/60 px-5 py-3 text-sm text-emerald-900">{t('waHowItWorks')}</p>}
        {q.isLoading ? <Spinner /> : q.isError || !d ? <div className="p-5"><Alert kind="error">{errorMessage(q.error, t('errorGeneric'))}</Alert></div>
          : d.rows.length === 0 ? <EmptyState><span className="inline-flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />{t('alertsEmpty')}</span></EmptyState> : (
          <Table>
            <thead><tr><th>{t('students')}</th><th>{t('classroom')}</th><th>{t('status')}</th><th>{t('parentPhone')}</th><th>{t('lastMessage')}</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.studentId}>
                <td><Link to={`/admin/students/${r.studentId}`} className="font-medium hover:underline">{r.fullName}</Link><span className="num block text-xs text-ink-faint">{r.admissionNumber}</span></td>
                <td>{r.classroomName}</td>
                <td><Badge color={r.status === 'absent' ? 'red' : 'amber'}>{t(r.status)}</Badge>{r.status === 'late' && r.arrivalTime && <span className="num ms-2 text-sm text-ink-soft">{t('arrivedAt', { time: r.arrivalTime })}</span>}{r.remark && <span className="block text-xs text-ink-faint">{r.remark}</span>}</td>
                <td>{r.phone ? <><span className="block">{r.parentName || '—'}</span><span className="num text-xs text-ink-faint">{r.phone}</span></> : <Badge color="amber"><PhoneOff className="me-1 inline h-3 w-3" />{t('unpaidNoPhone')}</Badge>}</td>
                <td className="text-sm"><SentBadge at={r.lastSentAt} /></td>
                <td className="text-end">{r.whatsapp && <Button variant="secondary" className="!border-emerald-200 !text-emerald-800 hover:!bg-emerald-50" onClick={() => send(r)}><MessageCircle className="h-4 w-4" />{t('waSend')}</Button>}</td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      {runner && d && <WhatsappQueue title={t('waSendAll', { n: d.rows.filter((r) => r.whatsapp).length })}
        items={d.rows.map((r) => ({ key: r.studentId, name: r.parentName, phone: r.phone, whatsapp: r.whatsapp, message: message(r), detail: <>{r.fullName} · {r.classroomName} · <strong className={r.status === 'absent' ? 'text-red-700' : 'text-amber-700'}>{t(r.status)}</strong></> }))}
        onSent={(key) => { const r = d.rows.find((x) => x.studentId === key); if (r) mark.mutateAsync(r).catch(() => undefined); }}
        onClose={() => { setRunner(false); void q.refetch(); }} />}
      {editing && d && <TemplateEditor title={t('waMessagesTitle')} help={t('waAttendanceHelp')}
        fields={(['absent', 'late'] as const).map((s) => ({ key: s, label: t(s === 'absent' ? 'absentMessage' : 'lateMessage'), value: d.templates[s], defaultValue: DEFAULT_ATTENDANCE_WHATSAPP[s], preview: (tpl: string) => message(sample(s), tpl) }))}
        onSave={(v) => patch('/api/attendance/alerts/templates', v)} onClose={(saved) => { setEditing(false); if (saved) void q.refetch(); }} />}
    </div>
  );
}
