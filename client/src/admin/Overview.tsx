import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  AlertTriangle, BarChart3, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck, FileEdit, Globe, GraduationCap,
  IdCard, MessageSquare, NotebookPen, School, UserPlus, UserX, Users, Wallet
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { Permission } from '@sms/shared';
import { useGet } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { Alert, Card, EmptyState, ErrorState, Spinner, CHART, chartTooltip } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { useMoney } from '../parent/common';

interface OverviewData {
  date: string; schoolDay: boolean;
  totals: { students: number; activeStudents: number; teachers: number; classrooms: number };
  today: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null };
  submissions: { submitted: number; total: number; missing: { id: string; name: string }[] };
  pendingCorrections: number;
  trend: { date: string; present: number; absent: number; late: number; leave: number; percent: number | null }[];
}
interface FeeSummary { currency: string; outstandingMinor: number; overdueCount: number; overdueMinor: number; collectedThisMonthMinor: number }

type Tone = 'navy' | 'sky' | 'green' | 'amber' | 'violet' | 'rose';
const TONES: Record<Tone, string> = {
  navy: 'bg-brand text-white',
  sky: 'bg-sky-100 text-sky-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  violet: 'bg-violet-100 text-violet-700',
  rose: 'bg-rose-100 text-rose-700'
};

interface Action { to: string; label: TKey; hint: TKey; icon: ReactNode; tone: Tone; perm?: Permission; standard?: boolean; primary?: boolean }
/** The everyday jobs, in plain words. Shown only when the signed-in user is allowed to do them. */
const ACTIONS: Action[] = [
  { to: '/admin/students?add=1', label: 'actAddStudent', hint: 'actAddStudentHint', icon: <UserPlus />, tone: 'navy', perm: 'students.manage', primary: true },
  { to: '/admin/students', label: 'actStudents', hint: 'actStudentsHint', icon: <Users />, tone: 'sky', perm: 'students.view' },
  { to: '/admin/attendance', label: 'actAttendance', hint: 'actAttendanceHint', icon: <ClipboardCheck />, tone: 'green', perm: 'attendance.view_all' },
  { to: '/teacher', label: 'actMarkAttendance', hint: 'actMarkAttendanceHint', icon: <CheckCircle2 />, tone: 'green', perm: 'attendance.mark' },
  { to: '/admin/fees', label: 'actFees', hint: 'actFeesHint', icon: <Wallet />, tone: 'amber', perm: 'fees.view' },
  { to: '/admin/exams', label: 'actResults', hint: 'actResultsHint', icon: <GraduationCap />, tone: 'violet', perm: 'exams.view' },
  { to: '/admin/homework', label: 'actHomework', hint: 'actHomeworkHint', icon: <NotebookPen />, tone: 'rose', perm: 'homework.view' },
  { to: '/admin/id-cards', label: 'actIdCards', hint: 'actIdCardsHint', icon: <IdCard />, tone: 'sky', perm: 'idcards.manage' },
  { to: '/admin/sms', label: 'actSms', hint: 'actSmsHint', icon: <MessageSquare />, tone: 'green', perm: 'sms.view', standard: true },
  { to: '/admin/timetable', label: 'actTimetable', hint: 'actTimetableHint', icon: <CalendarClock />, tone: 'violet', perm: 'timetable.view' },
  { to: '/admin/reports', label: 'actReports', hint: 'actReportsHint', icon: <BarChart3 />, tone: 'amber', perm: 'reports.view' },
  { to: '/admin/website', label: 'actWebsite', hint: 'actWebsiteHint', icon: <Globe />, tone: 'navy', perm: 'website.manage' }
];

/** Home for school staff: big plain-language buttons, the four numbers that matter, and what needs attention today. */
export default function Overview() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const { config, user, can } = useAuth();
  const q = useGet<OverviewData>('/api/system/overview', { refetchInterval: 30_000 });
  const fees = useGet<FeeSummary>(can('fees.view') ? '/api/fees/summary' : null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  const fs = fees.data?.data;
  // At most 8 big buttons: the jobs done most often. Everything else stays in the side menu.
  // "Mark attendance" only for people who cannot already see the whole school's attendance.
  const actions = ACTIONS.filter((a) => (!a.perm || can(a.perm)) && (!a.standard || config?.package === 'standard') && !(a.to === '/teacher' && can('attendance.view_all'))).slice(0, 8);
  const trend = d.trend.map((x) => ({ ...x, label: f.date(x.date).replace(/^\d{4}-|\/\d{4}$/, '') }));
  const first = user?.fullName.split(' ')[0] ?? '';
  const missing = d.submissions.missing;

  const attention: { key: string; icon: ReactNode; text: ReactNode; to: string; tone: 'amber' | 'red' }[] = [];
  if (d.schoolDay && missing.length > 0 && can('attendance.view_all')) attention.push({ key: 'att', icon: <ClipboardCheck />, tone: 'amber', to: '/admin/attendance', text: <>{t('homeMissingAttendance', { n: missing.length })}: <strong>{missing.slice(0, 6).map((m) => m.name).join(', ')}{missing.length > 6 ? '…' : ''}</strong></> });
  if (d.today.absent + d.today.late > 0 && can('attendance.view_all')) attention.push({ key: 'abs', icon: <UserX />, tone: 'amber', to: '/admin/attendance?tab=alerts', text: t('homeAbsentToday', { absent: d.today.absent, late: d.today.late }) });
  if (d.pendingCorrections > 0 && can('corrections.review')) attention.push({ key: 'corr', icon: <FileEdit />, tone: 'amber', to: '/admin/corrections', text: t('homeCorrectionsWaiting', { n: d.pendingCorrections }) });
  if (fs && fs.overdueCount > 0) attention.push({ key: 'fees', icon: <Wallet />, tone: 'red', to: '/admin/fees', text: t('homeOverdueFees', { n: fs.overdueCount, amount: money(fs.overdueMinor, fs.currency) }) });

  return (
    <div className="space-y-8">
      <CacheNotice fromCache={q.data.fromCache} />

      {/* Greeting */}
      <section>
        <p className="text-sm font-semibold text-accent">{f.date(d.date)} · {config?.schoolName}</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold text-ink sm:text-4xl">{t('welcomeBack', { name: first })}</h1>
        <p className="mt-2 text-lg text-ink-soft">{t('homeQuestion')}</p>
      </section>
      {!d.schoolDay && <Alert kind="info">{t('homeNoSchoolToday')}</Alert>}

      {/* What do you want to do? */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.to + a.label} to={a.to}
            className={clsx('group flex min-h-[8.5rem] flex-col justify-between gap-4 rounded-2xl border p-4 shadow-card transition duration-300 ease-lux hover:-translate-y-0.5 hover:shadow-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 sm:p-5',
              a.primary ? 'border-transparent bg-gradient-to-br from-brand to-brand-deep text-white' : 'border-surface-line bg-white text-ink hover:border-ink/15')}>
            <span className={clsx('flex h-12 w-12 items-center justify-center rounded-2xl [&>svg]:h-6 [&>svg]:w-6', a.primary ? 'bg-white/15 text-white ring-1 ring-inset ring-white/20' : TONES[a.tone])}>{a.icon}</span>
            <span>
              <span className="flex items-center gap-1 text-[1.05rem] font-semibold leading-snug">{t(a.label)}<ChevronRight className="h-4 w-4 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-80 rtl:rotate-180" aria-hidden /></span>
              <span className={clsx('mt-0.5 block text-sm leading-snug', a.primary ? 'text-white/75' : 'text-ink-soft')}>{t(a.hint)}</span>
            </span>
          </Link>
        ))}
      </section>

      {/* The numbers that matter */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Big to="/admin/students" icon={<Users />} tone="sky" label={t('homeStudents')} value={f.num(d.totals.students)} foot={t('homeActiveStudents', { n: f.num(d.totals.activeStudents) })} />
        <Big to="/admin/attendance" icon={<ClipboardCheck />} tone="green" label={t('homePresentToday')}
          value={d.today.total ? f.num(d.today.present + d.today.late) : '—'}
          foot={d.today.total ? `${t('homeOfStudents', { n: f.num(d.today.total) })} · ${f.pct(d.today.percent)}` : t('homeNotMarkedYet')} />
        {fs ? <Big to="/admin/fees" icon={<Wallet />} tone="amber" label={t('homeFeesDue')} value={money(fs.outstandingMinor, fs.currency)} foot={t('homeCollectedMonth', { amount: money(fs.collectedThisMonthMinor, fs.currency) })} />
          : <Big to="/admin/classrooms" icon={<School />} tone="violet" label={t('classrooms')} value={f.num(d.totals.classrooms)} foot={`${t('teachers')}: ${f.num(d.totals.teachers)}`} />}
        <Big to="/admin/attendance" icon={<CheckCircle2 />} tone={missing.length ? 'amber' : 'green'} label={t('homeClassesMarked')}
          value={<>{f.num(d.submissions.submitted)}<span className="text-xl text-ink-faint"> / {f.num(d.submissions.total)}</span></>}
          bar={d.submissions.total ? d.submissions.submitted / d.submissions.total : 0} />
      </section>

      {/* Needs attention + attendance trend */}
      <section className="grid gap-4 lg:grid-cols-5">
        <Card title={<span className="flex items-center gap-2 text-lg"><AlertTriangle className="h-5 w-5 text-amber-500" />{t('homeAttention')}</span>} className="lg:col-span-2">
          {attention.length === 0 ? (
            <p className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />{t('homeAllGood')}</p>
          ) : (
            <ul className="space-y-3">{attention.map((a) => (
              <li key={a.key} className={clsx('flex items-center gap-3 rounded-xl p-3.5', a.tone === 'red' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900')}>
                <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{a.icon}</span>
                <span className="min-w-0 flex-1 text-[0.95rem] leading-snug">{a.text}</span>
                <Link to={a.to} className="btn-secondary shrink-0 !min-h-0 px-3 py-1.5">{t('homeOpen')}</Link>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title={<span className="text-lg">{t('homeAttendanceTrend')}</span>} className="lg:col-span-3">
          {trend.length === 0 ? <EmptyState /> : (
            <div className="h-60" dir="ltr">
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ left: -16, right: 8, top: 8 }}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity={0.22} /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 13, fill: CHART.tick }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 13, fill: CHART.tick }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip {...chartTooltip} formatter={(v: number) => `${v}%`} />
                  <Area type="monotone" dataKey="percent" name={t('attendanceRate')} stroke="rgb(var(--brand))" strokeWidth={2.5} fill="url(#g)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function Big({ to, icon, tone, label, value, foot, bar }: { to: string; icon: ReactNode; tone: Tone; label: string; value: ReactNode; foot?: ReactNode; bar?: number }) {
  return (
    <Link to={to} className="card card-interactive flex flex-col items-start gap-3 p-5">
      <span className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl [&>svg]:h-6 [&>svg]:w-6', TONES[tone])}>{icon}</span>
      <span className="w-full min-w-0">
        <span className="block text-[0.95rem] font-medium text-ink-soft">{label}</span>
        <span className="num mt-1 block whitespace-nowrap text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink">{value}</span>
        {foot && <span className="mt-1 block text-sm leading-snug text-ink-soft">{foot}</span>}
        {bar !== undefined && <span className="mt-2.5 block h-2 overflow-hidden rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-700 ease-lux" style={{ width: `${Math.round(bar * 100)}%` }} /></span>}
      </span>
    </Link>
  );
}
