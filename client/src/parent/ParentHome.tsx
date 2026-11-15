import { Link } from 'react-router-dom';
import { Bell, CalendarDays, ClipboardCheck, GraduationCap, Megaphone, NotebookPen, Wallet } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner, STATUS_TONE } from '../components/ui';
import { Avatar, useMoney, type ChildSummary } from './common';

interface DashChild extends ChildSummary {
  attendance: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null };
  latestResult: { examId: string; name: string; percent: number | null; grade: string; passed: boolean } | null;
  fees: { outstandingMinor: number; currency: string; overdue: number; nextDue: { voucherId: string; dueDate: string; balanceMinor: number; title: string } | null };
  homework: { _id: string; subject: string; title: string; dueDate: string }[];
}
interface Dashboard {
  today: string;
  children: DashChild[];
  announcements: { _id: string; title: string; body: string; publishedAt: string; pinned: boolean }[];
  notifications: { _id: string; event: string; channel?: string; status: string; body: string; createdAt: string }[];
  events: { _id: string; slug: string; date: string; title: string; location: string }[];
}

export default function ParentHome() {
  const t = useT(); const f = useFormat(); const money = useMoney();
  const q = useGet<Dashboard>('/api/parent/dashboard', { refetchInterval: 60_000 });
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data;
  return (
    <div className="space-y-6">
      <PageHeader title={t('myChildren')} subtitle={f.date(d.today)} />
      {d.children.length === 0 ? <Card><EmptyState>{t('noChildrenLinked')}</EmptyState></Card> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {d.children.map((c) => (
            <article key={c._id} className="card overflow-hidden">
              <header className="flex items-center gap-4 border-b border-surface-line p-5">
                <Avatar name={c.fullName} photo={c.photoPath} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{c.fullName}</h2>
                  <p className="text-sm text-ink-soft">{[c.className, c.sectionName].filter(Boolean).join(' · ')} <span className="num text-ink-faint">· {c.admissionNumber}</span></p>
                </div>
                <Link to={`/parent/children/${c._id}`} className="btn-secondary shrink-0">{t('viewDetails')}</Link>
              </header>
              <div className="grid grid-cols-2 gap-px bg-surface-line sm:grid-cols-3">
                <Link to={`/parent/children/${c._id}?tab=attendance`} className="bg-white p-4 hover:bg-surface-muted">
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft"><ClipboardCheck className="h-3.5 w-3.5" />{t('attendance30')}</p>
                  <p className="num mt-1 text-2xl font-semibold">{f.pct(c.attendance.percent)}</p>
                  <p className="num text-xs text-ink-faint">{t('absent')}: {c.attendance.absent} · {t('late')}: {c.attendance.late}</p>
                </Link>
                <Link to={`/parent/children/${c._id}?tab=results`} className="bg-white p-4 hover:bg-surface-muted">
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft"><GraduationCap className="h-3.5 w-3.5" />{t('latestResult')}</p>
                  {c.latestResult ? <>
                    <p className="num mt-1 text-2xl font-semibold">{f.pct(c.latestResult.percent)} <span className="text-base text-ink-soft">{c.latestResult.grade}</span></p>
                    <p className="truncate text-xs text-ink-faint">{c.latestResult.name}</p>
                  </> : <p className="mt-1 text-sm text-ink-faint">—</p>}
                </Link>
                <Link to={`/parent/children/${c._id}?tab=fees`} className="col-span-2 bg-white p-4 hover:bg-surface-muted sm:col-span-1">
                  <p className="flex items-center gap-1.5 text-xs text-ink-soft"><Wallet className="h-3.5 w-3.5" />{t('outstandingFees')}</p>
                  <p className="num mt-1 text-2xl font-semibold">{money(c.fees.outstandingMinor, c.fees.currency)}</p>
                  {c.fees.overdue > 0 ? <Badge color="red">{t('overdueCount', { n: c.fees.overdue })}</Badge>
                    : c.fees.nextDue ? <p className="text-xs text-ink-faint">{t('nextDue')}: {f.date(c.fees.nextDue.dueDate)}</p>
                    : <p className="text-xs text-emerald-700">{t('nothingDue')}</p>}
                </Link>
              </div>
              <div className="p-5">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><NotebookPen className="h-4 w-4 text-ink-faint" />{t('upcomingHomework')}</p>
                {c.homework.length === 0 ? <p className="text-sm text-ink-faint">{t('noHomework')}</p> : (
                  <ul className="space-y-1.5 text-sm">{c.homework.map((h) => <li key={h._id} className="flex justify-between gap-3"><span className="min-w-0 truncate"><span className="font-medium">{h.subject}:</span> {h.title}</span><span className="num shrink-0 text-xs text-ink-faint">{f.date(h.dueDate)}</span></li>)}</ul>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-ink-faint" />{t('announcementsTitle')}</span>} className="lg:col-span-1">
          {d.announcements.length === 0 ? <EmptyState /> : (
            <ul className="space-y-4">{d.announcements.map((a) => (
              <li key={a._id}><p className="font-medium">{a.title} {a.pinned && <Badge color="violet">★</Badge>}</p><p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{a.body}</p><p className="mt-1 text-xs text-ink-faint">{f.dateTime(a.publishedAt)}</p></li>
            ))}</ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Bell className="h-4 w-4 text-ink-faint" />{t('recentNotifications')}</span>} actions={<Link to="/parent/notifications" className="text-sm text-brand">→</Link>}>
          {d.notifications.length === 0 ? <EmptyState /> : (
            <ul className="space-y-3 text-sm">{d.notifications.map((n) => (
              <li key={n._id}><div className="flex flex-wrap items-center gap-2"><Badge>{t(n.event as TKey)}</Badge><Badge color={STATUS_TONE[n.status]}>{t(n.status as TKey)}</Badge><span className="text-xs text-ink-faint">{t((n.channel ?? 'sms') as TKey)} · {f.dateTime(n.createdAt)}</span></div><p className="mt-1 line-clamp-2 text-ink-soft">{n.body}</p></li>
            ))}</ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-ink-faint" />{t('upcomingEvents')}</span>}>
          {d.events.length === 0 ? <EmptyState /> : (
            <ul className="space-y-3 text-sm">{d.events.map((e) => (
              <li key={e._id} className="flex gap-3"><span className="num w-20 shrink-0 text-xs font-medium text-brand">{f.date(e.date)}</span><span><span className="font-medium">{e.title}</span>{e.location && <span className="block text-xs text-ink-faint">{e.location}</span>}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
