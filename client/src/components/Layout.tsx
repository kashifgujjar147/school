import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, Users, School, UserCog, ClipboardCheck, FileEdit, Contact, MessageSquare, BarChart3, Settings,
  ShieldCheck, Activity, DatabaseBackup, RefreshCw, Globe, Menu, X, LogOut, KeyRound, Cloud, CloudOff, CheckCircle2, AlertTriangle, BookOpen, History,
  Wallet, GraduationCap, NotebookPen, LineChart, IdCard, Home, Bell, CalendarClock, CalendarDays, ChevronRight
} from 'lucide-react';
import type { Permission } from '@sms/shared';
import { useAuth } from '../store/auth';
import { useConnectivity } from '../store/connectivity';
import { useOutbox, flushOutbox, discardOutboxItem, requeueOutboxItem } from '../sync/outbox';
import { db, type OutboxItem } from '../offline/db';
import { useLang, useT, useFormat, type TKey } from '../i18n';
import { signOut } from '../services/session';
import { Alert, Badge, Button, Modal } from './ui';
import { logoOf, splitSchoolName } from '../brand';

interface NavItem { to: string; label: TKey; icon: ReactNode; perm?: Permission; standard?: boolean; group?: TKey }

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'navOverview', icon: <LayoutDashboard />, perm: 'dashboard.view' },
  { to: '/admin/students', label: 'navStudents', icon: <Users />, perm: 'students.view', group: 'navGroupPeople' },
  { to: '/admin/users', label: 'navUsers', icon: <UserCog />, perm: 'users.view', group: 'navGroupPeople' },
  { to: '/admin/guardians', label: 'navGuardians', icon: <Contact />, perm: 'guardians.view', standard: true, group: 'navGroupPeople' },
  { to: '/admin/id-cards', label: 'navIdCards', icon: <IdCard />, perm: 'idcards.manage', group: 'navGroupPeople' },
  { to: '/admin/classrooms', label: 'navClassrooms', icon: <School />, perm: 'classrooms.view', group: 'navGroupAcademics' },
  { to: '/admin/timetable', label: 'navTimetable', icon: <CalendarClock />, perm: 'timetable.view', group: 'navGroupAcademics' },
  { to: '/admin/attendance', label: 'navAttendance', icon: <ClipboardCheck />, perm: 'attendance.view_all', group: 'navGroupAcademics' },
  { to: '/admin/corrections', label: 'navCorrections', icon: <FileEdit />, perm: 'corrections.review', group: 'navGroupAcademics' },
  { to: '/admin/exams', label: 'navExams', icon: <GraduationCap />, perm: 'exams.view', group: 'navGroupAcademics' },
  { to: '/admin/homework', label: 'navHomework', icon: <NotebookPen />, perm: 'homework.view', group: 'navGroupAcademics' },
  { to: '/admin/fees', label: 'navFees', icon: <Wallet />, perm: 'fees.view', group: 'navGroupFinance' },
  { to: '/admin/reports', label: 'navReports', icon: <BarChart3 />, perm: 'reports.view', group: 'navGroupInsights' },
  { to: '/admin/analytics', label: 'navAnalytics', icon: <LineChart />, perm: 'analytics.view', group: 'navGroupInsights' },
  { to: '/admin/sms', label: 'navSms', icon: <MessageSquare />, perm: 'sms.view', standard: true, group: 'navGroupEngagement' },
  { to: '/admin/website', label: 'navWebsite', icon: <Globe />, perm: 'website.manage', group: 'navGroupEngagement' },
  { to: '/admin/settings', label: 'navSettings', icon: <Settings />, perm: 'settings.view', group: 'navGroupSystem' },
  { to: '/admin/security', label: 'navSecurity', icon: <ShieldCheck />, perm: 'security.view', group: 'navGroupSystem' },
  { to: '/admin/health', label: 'navHealth', icon: <Activity />, perm: 'system.view', group: 'navGroupSystem' },
  { to: '/admin/backups', label: 'navBackups', icon: <DatabaseBackup />, perm: 'backups.manage', group: 'navGroupSystem' },
  { to: '/admin/sync', label: 'navSync', icon: <RefreshCw />, perm: 'sync.view', group: 'navGroupSystem' }
];

const TEACHER_NAV: NavItem[] = [
  { to: '/teacher', label: 'navMyClasses', icon: <BookOpen /> },
  { to: '/teacher/timetable', label: 'navMyTimetable', icon: <CalendarDays /> },
  { to: '/teacher/history', label: 'navHistory', icon: <History /> },
  { to: '/teacher/corrections', label: 'navCorrections', icon: <FileEdit /> },
  { to: '/teacher/homework', label: 'navHomework', icon: <NotebookPen />, perm: 'homework.manage' },
  { to: '/teacher/results', label: 'navExams', icon: <GraduationCap />, perm: 'results.enter' }
];

const STUDENT_NAV: NavItem[] = [
  { to: '/student', label: 'navMyTimetable', icon: <CalendarDays /> }
];

const PARENT_NAV: NavItem[] = [
  { to: '/parent', label: 'navParentHome', icon: <Home /> },
  { to: '/parent/notifications', label: 'navNotifications', icon: <Bell /> }
];

/** Everything saved on this device while offline: what is waiting, what was sent, what was refused. */
function OutboxPanel({ onClose }: { onClose: () => void }) {
  const t = useT(); const f = useFormat();
  const userId = useAuth((s) => s.user?.id);
  const { flushing } = useOutbox();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const load = useCallback(async () => {
    if (!userId) return;
    setItems((await db.outbox.where('userId').equals(userId).toArray()).sort((a, b) => b.createdAt - a.createdAt));
  }, [userId]);
  useEffect(() => { void load(); }, [load, flushing]);
  useEffect(() => useOutbox.subscribe(() => void load()), [load]);
  const tone: Record<OutboxItem['status'], 'amber' | 'blue' | 'green' | 'red'> = { pending: 'amber', sending: 'blue', synced: 'green', conflict: 'red', failed: 'red', auth_required: 'amber' };
  const label: Record<OutboxItem['status'], TKey> = { pending: 'offlinePending', sending: 'syncing', synced: 'offlineSent', conflict: 'needsAttention', failed: 'needsAttention', auth_required: 'signInAgainToSync' };
  return (
    <Modal open onClose={onClose} title={t('offlineQueue')} wide footer={<><Button variant="secondary" onClick={onClose}>{t('close')}</Button><Button loading={flushing} onClick={() => void flushOutbox()}><RefreshCw className="h-4 w-4" />{t('syncNow')}</Button></>}>
      <p className="mb-4 text-sm text-ink-soft">{t('offlineQueueHint')}</p>
      {items.length === 0 ? <p className="py-8 text-center text-sm text-ink-faint">{t('allSynced')}</p> : (
        <ul className="divide-y divide-surface-line rounded-xl border border-surface-line">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{i.label}</p>
                <p className="num text-xs text-ink-faint">{f.dateTime(new Date(i.createdAt))}{i.attempts > 0 ? ` · ${i.attempts}×` : ''}</p>
                {i.lastError && i.status !== 'synced' && <p className="mt-1 text-xs text-red-700">{i.lastError}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge color={tone[i.status]}>{t(label[i.status])}</Badge>
                {(i.status === 'failed' || i.status === 'conflict') && <Button variant="secondary" onClick={() => void requeueOutboxItem(i.id).then(() => flushOutbox())}>{t('retry')}</Button>}
                {i.status !== 'sending' && <Button variant="ghost" onClick={() => { if (i.status === 'synced' || window.confirm(t('offlineDiscardConfirm'))) void discardOutboxItem(i.id); }}>{t('delete')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function ConnectionIndicator() {
  const t = useT();
  const { browserOnline, serverReachable } = useConnectivity();
  const { pending, needsAttention, flushing } = useOutbox();
  const offlineSession = useAuth((s) => s.offlineSession);
  const connected = browserOnline && serverReachable && !offlineSession;
  const [panel, setPanel] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {panel && <OutboxPanel onClose={() => setPanel(false)} />}
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', connected ? 'bg-emerald-50 text-emerald-800 ring-emerald-700/15' : 'bg-amber-50 text-amber-900 ring-amber-700/20')} role="status" aria-live="polite">
        {connected ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {connected ? t('online') : !browserOnline ? t('offline') : t('serverUnreachable')}
      </span>
      {pending > 0 && (
        <button onClick={() => { if (connected) void flushOutbox(); setPanel(true); }} className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-700/15 transition hover:bg-sky-100" title={t('offlineQueue')}>
          <RefreshCw className={clsx('h-3.5 w-3.5', flushing && 'animate-spin')} />{flushing ? t('syncing') : t('pendingSync', { n: pending })}
        </button>
      )}
      {needsAttention > 0 && <button onClick={() => setPanel(true)} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 ring-1 ring-inset ring-red-700/15 transition hover:bg-red-100"><AlertTriangle className="h-3.5 w-3.5" />{needsAttention} {t('needsAttention')}</button>}
      {pending === 0 && needsAttention === 0 && connected && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label={t('allSynced')} />}
    </div>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-full border border-surface-line bg-white p-0.5 text-xs shadow-card" role="group" aria-label="Language">
      {(['en', 'ur'] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} className={clsx('rounded-full px-2.5 py-1 font-medium transition duration-200', lang === l ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink')} aria-pressed={lang === l}>
          {l === 'en' ? 'EN' : 'اردو'}
        </button>
      ))}
    </div>
  );
}

export function CacheNotice({ fromCache }: { fromCache?: { savedAt: number } }) {
  const t = useT(); const f = useFormat();
  if (!fromCache) return null;
  return <div className="mb-4"><Alert kind="warning">{t('cachedDataNotice', { time: f.dateTime(new Date(fromCache.savedAt)) })}</Alert></div>;
}

function initials(name?: string) {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '•';
}

function Shell({ nav, variant }: { nav: NavItem[]; variant: 'admin' | 'teacher' | 'parent' | 'student' }) {
  const t = useT();
  const navigate = useNavigate();
  const loc = useLocation();
  const { user, config, can, needsReauth } = useAuth();
  const [open, setOpen] = useState(false);
  const items = nav.filter((n) => (!n.perm || can(n.perm)) && (!n.standard || config?.package === 'standard'));
  const home = `/${variant}`;
  const current = items.filter((n) => loc.pathname === n.to || (n.to !== home && loc.pathname.startsWith(`${n.to}/`))).sort((a, b) => b.to.length - a.to.length)[0];
  const area = variant === 'admin' ? t('adminDashboard') : variant === 'parent' ? t('parentPortal') : variant === 'student' ? t('studentPortal') : t('teacherPortal');
  const loginPath = variant === 'parent' ? '/parent/login' : variant === 'student' ? '/student/login' : '/login';
  // Re-animate on real page changes only (nested CMS / timetable routes keep their state).
  const pageKey = loc.pathname.split('/').slice(0, 3).join('/');
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const groups: { label?: TKey; items: NavItem[] }[] = [];
  for (const n of items) {
    const last = groups[groups.length - 1];
    if (last && last.label === n.group) last.items.push(n); else groups.push({ label: n.group, items: [n] });
  }

  const linkCls = ({ isActive }: { isActive: boolean }) => clsx(
    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] font-medium transition duration-200 ease-lux [&>svg]:h-[17px] [&>svg]:w-[17px] [&>svg]:shrink-0',
    isActive ? 'bg-white/[0.09] text-white [&>svg]:text-accent' : 'text-white/60 hover:bg-white/[0.05] hover:text-white [&>svg]:text-white/45 hover:[&>svg]:text-white/80'
  );
  const [schoolMain, schoolSub] = splitSchoolName(config?.schoolName ?? t('appName'));
  const side = (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <img src={logoOf(config?.logoUrl)} alt="" className="h-12 w-12 shrink-0 rounded-full bg-white object-contain p-0.5 shadow-[0_0_0_3px_rgb(var(--accent)/0.25)]" />
        <div className="min-w-0">
          <p className="line-clamp-2 font-serif text-[1.08rem] font-semibold leading-[1.15] text-white">{schoolMain}</p>
          <p className="eyebrow mt-1 truncate !text-accent/90">{schoolSub ? `${schoolSub} · ${area}` : area}</p>
        </div>
      </div>
      <div className="mx-5 h-px bg-night-line" aria-hidden />
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-5 [scrollbar-width:thin]">
        {groups.map((g, gi) => (
          <div key={g.label ?? `g${gi}`} className="space-y-0.5">
            {g.label && <p className="eyebrow px-3 pb-1.5 text-white/30">{t(g.label)}</p>}
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === home} className={linkCls}>
                {({ isActive }) => <>
                  <span className={clsx('absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-accent transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} aria-hidden />
                  {n.icon}<span className="truncate">{t(n.label)}</span>
                </>}
              </NavLink>
            ))}
          </div>
        ))}
        {variant === 'admin' && user?.permissions.includes('attendance.mark') && (
          <div className="space-y-0.5"><NavLink to="/teacher" className={linkCls({ isActive: false })}><ClipboardCheck />{t('markAttendance')}</NavLink></div>
        )}
      </div>
      <div className="border-t border-night-line px-3 pb-3 pt-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white ring-1 ring-inset ring-white/15">{initials(user?.fullName)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{user?.fullName}</p>
            <p className="truncate text-2xs text-white/40" title={`v${config?.version} · ${config?.package} · ${config?.mode}`}>{user ? t(user.role) : ''} · v{config?.version}</p>
          </div>
          <NavLink to={`/${variant}/account`} title={t('changePassword')} aria-label={t('changePassword')} className={({ isActive }) => clsx('rounded-lg p-2 transition', isActive ? 'bg-white/10 text-accent' : 'text-white/45 hover:bg-white/[0.07] hover:text-white')}><KeyRound className="h-4 w-4" /></NavLink>
          <button onClick={async () => { await signOut(); navigate(loginPath); }} title={t('signOut')} aria-label={t('signOut')} className="rounded-lg p-2 text-white/45 transition hover:bg-white/[0.07] hover:text-white"><LogOut className="h-4 w-4 rtl:rotate-180" /></button>
        </div>
        <button onClick={async () => { await signOut(true); navigate(loginPath); }} className="mt-1 w-full px-2 text-start text-2xs text-white/30 underline-offset-2 transition hover:text-white/60 hover:underline">Shared device? Sign out &amp; remove offline data</button>
      </div>
    </nav>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[17rem] shrink-0 bg-night lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 animate-fade-in bg-night/50 backdrop-blur-[2px]" />
          <aside className="absolute inset-y-0 start-0 w-[18rem] max-w-[85vw] animate-drawer-in bg-night shadow-overlay [--drawer-from:-100%] rtl:[--drawer-from:100%]" onClick={(e) => e.stopPropagation()}>{side}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-surface-line bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button className="rounded-xl p-2 text-ink-soft transition hover:bg-surface-muted hover:text-ink lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
            <div className="hidden min-w-0 items-center gap-2 text-sm md:flex" aria-label="Breadcrumb">
              <span className="truncate text-ink-faint">{area}</span>
              {current && current.to !== home && <><ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint/70 rtl:rotate-180" aria-hidden /><span className="truncate font-medium text-ink">{t(current.label)}</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ConnectionIndicator />
            <LangSwitch />
            <div className="hidden items-center gap-2.5 border-s border-surface-line ps-3 sm:flex">
              <div className="text-end"><p className="text-sm font-medium leading-tight text-ink">{user?.fullName}</p><p className="text-2xs text-ink-faint">{user ? t(user.role) : ''}</p></div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white ring-2 ring-white">{initials(user?.fullName)}</div>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {needsReauth && <div className="mb-4"><Alert kind="warning">{t('signInAgainToSync')} <button className="font-medium underline" onClick={() => navigate('/login?reauth=1')}>{t('signIn')}</button></Alert></div>}
          <div key={pageKey} className="page-enter"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

export const AdminLayout = () => <Shell nav={ADMIN_NAV} variant="admin" />;
export const TeacherLayout = () => <Shell nav={TEACHER_NAV} variant="teacher" />;
export const ParentLayout = () => <Shell nav={PARENT_NAV} variant="parent" />;
export const StudentLayout = () => <Shell nav={STUDENT_NAV} variant="student" />;
