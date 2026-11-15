import { Link } from 'react-router-dom';
import { Users, UserCheck, GraduationCap, School, AlertTriangle, FileEdit, MessageSquare, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from 'recharts';
import { useGet } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { useAuth } from '../store/auth';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, CHART, chartTooltip } from '../components/ui';
import { CacheNotice } from '../components/Layout';

interface OverviewData {
  date: string; schoolDay: boolean;
  totals: { students: number; activeStudents: number; teachers: number; classrooms: number };
  today: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null };
  submissions: { submitted: number; total: number; missing: { id: string; name: string }[] };
  pendingCorrections: number;
  trend: { date: string; present: number; absent: number; late: number; leave: number; percent: number | null }[];
  recentActivity: { _id: string; action: string; actorName?: string; at: string }[];
  notifications: Record<string, number> | null;
  mode: string;
  sync: { state: string; pending: number; failed: number; conflicts: number; lastSuccessAt: string | null } | null;
}

export default function Overview() {
  const t = useT(); const f = useFormat();
  const config = useAuth((s) => s.config);
  const user = useAuth((s) => s.user);
  const q = useGet<OverviewData>('/api/system/overview', { refetchInterval: 30_000 });
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  // Short axis label in the school's date format, without the year (DD/MM, MM/DD or MM-DD).
  const trend = d.trend.map((x) => ({ ...x, label: f.date(x.date).replace(/^\d{4}-|\/\d{4}$/, '') }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={user ? t('welcomeBack', { name: user.fullName.split(' ')[0] ?? user.fullName }) : undefined} title={t('navOverview')} subtitle={`${config?.schoolName ?? ''} · ${f.date(d.date)}`} />
      <CacheNotice fromCache={q.data.fromCache} />
      {!d.schoolDay && <Alert kind="info">{t('notSchoolDay')}</Alert>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('totalStudents')} value={f.num(d.totals.students)} hint={`${t('activeStudents')}: ${f.num(d.totals.activeStudents)}`} icon={<Users className="h-5 w-5" />} />
        <StatCard label={t('teachers')} value={f.num(d.totals.teachers)} icon={<GraduationCap className="h-5 w-5" />} tone="violet" />
        <StatCard label={t('classrooms')} value={f.num(d.totals.classrooms)} icon={<School className="h-5 w-5" />} tone="blue" />
        <StatCard label={t('attendanceRate')} value={f.pct(d.today.percent)} hint={t('todaysAttendance')} icon={<UserCheck className="h-5 w-5" />} tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('todaysAttendance')} className="lg:col-span-1">
          {d.today.total === 0 ? <EmptyState title={t('notSubmitted')} /> : (
            <div className="grid grid-cols-2 gap-3">
              {(['present', 'absent', 'late', 'leave'] as const).map((s) => (
                <div key={s} className="rounded-xl border border-surface-line bg-surface-muted/60 p-4">
                  <p className="flex items-center gap-2 text-xs font-medium text-ink-soft"><span className="h-2 w-2 rounded-full" style={{ background: s === 'present' ? CHART.present : CHART[s] }} aria-hidden />{t(s)}</p>
                  <p className="num mt-1 text-2xl font-semibold">{f.num(d.today[s])}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-sm"><span className="font-medium">{t('submissions')}</span><span className="num text-ink-soft">{t('submittedOf', { done: d.submissions.submitted, total: d.submissions.total })}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-deep transition-all duration-700 ease-lux" style={{ width: `${d.submissions.total ? (d.submissions.submitted / d.submissions.total) * 100 : 0}%` }} /></div>
          </div>
        </Card>

        <Card title={`${t('attendanceRate')} — ${t('last14Days')}`} className="lg:col-span-2">
          {trend.length === 0 ? <EmptyState /> : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--brand))" stopOpacity={0.22} /><stop offset="100%" stopColor="rgb(var(--brand))" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip {...chartTooltip} formatter={(v: number) => `${v}%`} />
                  <Area type="monotone" dataKey="percent" name={t('attendanceRate')} stroke="rgb(var(--brand))" strokeWidth={2.25} fill="url(#g)" activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />{t('missingAttendance')}</span>}>
          {d.submissions.missing.length === 0 ? <p className="text-sm text-emerald-700">✓ {t('submittedOf', { done: d.submissions.submitted, total: d.submissions.total })}</p> : (
            <ul className="flex flex-wrap gap-2">{d.submissions.missing.map((m) => <li key={m.id}><Badge color="amber">{m.name}</Badge></li>)}</ul>
          )}
        </Card>
        <Card title={t('pendingCorrections')} actions={<Link to="/admin/corrections" className="text-sm text-brand">{t('review')} →</Link>}>
          <div className="flex items-center gap-3"><FileEdit className="h-8 w-8 text-ink-faint" /><p className="num text-3xl font-semibold">{d.pendingCorrections}</p></div>
        </Card>
        {d.notifications ? (
          <Card title={t('notificationsToday')} actions={<Link to="/admin/sms" className="text-sm text-brand">→</Link>}>
            <div className="flex flex-wrap gap-2"><MessageSquare className="h-5 w-5 text-ink-faint" />{Object.entries(d.notifications).length === 0 ? <span className="text-sm text-ink-soft">0</span> : Object.entries(d.notifications).map(([k, v]) => <Badge key={k}>{t(k as never)}: {v}</Badge>)}</div>
          </Card>
        ) : d.sync ? (
          <Card title={t('syncStatus')} actions={<Link to="/admin/sync" className="text-sm text-brand">→</Link>}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><RefreshCw className="h-5 w-5 text-ink-faint" /><Badge color={d.sync.state === 'online' ? 'green' : 'amber'}>{d.sync.state}</Badge><span>{t('pendingSync', { n: d.sync.pending })}</span>{d.sync.conflicts > 0 && <Badge color="red">{t('conflicts')}: {d.sync.conflicts}</Badge>}</div>
          </Card>
        ) : <Card title={t('mode')}><Badge>{d.mode}</Badge></Card>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('last14Days')} className="lg:col-span-2">
          {trend.length === 0 ? <EmptyState /> : (
            <div className="h-64" dir="ltr">
              <ResponsiveContainer>
                <BarChart data={trend} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 12, fill: CHART.tick }} axisLine={false} tickLine={false} allowDecimals={false} /><Tooltip {...chartTooltip} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="absent" name={t('absent')} stackId="a" fill={CHART.absent} /><Bar dataKey="late" name={t('late')} stackId="a" fill={CHART.late} /><Bar dataKey="leave" name={t('leave')} stackId="a" fill={CHART.leave} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title={t('recentActivity')}>
          {d.recentActivity.length === 0 ? <EmptyState /> : (
            <ul className="divide-y divide-surface-line text-sm">{d.recentActivity.map((a) => <li key={a._id} className="flex justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><span><span className="font-medium">{a.actorName ?? 'system'}</span> <span className="text-ink-soft">{a.action}</span></span><span className="shrink-0 text-xs text-ink-faint">{f.dateTime(a.at)}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
