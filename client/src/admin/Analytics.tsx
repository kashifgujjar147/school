import { useState } from 'react';
import { GraduationCap, UserCheck, Users, Wallet, AlertTriangle, Briefcase } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { fromMinor } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { qs } from '../services/api';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner, StatCard, Table } from '../components/ui';
import { useMoney } from '../parent/common';
import { useClasses } from './shared';
import { shiftIso, todayIso } from '../teacher/common';

interface Period { from: string; to: string; attendancePercent: number | null; attendanceRecords: number; collectedMinor: number; issuedMinor: number; admissions: number }
interface Data {
  range: { from: string; to: string; granularity: 'day' | 'month' };
  currency: string;
  totals: { activeStudents: number; teachers: number; staff: number; classrooms: number; studentsByStatus: Record<string, number> };
  attendance: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null; trend: { period: string; percent: number | null; total: number }[]; byClassroom: { classroomId: string; classroomName: string; className: string; total: number; absent: number; late: number; percent: number | null }[] };
  fees: { collectedMinor: number; issuedMinor: number; outstandingMinor: number; outstandingVouchers: number; overdueMinor: number; overdueVouchers: number; collectionTrend: { period: string; amountMinor: number }[]; byMethod: { method: string; amountMinor: number; payments: number }[] };
  exams: { examId: string; name: string; startDate: string; published: boolean; students: number; averagePercent: number | null; passRate: number | null }[];
  enrollment: { trend: { month: string; admissions: number }[]; admissionsInRange: number };
  comparison: { current: Period; previous: Period; lastYear: Period };
}

function Delta({ now, before, money }: { now: number | null; before: number | null; money?: boolean }) {
  if (now === null || before === null) return <span className="text-ink-faint">—</span>;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return <span className="text-ink-faint">±0</span>;
  return <span className={d > 0 ? 'text-emerald-700' : 'text-red-700'}>{d > 0 ? '▲' : '▼'} {money ? Math.abs(fromMinor(d)).toLocaleString() : Math.abs(d)}</span>;
}

export default function Analytics() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const tz = useAuth((s) => s.config?.timeZone);
  const today = todayIso(tz);
  const [range, setRange] = useState({ from: `${today.slice(0, 8)}01`, to: today });
  const [classId, setClassId] = useState('');
  const classes = useClasses();
  const valid = range.from && range.to && range.from <= range.to;
  const q = useGet<Data>(valid ? `/api/analytics/summary${qs({ ...range, classId })}` : null);
  const preset = (p: 'month' | '90' | 'year') => setRange(p === 'month' ? { from: `${today.slice(0, 8)}01`, to: today } : p === '90' ? { from: shiftIso(today, -89), to: today } : { from: `${today.slice(0, 4)}-01-01`, to: today });
  const d = q.data?.data;
  const label = (p: string) => (p.length === 7 ? p : f.date(p).replace(/^\d{4}-|\/\d{4}$/, ''));
  return (
    <div className="space-y-6">
      <PageHeader title={t('navAnalytics')} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Input type="date" label={t('from')} value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input type="date" label={t('to')} value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <Select label={t('class')} value={classId} onChange={(e) => setClassId(e.target.value)} placeholder={t('allClasses')} options={(classes.data?.data ?? []).map((c) => ({ value: c._id, label: c.name }))} />
          <div className="flex gap-1">
            <button className="btn-secondary" onClick={() => preset('month')}>{t('thisMonth')}</button>
            <button className="btn-secondary" onClick={() => preset('90')}>{t('last90')}</button>
            <button className="btn-secondary" onClick={() => preset('year')}>{t('thisYear')}</button>
          </div>
        </div>
      </Card>
      {!valid ? <Card><EmptyState>{t('from')} ≤ {t('to')}</EmptyState></Card> : q.isLoading ? <Spinner /> : q.isError || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('activeStudents')} value={f.num(d.totals.activeStudents)} hint={`${t('admissions')}: ${f.num(d.enrollment.admissionsInRange)}`} icon={<Users className="h-5 w-5" />} />
            <StatCard label={t('teachers')} value={f.num(d.totals.teachers)} hint={`${t('staffMembers')}: ${f.num(d.totals.staff)} · ${t('classrooms')}: ${f.num(d.totals.classrooms)}`} icon={<Briefcase className="h-5 w-5" />} tone="violet" />
            <StatCard label={t('attendanceRate')} value={f.pct(d.attendance.percent)} hint={`${f.num(d.attendance.total)} · ${t('absent')}: ${f.num(d.attendance.absent)}`} icon={<UserCheck className="h-5 w-5" />} tone="green" />
            <StatCard label={t('collected')} value={money(d.fees.collectedMinor, d.currency)} hint={`${t('outstandingFees')}: ${money(d.fees.outstandingMinor, d.currency)}`} icon={<Wallet className="h-5 w-5" />} tone="blue" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card title={t('attendanceTrend')} className="lg:col-span-2">
              {d.attendance.trend.length === 0 ? <EmptyState /> : (
                <div className="h-64" dir="ltr">
                  <ResponsiveContainer>
                    <AreaChart data={d.attendance.trend.map((x) => ({ ...x, label: label(x.period) }))} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity={0.25} /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                      <Tooltip formatter={(v: number) => `${v}%`} />
                      <Area type="monotone" dataKey="percent" name={t('attendanceRate')} stroke="rgb(var(--brand))" strokeWidth={2} fill="url(#ga)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title={t('comparisons')}>
              <Table>
                <thead><tr><th /><th className="text-end">{t('currentPeriod')}</th><th className="text-end">{t('previousPeriod')}</th><th className="text-end">{t('lastYear')}</th></tr></thead>
                <tbody>
                  <tr><td>{t('attendanceRate')}</td><td className="num text-end">{f.pct(d.comparison.current.attendancePercent)}</td><td className="num text-end">{f.pct(d.comparison.previous.attendancePercent)}<br /><span className="text-xs"><Delta now={d.comparison.current.attendancePercent} before={d.comparison.previous.attendancePercent} /></span></td><td className="num text-end">{f.pct(d.comparison.lastYear.attendancePercent)}</td></tr>
                  <tr><td>{t('collected')}</td><td className="num text-end">{money(d.comparison.current.collectedMinor, d.currency)}</td><td className="num text-end">{money(d.comparison.previous.collectedMinor, d.currency)}<br /><span className="text-xs"><Delta now={d.comparison.current.collectedMinor} before={d.comparison.previous.collectedMinor} money /></span></td><td className="num text-end">{money(d.comparison.lastYear.collectedMinor, d.currency)}</td></tr>
                  <tr><td>{t('issued')}</td><td className="num text-end">{money(d.comparison.current.issuedMinor, d.currency)}</td><td className="num text-end">{money(d.comparison.previous.issuedMinor, d.currency)}</td><td className="num text-end">{money(d.comparison.lastYear.issuedMinor, d.currency)}</td></tr>
                  <tr><td>{t('admissions')}</td><td className="num text-end">{d.comparison.current.admissions}</td><td className="num text-end">{d.comparison.previous.admissions}</td><td className="num text-end">{d.comparison.lastYear.admissions}</td></tr>
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-ink-faint">{f.date(d.comparison.previous.from)} – {f.date(d.comparison.previous.to)} · {f.date(d.comparison.lastYear.from)} – {f.date(d.comparison.lastYear.to)}</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title={t('classwiseAttendance')} padded={false}>
              {d.attendance.byClassroom.length === 0 ? <EmptyState /> : (
                <Table>
                  <thead><tr><th>{t('classroom')}</th><th className="text-end">{t('absent')}</th><th className="text-end">{t('late')}</th><th className="text-end">%</th></tr></thead>
                  <tbody>{d.attendance.byClassroom.map((r) => (
                    <tr key={r.classroomId}><td><span className="font-medium">{r.classroomName}</span></td><td className="num text-end">{r.absent}</td><td className="num text-end">{r.late}</td>
                      <td className="text-end"><div className="flex items-center justify-end gap-2"><div className="hidden h-2 w-24 overflow-hidden rounded-full bg-surface-muted sm:block"><div className="h-full rounded-full bg-brand" style={{ width: `${r.percent ?? 0}%` }} /></div><span className="num">{f.pct(r.percent)}</span></div></td></tr>
                  ))}</tbody>
                </Table>
              )}
            </Card>
            <Card title={t('feeCollection')}>
              <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-surface-muted p-3"><p className="text-ink-soft">{t('outstandingFees')}</p><p className="num text-lg font-semibold">{money(d.fees.outstandingMinor, d.currency)}</p><p className="text-xs text-ink-faint">{d.fees.outstandingVouchers} {t('vouchers')}</p></div>
                <div className="rounded-xl bg-red-50 p-3"><p className="flex items-center gap-1 text-red-800"><AlertTriangle className="h-3.5 w-3.5" />{t('overdue')}</p><p className="num text-lg font-semibold text-red-900">{money(d.fees.overdueMinor, d.currency)}</p><p className="text-xs text-red-800">{d.fees.overdueVouchers} {t('vouchers')}</p></div>
              </div>
              {d.fees.collectionTrend.length === 0 ? <EmptyState /> : (
                <div className="h-48" dir="ltr">
                  <ResponsiveContainer>
                    <BarChart data={d.fees.collectionTrend.map((x) => ({ label: label(x.period), amount: fromMinor(x.amountMinor) }))} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" /><XAxis dataKey="label" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: number) => v.toLocaleString()} />
                      <Bar dataKey="amount" name={t('collected')} fill="rgb(var(--brand))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {d.fees.byMethod.length > 0 && <div className="mt-3 flex flex-wrap gap-2 text-xs">{d.fees.byMethod.map((m) => <Badge key={m.method}>{t(m.method as TKey)}: {money(m.amountMinor, d.currency)} ({m.payments})</Badge>)}</div>}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title={t('examPerformance')} padded={false}>
              {d.exams.length === 0 ? <EmptyState /> : (
                <Table>
                  <thead><tr><th>{t('examName')}</th><th className="text-end">{t('students')}</th><th className="text-end">{t('averageScore')}</th><th className="text-end">{t('passRate')}</th></tr></thead>
                  <tbody>{d.exams.map((e) => <tr key={e.examId}><td><GraduationCap className="me-1 inline h-4 w-4 text-ink-faint" />{e.name} <span className="text-xs text-ink-faint">{f.date(e.startDate)}</span> {!e.published && <Badge>{t('notPublished')}</Badge>}</td><td className="num text-end">{e.students}</td><td className="num text-end">{f.pct(e.averagePercent)}</td><td className="num text-end">{f.pct(e.passRate)}</td></tr>)}</tbody>
                </Table>
              )}
            </Card>
            <Card title={t('enrollmentTrend')}>
              {d.enrollment.trend.length === 0 ? <EmptyState /> : (
                <div className="h-56" dir="ltr">
                  <ResponsiveContainer>
                    <BarChart data={d.enrollment.trend} margin={{ left: -20, right: 8, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 12 }} /><Tooltip />
                      <Bar dataKey="admissions" name={t('admissions')} fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">{Object.entries(d.totals.studentsByStatus).map(([k, v]) => <Badge key={k}>{t(k as TKey)}: {v}</Badge>)}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
