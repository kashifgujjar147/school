import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Download, Plus, Trash2, User as UserIcon, Users as UsersIcon, Wallet, AlertTriangle, BellRing } from 'lucide-react';
import { UnpaidFees } from './FeesUnpaid';
import { fromMinor, toMinor } from '@sms/shared';
import { useAction, useGet, usePaged } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { del, downloadFile, getPaged, patch, post, put, qs } from '../services/api';
import { newId as newUuid } from '../services/uuid';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, StatCard, STATUS_TONE, Table, Tabs, Textarea, errorMessage } from '../components/ui';
import { useMoney, type Payment, type Voucher } from '../parent/common';
import { classroomOptions, useClassrooms } from './shared';

interface VoucherRow extends Voucher { studentName?: string; admissionNumber?: string; classroomName?: string }
interface VoucherDetail extends Voucher { student: { fullName: string; admissionNumber: string }; payments: (Payment & { reference?: string; receivedByName?: string; transactionRef?: string })[]; intents: { _id: string; status: string; amountMinor: number; createdAt: string; lastError?: string }[] }
interface Summary { currency: string; outstandingMinor: number; overdueCount: number; overdueMinor: number; collectedThisMonthMinor: number }

const thisPeriod = () => new Date().toISOString().slice(0, 7);

function useMsg() {
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  return { msg, ok: (text: string) => setMsg({ kind: 'success', text }), fail: (e: unknown, fb: string) => setMsg({ kind: 'error', text: errorMessage(e, fb) }), clear: () => setMsg(null) };
}

/**
 * One form for both cases: a voucher for the whole class at once, or for one student (found by
 * name). Fee lines are typed in rupees and sent in minor units.
 */
function VoucherForm({ onDone, onCancel }: { onDone: (text: string) => void; onCancel: () => void }) {
  const t = useT();
  const rooms = useClassrooms();
  const [mode, setMode] = useState<'single' | 'bulk'>('bulk');
  const [v, setV] = useState({ classroomId: '', studentId: '', title: '', period: thisPeriod(), dueDate: '', allowPartial: false, lateFee: '', discount: '', notes: '' });
  const [items, setItems] = useState([{ label: '', amount: '' }]);
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState<{ _id: string; fullName: string; admissionNumber: string; classroomName?: string }[]>([]);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (mode !== 'single' || (!search.trim() && !v.classroomId)) { setStudents([]); return; }
    const timer = setTimeout(() => {
      void getPaged<{ _id: string; fullName: string; admissionNumber: string; classroomName?: string }>(`/api/students${qs({ q: search.trim() || undefined, classroomId: v.classroomId || undefined, pageSize: 50 })}`)
        .then((r) => setStudents(r.items)).catch(() => setStudents([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, search, v.classroomId]);
  const total = items.reduce((a, i) => a + (Number(i.amount) || 0), 0) + (Number(v.lateFee) || 0) - (Number(v.discount) || 0);
  const valid = v.title && v.dueDate && /^\d{4}-\d{2}$/.test(v.period) && items.every((i) => i.label && Number(i.amount) >= 0 && i.amount !== '') && (mode === 'bulk' ? v.classroomId : v.studentId);
  const save = async () => {
    setBusy(true); setErr(null);
    const body = {
      title: v.title, period: v.period, dueDate: v.dueDate, allowPartial: v.allowPartial, notes: v.notes || null,
      items: items.map((i) => ({ label: i.label, amountMinor: toMinor(Number(i.amount)) })),
      lateFeeMinor: toMinor(Number(v.lateFee) || 0), discountMinor: toMinor(Number(v.discount) || 0)
    };
    try {
      if (mode === 'bulk') {
        const r = await post<{ created: number; skipped: number }>('/api/fees/vouchers/bulk', { ...body, classroomId: v.classroomId }, { 'Idempotency-Key': newUuid() });
        onDone(t('vouchersIssued', { created: r.created, skipped: r.skipped }));
      } else {
        await post('/api/fees/vouchers', { ...body, studentId: v.studentId });
        onDone(t('saved'));
      }
    } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      <fieldset>
        <legend className="label">{t('voucherFor')}</legend>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup">
          {([['bulk', UsersIcon, 'wholeClass', 'wholeClassHint'], ['single', UserIcon, 'oneStudent', 'oneStudentHint']] as const).map(([m, Icon, label, hint]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => { setMode(m); setV({ ...v, studentId: '' }); }}
              className={clsx('flex items-center gap-3 rounded-2xl border-2 p-4 text-start transition', mode === m ? 'border-brand bg-brand-soft' : 'border-surface-line bg-white hover:border-ink/20')}>
              <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', mode === m ? 'bg-brand text-white' : 'bg-surface-muted text-ink-soft')}><Icon className="h-5 w-5" /></span>
              <span><span className="block font-semibold">{t(label)}</span><span className="block text-sm text-ink-soft">{t(hint)}</span></span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {mode === 'bulk' ? (
          <Select className="sm:col-span-2" label={t('classroom')} value={v.classroomId} onChange={(e) => setV({ ...v, classroomId: e.target.value, studentId: '' })} placeholder="—" options={classroomOptions(rooms.data?.data)} />
        ) : <>
          <Input className="sm:col-span-2" label={t('oneStudent')} type="search" placeholder={t('searchStudentName')} value={search} onChange={(e) => { setSearch(e.target.value); setV({ ...v, studentId: '' }); }} />
          {students.length > 0 && (
            <div className="sm:col-span-2" role="listbox" aria-label={t('chooseStudent')}>
              <p className="label">{t('chooseStudent')}</p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {students.map((s) => (
                  <button key={s._id} type="button" role="option" aria-selected={v.studentId === s._id} onClick={() => setV({ ...v, studentId: s._id })}
                    className={clsx('flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-2.5 text-start transition', v.studentId === s._id ? 'border-brand bg-brand-soft' : 'border-surface-line hover:border-ink/20')}>
                    <span className="font-medium">{s.fullName}</span>
                    <span className="num text-sm text-ink-soft">{[s.admissionNumber, s.classroomName].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>}
        <Input label={t('feeTitle')} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={120} />
        <Input label={t('feePeriod')} type="month" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} />
        <Input label={t('dueDate')} type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} />
      </div>
      <fieldset className="space-y-2">
        <legend className="label">{t('feeItems')}</legend>
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <Input className="flex-1" aria-label={t('itemLabel')} placeholder={t('itemLabel')} value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="w-36" aria-label={t('amount')} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={it.amount} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <Button variant="ghost" aria-label={t('delete')} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setItems([...items, { label: '', amount: '' }])} disabled={items.length >= 20}><Plus className="h-4 w-4" />{t('addItem')}</Button>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('lateFee')} type="number" min={0} step="0.01" value={v.lateFee} onChange={(e) => setV({ ...v, lateFee: e.target.value })} />
        <Input label={t('discount')} type="number" min={0} step="0.01" value={v.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} />
      </div>
      <Textarea label={t('notes')} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={500} />
      <Checkbox label={t('allowPartial')} checked={v.allowPartial} onChange={(x) => setV({ ...v, allowPartial: x })} />
      <p className="text-sm">{t('totalAmount')}: <strong className="num">{Math.max(0, total).toLocaleString()}</strong></p>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>{t('cancel')}</Button><Button loading={busy} disabled={!valid} onClick={() => void save()}>{mode === 'bulk' ? t('issueVouchers') : t('createVoucher')}</Button></div>
    </div>
  );
}

function VoucherDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const can = useAuth((s) => s.can);
  const q = useGet<VoucherDetail>(`/api/fees/vouchers/${id}`);
  const [pay, setPay] = useState({ amount: '', method: 'cash', reference: '', paidAt: '' });
  const [cancelReason, setCancelReason] = useState('');
  const m = useMsg();
  const record = useAction(() => post(`/api/fees/vouchers/${id}/payments`, { amountMinor: toMinor(Number(pay.amount)), method: pay.method, reference: pay.reference || null, paidAt: pay.paidAt || undefined }, { 'Idempotency-Key': newUuid() }), ['/api/fees']);
  const cancel = useAction(() => post(`/api/fees/vouchers/${id}/cancel`, { reason: cancelReason }), ['/api/fees']);
  useEffect(() => { if (q.data) setPay((p) => ({ ...p, amount: p.amount || String(fromMinor(q.data!.data.balanceMinor)) })); }, [q.data]);
  const dl = (url: string, name: string) => downloadFile(url, name).catch((e) => m.fail(e, t('errorGeneric')));
  return (
    <Modal open onClose={onClose} title={q.data ? `${q.data.data.title} · ${q.data.data.voucherNumber}` : t('loading')} wide>
      {!q.data ? <Spinner /> : (() => {
        const v = q.data.data;
        const open = v.status === 'unpaid' || v.status === 'partial';
        return (
          <div className="space-y-5 text-sm">
            {m.msg && <Alert kind={m.msg.kind}>{m.msg.text}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{v.student.fullName}</span><span className="num text-ink-faint">{v.student.admissionNumber}</span>
              <Badge color={STATUS_TONE[v.status]}>{t(v.status as TKey)}</Badge>
              <Button variant="secondary" className="ms-auto" onClick={() => dl(`/api/fees/vouchers/${v._id}/pdf`, `voucher-${v.voucherNumber}.pdf`)}><Download className="h-4 w-4" />{t('download')}</Button>
            </div>
            <Table>
              <tbody>
                {v.items.map((i) => <tr key={i.label}><td>{i.label}</td><td className="num text-end">{money(i.amountMinor, v.currency)}</td></tr>)}
                {v.lateFeeMinor > 0 && <tr><td>{t('lateFee')}</td><td className="num text-end">{money(v.lateFeeMinor, v.currency)}</td></tr>}
                {v.discountMinor > 0 && <tr><td>{t('discount')}</td><td className="num text-end">-{money(v.discountMinor, v.currency)}</td></tr>}
                <tr className="font-semibold"><td>{t('totalAmount')}</td><td className="num text-end">{money(v.totalMinor, v.currency)}</td></tr>
                <tr><td>{t('paidAmount')}</td><td className="num text-end">{money(v.paidMinor, v.currency)}</td></tr>
                <tr className="font-semibold"><td>{t('balance')}</td><td className="num text-end">{money(v.balanceMinor, v.currency)}</td></tr>
              </tbody>
            </Table>
            {v.payments.length > 0 && (
              <div><p className="label">{t('paymentHistory')}</p>
                <ul className="divide-y divide-surface-line">{v.payments.map((p) => (
                  <li key={p._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><span className="num">{f.date(p.paidAt)}</span> · {t(p.method as TKey)} · <strong className="num">{money(p.amountMinor, p.currency)}</strong>{p.overpaidMinor ? <Badge color="amber">{t('overpaid')}: {money(p.overpaidMinor, p.currency)}</Badge> : null}<span className="block text-xs text-ink-faint">{p.receiptNumber}{p.reference ? ` · ${p.reference}` : ''}{p.transactionRef ? ` · ${p.transactionRef}` : ''}{p.receivedByName ? ` · ${p.receivedByName}` : ''}</span></span>
                    <Button variant="ghost" onClick={() => dl(`/api/fees/payments/${p._id}/receipt`, `receipt-${p.receiptNumber}.pdf`)}><Download className="h-4 w-4" />{t('receipt')}</Button>
                  </li>
                ))}</ul>
              </div>
            )}
            {v.intents.length > 0 && <p className="text-xs text-ink-faint">{t('payOnline')}: {v.intents.map((i) => `${f.dateTime(i.createdAt)} ${t(i.status as TKey)}`).join(' · ')}</p>}
            {open && can('fees.manage') && (
              <div className="rounded-xl border border-surface-line p-4">
                <p className="mb-3 font-medium">{t('recordPayment')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={`${t('amount')} (${v.currency})`} type="number" min={0} step="0.01" value={pay.amount} disabled={!v.allowPartial} onChange={(e) => setPay({ ...pay, amount: e.target.value })} hint={v.allowPartial ? undefined : t('allowPartial') + ': ' + t('no')} />
                  <Select label={t('paymentMethod')} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={(['cash', 'bank_transfer', 'cheque'] as const).map((x) => ({ value: x, label: t(x) }))} />
                  <Input label={t('reference')} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} maxLength={80} />
                  <Input label={t('paymentDate')} type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} />
                </div>
                <Button className="mt-3" loading={record.isPending} disabled={!(Number(pay.amount) > 0)} onClick={() => record.mutate(undefined, { onSuccess: () => { m.ok(t('saved')); void q.refetch(); }, onError: (e) => m.fail(e, t('errorGeneric')) })}><Wallet className="h-4 w-4" />{t('recordPayment')}</Button>
              </div>
            )}
            {open && v.paidMinor === 0 && can('fees.manage') && (
              <div className="flex flex-wrap items-end gap-2 border-t border-surface-line pt-4">
                <Input className="flex-1" label={t('cancelReason')} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                <Button variant="danger" disabled={cancelReason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => { m.ok(t('saved')); void q.refetch(); }, onError: (e) => m.fail(e, t('errorGeneric')) })}>{t('cancelVoucher')}</Button>
              </div>
            )}
          </div>
        );
      })()}
    </Modal>
  );
}

function Vouchers() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const can = useAuth((s) => s.can);
  const rooms = useClassrooms();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ q: '', classroomId: '', status: '', period: '', overdue: '' });
  const list = usePaged<VoucherRow>(`/api/fees/vouchers${qs({ page, pageSize: 25, ...filters })}`);
  const summary = useGet<Summary>('/api/fees/summary');
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const m = useMsg();
  const refresh = useAction(async () => undefined, ['/api/fees']);
  const reminders = useAction(() => post<{ queued: number; reason: string | null }>('/api/fees/reminders/run'), ['/api/sms']);
  const setF = (k: keyof typeof filters, v: string) => { setFilters({ ...filters, [k]: v }); setPage(1); };
  const s = summary.data?.data;
  return (
    <div className="space-y-5">
      {s && <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('outstandingFees')} value={money(s.outstandingMinor, s.currency)} icon={<Wallet className="h-5 w-5" />} />
        <StatCard label={t('overdueVouchers')} value={f.num(s.overdueCount)} hint={money(s.overdueMinor, s.currency)} icon={<AlertTriangle className="h-5 w-5" />} tone="red" />
        <StatCard label={t('collectedThisMonth')} value={money(s.collectedThisMonthMinor, s.currency)} icon={<Wallet className="h-5 w-5" />} tone="green" />
      </div>}
      {m.msg && <Alert kind={m.msg.kind}>{m.msg.text}</Alert>}
      <Card padded={false} title={t('vouchers')} actions={can('fees.manage') && <>
        <Button variant="secondary" loading={reminders.isPending} onClick={() => reminders.mutate(undefined, { onSuccess: (r) => (r.reason ? m.ok(`${t('remindersQueued', { n: r.queued })} (${r.reason})`) : m.ok(t('remindersQueued', { n: r.queued }))), onError: (e) => m.fail(e, t('errorGeneric')) })}><BellRing className="h-4 w-4" />{t('sendRemindersNow')}</Button>
        <Button onClick={() => setForm(true)}><Plus className="h-4 w-4" />{t('newFeeVoucher')}</Button>
      </>}>
        <div className="flex flex-wrap gap-2 border-b border-surface-line px-4 pt-4" role="tablist">
          {([['', '', 'filterAll', 'bg-brand text-white'], ['unpaid', '', 'filterUnpaid', 'bg-red-600 text-white'], ['partial', '', 'filterPartial', 'bg-amber-500 text-white'], ['paid', '', 'filterPaid', 'bg-emerald-600 text-white'], ['', 'true', 'filterOverdue', 'bg-rose-700 text-white']] as const).map(([st, od, label, activeCls]) => {
            const active = filters.status === st && filters.overdue === od;
            return <button key={label} type="button" role="tab" aria-selected={active} onClick={() => { setFilters({ ...filters, status: st, overdue: od }); setPage(1); }}
              className={clsx('rounded-full px-4 py-2 text-sm font-semibold transition', active ? activeCls : 'bg-surface-muted text-ink-soft hover:bg-surface-sunken')}>{t(label)}</button>;
          })}
        </div>
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input type="search" aria-label={t('search')} placeholder={`${t('search')}: ${t('name')} / ${t('voucherNo')}`} value={filters.q} onChange={(e) => setF('q', e.target.value)} />
          <Select aria-label={t('classroom')} value={filters.classroomId} onChange={(e) => setF('classroomId', e.target.value)} placeholder={`${t('classroom')}: ${t('all')}`} options={classroomOptions(rooms.data?.data)} />
          <Input aria-label={t('feePeriod')} type="month" value={filters.period} onChange={(e) => setF('period', e.target.value)} />
        </div>
        {list.isLoading ? <Spinner /> : list.isError ? <div className="p-5"><Alert kind="error">{errorMessage(list.error, t('errorGeneric'))}</Alert></div> : !list.data?.items.length ? <EmptyState /> : (
          <>
            <Table>
              <thead><tr><th>{t('voucherNo')}</th><th>{t('students')}</th><th>{t('feeTitle')}</th><th>{t('dueDate')}</th><th className="text-end">{t('totalAmount')}</th><th className="text-end">{t('balance')}</th><th>{t('status')}</th></tr></thead>
              <tbody>{list.data.items.map((v) => (
                <tr key={v._id} className="cursor-pointer hover:bg-surface-muted" onClick={() => setOpen(v._id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(v._id); }}>
                  <td className="num text-xs">{v.voucherNumber}</td>
                  <td><span className="font-medium">{v.studentName}</span><span className="block text-xs text-ink-faint">{v.classroomName}</span></td>
                  <td>{v.title} <span className="text-xs text-ink-faint">{v.period}</span></td>
                  <td className="num">{f.date(v.dueDate)} {v.overdue && <Badge color="red">{t('overdue')}</Badge>}</td>
                  <td className="num text-end">{money(v.totalMinor, v.currency)}</td><td className="num text-end font-medium">{money(v.balanceMinor, v.currency)}</td>
                  <td><Badge color={STATUS_TONE[v.status]}>{t(v.status as TKey)}</Badge></td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={form} onClose={() => setForm(false)} title={t('newFeeVoucher')} wide>
        {form && <VoucherForm onCancel={() => setForm(false)} onDone={(text) => { setForm(false); m.ok(text); refresh.mutate(undefined); }} />}
      </Modal>
      {open && <VoucherDetailModal id={open} onClose={() => { setOpen(null); refresh.mutate(undefined); }} />}
    </div>
  );
}

function Payments() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const [page, setPage] = useState(1);
  const [flt, setFlt] = useState({ from: '', to: '', method: '' });
  const q = useGet<{ items: (Payment & { studentName?: string; voucherNumber?: string; voucherTitle?: string })[]; totalAmountMinor: number }>(`/api/fees/payments${qs({ page, pageSize: 25, ...flt })}`);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data?.data;
  return (
    <Card padded={false} title={t('paymentHistory')} actions={d && <span className="text-sm">{t('totalAmount')}: <strong className="num">{money(d.totalAmountMinor, d.items[0]?.currency)}</strong></span>}>
      <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-3">
        <Input type="date" label={t('from')} value={flt.from} onChange={(e) => { setFlt({ ...flt, from: e.target.value }); setPage(1); }} />
        <Input type="date" label={t('to')} value={flt.to} onChange={(e) => { setFlt({ ...flt, to: e.target.value }); setPage(1); }} />
        <Select label={t('paymentMethod')} value={flt.method} onChange={(e) => { setFlt({ ...flt, method: e.target.value }); setPage(1); }} placeholder={t('all')} options={(['cash', 'bank_transfer', 'cheque', 'online'] as const).map((x) => ({ value: x, label: t(x) }))} />
      </div>
      {err && <div className="p-4"><Alert kind="error">{err}</Alert></div>}
      {q.isLoading ? <Spinner /> : !d?.items.length ? <EmptyState /> : (
        <>
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('receiptNo')}</th><th>{t('students')}</th><th>{t('voucherNo')}</th><th>{t('paymentMethod')}</th><th className="text-end">{t('amount')}</th><th /></tr></thead>
            <tbody>{d.items.map((p) => (
              <tr key={p._id}><td className="num">{f.date(p.paidAt)}</td><td className="num text-xs">{p.receiptNumber}</td><td>{p.studentName}</td><td className="num text-xs">{p.voucherNumber}</td><td>{t(p.method as TKey)}</td><td className="num text-end">{money(p.amountMinor, p.currency)}</td>
                <td className="text-end"><Button variant="ghost" onClick={() => downloadFile(`/api/fees/payments/${p._id}/receipt`, `receipt-${p.receiptNumber}.pdf`).catch((e) => setErr(errorMessage(e, t('errorGeneric'))))}><Download className="h-4 w-4" /></Button></td></tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={25} total={q.data?.meta?.total ?? 0} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

interface FeeSettingsData {
  fees: { currency: string; reminderDaysBefore: number; remindersEnabled: boolean; voucherFooter?: string };
  provider: { provider: string; source: string; currency: string; problems: string[]; configured: boolean; stripe: { secretKeySet: boolean; mode: string | null; webhookSecretSet: boolean } | null; webhookUrl: string };
}

function FeeSettings() {
  const t = useT();
  const can = useAuth((s) => s.can);
  const q = useGet<FeeSettingsData>('/api/fees/settings');
  const [fs, setFs] = useState<FeeSettingsData['fees'] | null>(null);
  const [pv, setPv] = useState({ provider: 'none', secretKey: '', webhookSecret: '', currency: 'pkr' });
  const m = useMsg();
  useEffect(() => { if (q.data && !fs) { setFs(q.data.data.fees); setPv((p) => ({ ...p, provider: q.data!.data.provider.provider, currency: q.data!.data.provider.currency })); } }, [q.data, fs]);
  const saveFees = useAction(() => patch('/api/fees/settings', { ...fs, voucherFooter: fs?.voucherFooter || null }), ['/api/fees']);
  const saveProvider = useAction(() => put('/api/fees/provider', pv.provider === 'none' ? { provider: 'none' } : pv), ['/api/fees/settings']);
  const resetProvider = useAction(() => del('/api/fees/provider'), ['/api/fees/settings']);
  if (!q.data || !fs) return <Spinner />;
  const p = q.data.data.provider;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {m.msg && <div className="lg:col-span-2"><Alert kind={m.msg.kind}>{m.msg.text}</Alert></div>}
      <Card title={t('feeSettings')}>
        <div className="space-y-4">
          <Input label={t('currency')} value={fs.currency} maxLength={3} onChange={(e) => setFs({ ...fs, currency: e.target.value.toUpperCase() })} hint="ISO 4217, e.g. PKR" />
          <Checkbox label={t('remindersEnabled')} checked={fs.remindersEnabled} onChange={(x) => setFs({ ...fs, remindersEnabled: x })} />
          <Input label={t('reminderDaysBefore')} type="number" min={0} max={60} value={fs.reminderDaysBefore} onChange={(e) => setFs({ ...fs, reminderDaysBefore: Number(e.target.value) })} />
          <Textarea label={t('voucherFooter')} value={fs.voucherFooter ?? ''} maxLength={300} onChange={(e) => setFs({ ...fs, voucherFooter: e.target.value })} />
          {can('fees.manage') && <Button loading={saveFees.isPending} onClick={() => saveFees.mutate(undefined, { onSuccess: () => m.ok(t('saved')), onError: (e) => m.fail(e, t('errorGeneric')) })}>{t('save')}</Button>}
        </div>
      </Card>
      <Card title={t('paymentProvider')} actions={<Badge color={p.configured ? 'green' : 'amber'}>{p.configured ? t('providerConfigured') : t('providerNotConfigured')}</Badge>}>
        <div className="space-y-4 text-sm">
          {!p.configured && <Alert kind="warning">{p.problems.join(' · ')}</Alert>}
          <p className="text-ink-soft">{t('paymentProviderHelp')}</p>
          {p.stripe?.mode && <p>Stripe: <Badge color={p.stripe.mode === 'live' ? 'green' : 'amber'}>{p.stripe.mode}</Badge> <span className="text-xs text-ink-faint">({p.source})</span></p>}
          <p>{t('webhookUrl')}: <code className="break-all text-xs">{p.webhookUrl}</code> <span className="text-xs text-ink-faint">(events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired)</span></p>
          {can('payments.configure') ? <>
            <Alert kind="info">{t('secretsWriteOnly')}</Alert>
            <Select label={t('paymentProvider')} value={pv.provider} onChange={(e) => setPv({ ...pv, provider: e.target.value })} options={[{ value: 'none', label: 'None' }, { value: 'stripe', label: 'Stripe Checkout' }]} />
            {pv.provider === 'stripe' && <div className="grid gap-3">
              <Input label="Secret key" type="password" autoComplete="off" value={pv.secretKey} onChange={(e) => setPv({ ...pv, secretKey: e.target.value })} placeholder={p.stripe?.secretKeySet ? '•••••• (set)' : 'sk_live_… / sk_test_…'} />
              <Input label="Webhook signing secret" type="password" autoComplete="off" value={pv.webhookSecret} onChange={(e) => setPv({ ...pv, webhookSecret: e.target.value })} placeholder={p.stripe?.webhookSecretSet ? '•••••• (set)' : 'whsec_…'} />
              <Input label={t('currency')} value={pv.currency} maxLength={3} onChange={(e) => setPv({ ...pv, currency: e.target.value.toLowerCase() })} hint="Must match the voucher currency" />
            </div>}
            <div className="flex flex-wrap gap-2">
              <Button loading={saveProvider.isPending} onClick={() => saveProvider.mutate(undefined, { onSuccess: () => { m.ok(t('saved')); setPv((x) => ({ ...x, secretKey: '', webhookSecret: '' })); }, onError: (e) => m.fail(e, t('errorGeneric')) })}>{t('save')}</Button>
              {p.source === 'dashboard' && <Button variant="secondary" loading={resetProvider.isPending} onClick={() => resetProvider.mutate(undefined, { onSuccess: () => m.ok(t('providerReset')), onError: (e) => m.fail(e, t('errorGeneric')) })}>Use environment defaults</Button>}
            </div>
          </> : null}
        </div>
      </Card>
    </div>
  );
}

export default function Fees() {
  const t = useT();
  const [tab, setTab] = useState<'unpaid' | 'vouchers' | 'payments' | 'settings'>('unpaid');
  return (
    <div>
      <PageHeader title={t('navFees')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'unpaid', label: t('unpaidFeesTab') }, { value: 'vouchers', label: t('vouchers') }, { value: 'payments', label: t('paymentHistory') }, { value: 'settings', label: t('feeSettings') }]} />
      {tab === 'unpaid' && <UnpaidFees />}{tab === 'vouchers' && <Vouchers />}{tab === 'payments' && <Payments />}{tab === 'settings' && <FeeSettings />}
    </div>
  );
}
