import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, MessageCircle, PencilLine, PhoneOff, Users as UsersIcon, Wallet } from 'lucide-react';
import { DEFAULT_FEE_WHATSAPP_TEMPLATE, renderFeeWhatsapp } from '@sms/shared';
import { useAction, useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { useAuth } from '../store/auth';
import { patch, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select, Spinner, Table, errorMessage } from '../components/ui';
import { SentBadge, TemplateEditor, WA_GREEN, WhatsappQueue, openWhatsapp } from '../components/WhatsappFree';
import { useMoney } from '../parent/common';
import { classroomOptions, useClassrooms } from './shared';

export interface UnpaidRow {
  studentId: string; fullName: string; admissionNumber: string; classroomId: string; classroomName: string;
  balanceMinor: number; currency: string; oldestDueDate: string | null; overdue: boolean;
  vouchers: { _id: string; voucherNumber: string; title: string; period: string; dueDate: string; balanceMinor: number }[];
  parentName: string; phone: string | null; whatsapp: string | null; lastRemindedAt: string | null;
}
interface UnpaidData {
  today: string; schoolName: string; template: string | null; currency: string;
  totals: { students: number; balanceMinor: number; overdue: number; noPhone: number };
  rows: UnpaidRow[];
}

/** Message for one student's parent, from the school's template. */
function useMessage(d: UnpaidData | undefined) {
  const f = useFormat(); const money = useMoney();
  return (r: UnpaidRow, template: string | null | undefined = d?.template) => renderFeeWhatsapp(template, {
    parent: r.parentName || 'Parent', student: r.fullName, class: r.classroomName,
    amount: money(r.balanceMinor, r.currency), due: r.oldestDueDate ? f.date(r.oldestDueDate) : '-',
    months: [...new Set(r.vouchers.map((v) => v.period))].join(', '), school: d?.schoolName ?? ''
  });
}

/**
 * Students whose fees are not paid, and free WhatsApp reminders to their parents (click-to-chat:
 * WhatsApp opens with the message typed; the school taps Send). No API, no cost.
 */
export function UnpaidFees() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const can = useAuth((s) => s.can);
  const rooms = useClassrooms();
  const [flt, setFlt] = useState({ classroomId: '', q: '', overdue: '' });
  const q = useGet<UnpaidData>(`/api/fees/defaulters${qs(flt)}`);
  const d = q.data?.data;
  const message = useMessage(d);
  const messageWith = (tpl: string, r: UnpaidRow) => message(r, tpl);
  const [runner, setRunner] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const mark = useAction((studentId: string) => post(`/api/fees/defaulters/${studentId}/whatsapp`), []);
  const manage = can('fees.manage');

  /** Opens the parent's WhatsApp chat (must run inside the click) and records it. */
  const send = (r: UnpaidRow) => {
    if (!r.whatsapp) return;
    openWhatsapp(r.whatsapp, message(r));
    mark.mutate(r.studentId, { onSuccess: () => void q.refetch(), onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) });
  };

  return (
    <div className="space-y-5">
      {err && <Alert kind="error">{err}</Alert>}
      {/* Summary */}
      {d && <div className="grid gap-4 sm:grid-cols-3">
        <div className="card flex items-center gap-4 p-5"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-700"><UsersIcon className="h-6 w-6" /></span><span><span className="block text-[0.95rem] font-medium text-ink-soft">{t('unpaidFeesTab')}</span><span className="num block text-[1.9rem] font-semibold leading-tight">{f.num(d.totals.students)}</span></span></div>
        <div className="card flex items-center gap-4 p-5"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700"><Wallet className="h-6 w-6" /></span><span><span className="block text-[0.95rem] font-medium text-ink-soft">{t('unpaidTotal')}</span><span className="num block text-[1.9rem] font-semibold leading-tight">{money(d.totals.balanceMinor, d.currency)}</span></span></div>
        <div className="card flex items-center gap-4 p-5"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700"><AlertTriangle className="h-6 w-6" /></span><span><span className="block text-[0.95rem] font-medium text-ink-soft">{t('unpaidOverdueStudents')}</span><span className="num block text-[1.9rem] font-semibold leading-tight">{f.num(d.totals.overdue)}</span></span></div>
      </div>}

      <Card padded={false}
        title={<span className="text-lg">{d ? t('unpaidHeadline', { n: f.num(d.totals.students) }) : t('unpaidFeesTab')}</span>}
        actions={manage && d && d.rows.length > 0 && <>
          <Button variant="secondary" onClick={() => setEditing(true)}><PencilLine className="h-4 w-4" />{t('waEditMessage')}</Button>
          <Button className={WA_GREEN} disabled={!d.rows.some((r) => r.whatsapp)} onClick={() => setRunner(true)}><MessageCircle className="h-4 w-4" />{t('waSendAll', { n: d.rows.filter((r) => r.whatsapp).length })}</Button>
        </>}>
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-3">
          <Select aria-label={t('classroom')} value={flt.classroomId} onChange={(e) => setFlt({ ...flt, classroomId: e.target.value })} placeholder={`${t('classroom')}: ${t('all')}`} options={classroomOptions(rooms.data?.data)} />
          <Input type="search" aria-label={t('search')} placeholder={t('searchStudentName')} value={flt.q} onChange={(e) => setFlt({ ...flt, q: e.target.value })} />
          <Checkbox label={t('onlyOverdue')} checked={flt.overdue === 'true'} onChange={(x) => setFlt({ ...flt, overdue: x ? 'true' : '' })} />
        </div>
        {manage && d && d.rows.length > 0 && <p className="border-b border-surface-line bg-emerald-50/60 px-5 py-3 text-sm text-emerald-900">{t('waHowItWorks')}</p>}
        {q.isLoading ? <Spinner /> : q.isError || !d ? <div className="p-5"><Alert kind="error">{errorMessage(q.error, t('errorGeneric'))}</Alert></div>
          : d.rows.length === 0 ? <EmptyState><span className="inline-flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-5 w-5" />{t('everyonePaid')}</span></EmptyState> : (
          <Table>
            <thead><tr><th>{t('students')}</th><th>{t('classroom')}</th><th className="text-end">{t('amountDue')}</th><th>{t('dueDate')}</th><th>{t('parentPhone')}</th><th>{t('lastMessage')}</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.studentId}>
                <td><Link to={`/admin/students/${r.studentId}`} className="font-medium hover:underline">{r.fullName}</Link><span className="num block text-xs text-ink-faint">{r.admissionNumber}</span></td>
                <td>{r.classroomName}</td>
                <td className="num text-end"><strong className="text-[1.05rem] text-red-700">{money(r.balanceMinor, r.currency)}</strong><span className="block text-xs text-ink-faint">{r.vouchers.map((v) => v.period).join(', ')}</span></td>
                <td className="num">{r.oldestDueDate ? f.date(r.oldestDueDate) : '—'} {r.overdue && <Badge color="red">{t('overdue')}</Badge>}</td>
                <td>{r.phone ? <><span className="block">{r.parentName || '—'}</span><span className="num text-xs text-ink-faint">{r.phone}</span></> : <Badge color="amber"><PhoneOff className="me-1 inline h-3 w-3" />{t('unpaidNoPhone')}</Badge>}</td>
                <td className="text-sm"><SentBadge at={r.lastRemindedAt} /></td>
                <td className="text-end">{manage && r.whatsapp && <Button variant="secondary" className="!border-emerald-200 !text-emerald-800 hover:!bg-emerald-50" onClick={() => send(r)}><MessageCircle className="h-4 w-4" />{t('waSend')}</Button>}</td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>

      {runner && d && <WhatsappQueue title={t('waSendAll', { n: d.rows.filter((r) => r.whatsapp).length })} onSent={(id) => mark.mutateAsync(id).catch(() => undefined)} onClose={() => { setRunner(false); void q.refetch(); }}
        items={d.rows.map((r) => ({ key: r.studentId, name: r.parentName, phone: r.phone, whatsapp: r.whatsapp, message: message(r), detail: <>{r.fullName} · {r.classroomName} · <strong className="text-red-700">{money(r.balanceMinor, r.currency)}</strong></> }))} />}
      {editing && d && <TemplateEditor title={t('waMessageTitle')} help={t('waMessageHelp')} onSave={(v) => patch('/api/fees/settings', { whatsappTemplate: v.fee })} onClose={(saved) => { setEditing(false); if (saved) void q.refetch(); }}
        fields={[{ key: 'fee', label: t('waMessageTitle'), value: d.template, defaultValue: DEFAULT_FEE_WHATSAPP_TEMPLATE, preview: d.rows[0] ? (tpl) => messageWith(tpl, d.rows[0]!) : undefined }]} />}
    </div>
  );
}
