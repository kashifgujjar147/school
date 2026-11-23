import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, ClipboardCheck, Download, GraduationCap, Megaphone, NotebookPen, Wallet } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { downloadFile } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Spinner, errorMessage } from '../components/ui';
import { Avatar, useMoney } from '../parent/common';
import { useL } from '../timetable/common';

interface Dashboard {
  today: string;
  student: { _id: string; fullName: string; admissionNumber: string; photoPath: string | null; className: string; sectionName: string; sessionName: string };
  attendance: { present: number; absent: number; late: number; leave: number; total: number; percent: number | null };
  latestResult: { examId: string; name: string; percent: number | null; grade: string; passed: boolean } | null;
  fees: { outstandingMinor: number; currency: string; overdue: number; nextDue: { dueDate: string; title: string } | null };
  homework: { _id: string; subject: string; title: string; dueDate: string }[];
  announcements: { _id: string; title: string; body: string; publishedAt: string; pinned: boolean }[];
  events: { _id: string; date: string; title: string; location: string }[];
  idCards: boolean;
}

/** Student portal home: own summary (attendance, latest result, fees, homework), notices and the ID card. */
export default function StudentHome() {
  const t = useT(); const f = useFormat(); const money = useMoney(); const L = useL();
  const q = useGet<Dashboard>('/api/student/dashboard', { refetchInterval: 60_000 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data.data; const s = d.student;
  const first = s.fullName.split(/\s+/)[0];
  const card = async () => {
    setBusy(true); setErr(null);
    try { await downloadFile('/api/student/id-card', `id-card-${s.admissionNumber}.pdf`); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      {/* Welcome band */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-night via-brand-deep to-brand p-6 text-white shadow-lg sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 h-64 w-64 rounded-full border-[18px] border-white/5" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 end-24 h-48 w-48 rounded-full bg-accent/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="rounded-full p-[3px] ring-2 ring-accent/80"><Avatar name={s.fullName} photo={s.photoPath} size="h-20 w-20" /></div>
          <div className="min-w-[12rem] flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{f.date(d.today)}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{L(`Welcome, ${first}`, `خوش آمدید، ${first}`)}</h1>
            <p className="num mt-1 text-sm text-white/75">{[s.className, s.sectionName].filter(Boolean).join(' · ')} · {s.admissionNumber}{s.sessionName ? ` · ${s.sessionName}` : ''}</p>
          </div>
          {d.idCards && <Button variant="secondary" loading={busy} onClick={() => void card()} className="w-full shrink-0 sm:w-auto"><Download className="h-4 w-4" />{L('My ID card', 'میرا آئی ڈی کارڈ')}</Button>}
        </div>
      </section>
      {err && <Alert kind="error">{err}</Alert>}

      {/* Key numbers */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat to="/student/attendance" icon={<ClipboardCheck />} label={t('attendance30')} value={f.pct(d.attendance.percent)}
          foot={<span className="num">{t('absent')}: {d.attendance.absent} · {t('late')}: {d.attendance.late}</span>} />
        <Stat to="/student/results" icon={<GraduationCap />} label={t('latestResult')}
          value={d.latestResult ? <>{f.pct(d.latestResult.percent)} <span className="text-base text-ink-soft">{d.latestResult.grade}</span></> : '—'}
          foot={d.latestResult ? <span className="truncate">{d.latestResult.name}</span> : L('No published result yet', 'ابھی کوئی نتیجہ شائع نہیں ہوا')} />
        <Stat to="/student/fees" icon={<Wallet />} label={t('outstandingFees')} value={money(d.fees.outstandingMinor, d.fees.currency)}
          foot={d.fees.overdue > 0 ? <Badge color="red">{t('overdueCount', { n: d.fees.overdue })}</Badge>
            : d.fees.nextDue ? <>{t('nextDue')}: {f.date(d.fees.nextDue.dueDate)}</> : <span className="text-emerald-700">{t('nothingDue')}</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><NotebookPen className="h-4 w-4 text-ink-faint" />{t('upcomingHomework')}</span>} actions={<Link to="/student/homework" className="text-sm text-brand">→</Link>}>
          {d.homework.length === 0 ? <EmptyState>{t('noHomework')}</EmptyState> : (
            <ul className="space-y-2.5 text-sm">{d.homework.map((h) => (
              <li key={h._id} className="flex justify-between gap-3"><span className="min-w-0"><Badge color="blue">{h.subject}</Badge> <span className="ms-1">{h.title}</span></span><span className="num shrink-0 text-xs text-ink-faint">{f.date(h.dueDate)}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-ink-faint" />{t('announcementsTitle')}</span>}>
          {d.announcements.length === 0 ? <EmptyState /> : (
            <ul className="space-y-4">{d.announcements.map((a) => (
              <li key={a._id}><p className="font-medium">{a.title} {a.pinned && <Badge color="violet">★</Badge>}</p><p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-ink-soft">{a.body}</p><p className="mt-1 text-xs text-ink-faint">{f.dateTime(a.publishedAt)}</p></li>
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

function Stat({ to, icon, label, value, foot }: { to: string; icon: React.ReactElement; label: string; value: React.ReactNode; foot: React.ReactNode }) {
  return (
    <Link to={to} className="card group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-md">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand to-accent opacity-70" />
      <p className="flex items-center gap-2 text-xs font-medium text-ink-soft"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand [&>svg]:h-4 [&>svg]:w-4">{icon}</span>{label}<ChevronRight className="ms-auto h-4 w-4 text-ink-faint transition group-hover:translate-x-0.5 rtl:rotate-180" /></p>
      <p className="num mt-3 text-2xl font-semibold">{value}</p>
      <div className="mt-1 text-xs text-ink-faint">{foot}</div>
    </Link>
  );
}
