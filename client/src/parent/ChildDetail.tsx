import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CreditCard, Download } from 'lucide-react';
import { fromMinor, toMinor } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { downloadFile, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Spinner, STATUS_TONE, Table, Tabs, errorMessage } from '../components/ui';
import { Avatar, useMoney, type ChildSummary, type Payment, type ResultExam, type Voucher } from './common';
import { ClassTimetableView, type ClassTimetablePayload } from '../timetable/ClassTimetableView';

/** The child's published class timetable: subject, teacher, timing, room; covers and notices. */
function TimetableTab({ id }: { id: string }) {
  const q = useGet<ClassTimetablePayload>(`/api/parent/children/${id}/timetable`);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <div className="mt-4"><ClassTimetableView data={q.data.data} /></div>;
}

type Tab = 'profile' | 'timetable' | 'attendance' | 'results' | 'homework' | 'fees' | 'feedback';
const TABS: Tab[] = ['profile', 'timetable', 'attendance', 'results', 'homework', 'fees', 'feedback'];

export interface Profile extends ChildSummary { dateOfBirth?: string; gender?: string; admissionDate?: string; teachers: { fullName: string; isHomeroom: boolean }[] }

export default function ChildDetail() {
  const t = useT();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'profile') as Tab;
  const base = `/api/parent/children/${id}`;
  const q = useGet<Profile>(base);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} />;
  const s = q.data.data;
  const labels: Record<Tab, TKey> = { profile: 'profileTab', timetable: 'timetableTab', attendance: 'attendanceTab', results: 'resultsTab', homework: 'homeworkTab', fees: 'feesTab', feedback: 'feedbackTab' };
  return (
    <div>
      <Link to="/parent" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('myChildren')}</Link>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={s.fullName} photo={s.photoPath} size="h-14 w-14" />
        <PageHeader title={s.fullName} subtitle={<span className="num">{[s.className, s.sectionName].filter(Boolean).join(' · ')} · {s.admissionNumber}</span>} />
      </div>
      <Tabs value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} tabs={TABS.map((x) => ({ value: x, label: t(labels[x]) }))} />
      {tab === 'profile' && <ProfileTab s={s} />}
      {tab === 'timetable' && <TimetableTab id={id} />}
      {tab === 'attendance' && <AttendanceTab base={base} />}
      {tab === 'results' && <ResultsTab base={base} name={s.fullName} />}
      {tab === 'homework' && <HomeworkTab base={base} />}
      {tab === 'fees' && <FeesTab base={base} docs="/api/parent" canPay />}
      {tab === 'feedback' && <FeedbackTab id={id} />}
    </div>
  );
}

export function ProfileTab({ s }: { s: Profile }) {
  const t = useT(); const f = useFormat();
  const rows: [string, string][] = [
    [t('admissionNumber'), s.admissionNumber], [t('classroom'), s.classroomName], [t('academicSession'), s.sessionName],
    [t('dateOfBirth'), f.date(s.dateOfBirth)], [t('admissionDate'), f.date(s.admissionDate)],
    [t('status'), t(s.status as TKey)],
    [t('classTeacher'), s.teachers.filter((x) => x.isHomeroom).map((x) => x.fullName).join(', ') || '—'],
    [t('teachers'), s.teachers.map((x) => x.fullName).join(', ') || '—']
  ];
  return (
    <Card>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{rows.map(([k, v]) => <div key={k}><dt className="text-xs text-ink-faint">{k}</dt><dd className="mt-0.5 font-medium">{v}</dd></div>)}</dl>
    </Card>
  );
}

/** Shared by the parent portal (one child) and the student portal (own record): `base` is the record's API path. */
export function AttendanceTab({ base }: { base: string }) {
  const t = useT(); const f = useFormat();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const q = useGet<{ from: string; to: string; summary: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null }; records: { _id: string; date: string; status: string; remark?: string; arrivalTime?: string; corrected: boolean }[] }>(`${base}/attendance${qs(range)}`);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input type="date" label={t('from')} value={range.from ?? d.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input type="date" label={t('to')} value={range.to ?? d.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <div className="ms-auto grid grid-cols-5 gap-3 text-center text-sm">
            {(['present', 'absent', 'late', 'leave'] as const).map((k) => <div key={k}><p className="text-xs text-ink-faint">{t(k)}</p><p className="num text-lg font-semibold">{d.summary[k]}</p></div>)}
            <div><p className="text-xs text-ink-faint">%</p><p className="num text-lg font-semibold">{f.pct(d.summary.percent)}</p></div>
          </div>
        </div>
      </Card>
      <Card padded={false}>
        {d.records.length === 0 ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('status')}</th><th>{t('remarks')}</th></tr></thead>
            <tbody>{d.records.map((r) => <tr key={r._id}><td className="num">{f.date(r.date)}</td><td><Badge color={STATUS_TONE[r.status]}>{t(r.status as TKey)}</Badge>{r.arrivalTime && <span className="num ms-2 text-xs text-ink-faint">{r.arrivalTime}</span>}</td><td className="text-sm text-ink-soft">{r.remark ?? ''}</td></tr>)}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

export function ResultsTab({ base, name }: { base: string; name: string }) {
  const t = useT(); const f = useFormat();
  const q = useGet<ResultExam[]>(`${base}/results`);
  const [err, setErr] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.data.length) return <Card><EmptyState>{t('noResultsYet')}</EmptyState></Card>;
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      {q.data.data.map((e) => (
        <Card key={e.examId} padded={false} title={<span>{e.name}{e.term && <span className="ms-2 text-sm font-normal text-ink-soft">{e.term}</span>}</span>}
          actions={<Button variant="secondary" onClick={() => downloadFile(`${base}/report-card/${e.examId}`, `report-card-${name}.pdf`).catch((x) => setErr(errorMessage(x, t('errorGeneric'))))}><Download className="h-4 w-4" />{t('reportCard')}</Button>}>
          <Table>
            <thead><tr><th>{t('subject')}</th><th className="text-end">{t('marks')}</th><th className="text-end">{t('maxMarks')}</th><th>{t('remarks')}</th></tr></thead>
            <tbody>{e.rows.map((r) => <tr key={r.subject}><td className="font-medium">{r.subject}</td><td className="num text-end">{r.absent ? <Badge color="red">{t('absentShort')}</Badge> : r.marksObtained}</td><td className="num text-end">{r.maxMarks}</td><td className="text-sm text-ink-soft">{r.remarks ?? ''}</td></tr>)}</tbody>
          </Table>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-surface-line px-5 py-3 text-sm">
            <span>{t('totalAmount')}: <strong className="num">{e.summary.obtained} / {e.summary.max}</strong></span>
            <span>{t('percentage')}: <strong className="num">{f.pct(e.summary.percent)}</strong></span>
            <span>{t('grade')}: <strong>{e.summary.grade}</strong></span>
            <Badge color={e.summary.passed ? 'green' : 'red'}>{e.summary.passed ? t('passedLabel') : t('notPassed')}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function HomeworkTab({ base }: { base: string }) {
  const t = useT(); const f = useFormat();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const q = useGet<{ _id: string; subject: string; title: string; description?: string; assignedDate: string; dueDate: string }[]>(`${base}/homework?scope=${scope}`);
  return (
    <Card actions={<div className="flex gap-1">{(['upcoming', 'past'] as const).map((s) => <Button key={s} variant={scope === s ? 'primary' : 'secondary'} onClick={() => setScope(s)}>{t(s)}</Button>)}</div>}>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.data.length ? <EmptyState>{t('noHomework')}</EmptyState> : (
        <ul className="divide-y divide-surface-line">{q.data.data.map((h) => (
          <li key={h._id} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium"><Badge color="blue">{h.subject}</Badge> {h.title}</p><p className="num text-xs text-ink-faint">{t('assignedDate')}: {f.date(h.assignedDate)} · {t('dueDate')}: <strong>{f.date(h.dueDate)}</strong></p></div>
            {h.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{h.description}</p>}
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

function FeedbackTab({ id }: { id: string }) {
  const t = useT(); const f = useFormat();
  const q = useGet<{ _id: string; category: string; body: string; createdAt: string; authorName: string }[]>(`/api/parent/children/${id}/feedback`);
  return (
    <Card>
      {q.isLoading ? <Spinner /> : q.isError ? <ErrorState error={q.error} /> : !q.data?.data.length ? <EmptyState>{t('noFeedback')}</EmptyState> : (
        <ul className="space-y-4">{q.data.data.map((x) => <li key={x._id} className="rounded-xl bg-surface-muted p-4"><div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint"><Badge>{t(x.category as TKey)}</Badge><span>{x.authorName}</span><span>· {f.dateTime(x.createdAt)}</span></div><p className="whitespace-pre-line text-sm">{x.body}</p></li>)}</ul>
      )}
    </Card>
  );
}

/** `docs`: API prefix for voucher/receipt PDFs. Online payment only where `canPay` (parent portal). */
export function FeesTab({ base, docs, canPay: payAllowed = false }: { base: string; docs: string; canPay?: boolean }) {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const q = useGet<{ vouchers: Voucher[]; payments: Payment[]; outstandingMinor: number }>(`${base}/fees`);
  const avail = useGet<{ available: boolean; currency: string }>(payAllowed ? '/api/parent/payments/availability' : null);
  const [paying, setPaying] = useState<Voucher | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  const canPay = payAllowed && avail.data?.data.available;
  const dl = (url: string, name: string) => downloadFile(url, name).catch((x) => setErr(errorMessage(x, t('errorGeneric'))));
  const startPay = async () => {
    if (!paying) return;
    setBusy(true); setErr(null);
    try {
      const amountMinor = paying.allowPartial && amount ? toMinor(Number(amount)) : undefined;
      const r = await post<{ intentId: string; checkoutUrl: string }>(`/api/parent/vouchers/${paying._id}/checkout`, amountMinor ? { amountMinor } : {});
      // Card details are entered only on the provider's hosted page.
      window.location.assign(r.checkoutUrl);
    } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); setBusy(false); }
  };
  const open = d.vouchers.filter((v) => v.status === 'unpaid' || v.status === 'partial');
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-5"><p className="text-sm text-ink-soft">{t('outstandingFees')}</p><p className="num mt-1 text-2xl font-semibold">{money(d.outstandingMinor, d.vouchers[0]?.currency)}</p></div>
        {payAllowed && avail.data && !canPay && open.length > 0 && <Alert kind="info">{t('onlinePaymentUnavailable')}</Alert>}
      </div>
      <Card padded={false} title={t('vouchers')}>
        {d.vouchers.length === 0 ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('voucherNo')}</th><th>{t('feeTitle')}</th><th>{t('dueDate')}</th><th className="text-end">{t('totalAmount')}</th><th className="text-end">{t('balance')}</th><th>{t('status')}</th><th /></tr></thead>
            <tbody>{d.vouchers.map((v) => (
              <tr key={v._id}>
                <td className="num text-xs">{v.voucherNumber}</td><td>{v.title} <span className="text-xs text-ink-faint">{v.period}</span></td>
                <td className="num">{f.date(v.dueDate)} {v.overdue && <Badge color="red">{t('overdue')}</Badge>}</td>
                <td className="num text-end">{money(v.totalMinor, v.currency)}</td><td className="num text-end font-medium">{money(v.balanceMinor, v.currency)}</td>
                <td><Badge color={STATUS_TONE[v.status]}>{t(v.status as TKey)}</Badge></td>
                <td className="whitespace-nowrap text-end">
                  <Button variant="ghost" onClick={() => dl(`${docs}/vouchers/${v._id}/pdf`, `voucher-${v.voucherNumber}.pdf`)} aria-label={`${t('download')} ${v.voucherNumber}`}><Download className="h-4 w-4" /></Button>
                  {canPay && (v.status === 'unpaid' || v.status === 'partial') && <Button onClick={() => { setErr(null); setAmount(String(fromMinor(v.balanceMinor))); setPaying(v); }}><CreditCard className="h-4 w-4" />{t('payOnline')}</Button>}
                </td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Card padded={false} title={t('paymentHistory')}>
        {d.payments.length === 0 ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('receiptNo')}</th><th>{t('paymentMethod')}</th><th className="text-end">{t('amount')}</th><th /></tr></thead>
            <tbody>{d.payments.map((p) => (
              <tr key={p._id}><td className="num">{f.date(p.paidAt)}</td><td className="num text-xs">{p.receiptNumber}</td><td>{t(p.method as TKey)}</td><td className="num text-end">{money(p.amountMinor, p.currency)}</td>
                <td className="text-end"><Button variant="ghost" onClick={() => dl(`${docs}/receipts/${p._id}/pdf`, `receipt-${p.receiptNumber}.pdf`)}><Download className="h-4 w-4" />{t('receipt')}</Button></td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Modal open={Boolean(paying)} onClose={() => !busy && setPaying(null)} title={t('payOnline')}
        footer={<><Button variant="secondary" disabled={busy} onClick={() => setPaying(null)}>{t('cancel')}</Button><Button loading={busy} onClick={() => void startPay()}>{busy ? t('payingOnline') : t('payOnline')}</Button></>}>
        {paying && <div className="space-y-4 text-sm">
          {err && <Alert kind="error">{err}</Alert>}
          <p><strong>{paying.title}</strong> · <span className="num">{paying.voucherNumber}</span></p>
          <p>{t('balance')}: <strong className="num">{money(paying.balanceMinor, paying.currency)}</strong></p>
          {paying.allowPartial && <Input type="number" inputMode="decimal" min={1} step="0.01" max={fromMinor(paying.balanceMinor)} label={`${t('amountToPay')} (${paying.currency})`} value={amount} onChange={(e) => setAmount(e.target.value)} />}
          <p className="text-xs text-ink-faint">{t('paymentProviderHelp')}</p>
        </div>}
      </Modal>
    </div>
  );
}
