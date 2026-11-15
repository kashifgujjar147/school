import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, Users, School, UserCog, ClipboardCheck, FileEdit, Contact, MessageSquare, BarChart3, Settings,
  ShieldCheck, Activity, DatabaseBackup, RefreshCw, Globe, Menu, X, LogOut, KeyRound, Cloud, CloudOff, CheckCircle2, AlertTriangle, BookOpen, History
} from 'lucide-react';
import type { Permission } from '@sms/shared';
import { useAuth } from '../store/auth';
import { useConnectivity } from '../store/connectivity';
import { useOutbox, flushOutbox } from '../sync/outbox';
import { useLang, useT, useFormat, type TKey } from '../i18n';
import { signOut } from '../services/session';
import { Alert } from './ui';

interface NavItem { to: string; label: TKey; icon: ReactNode; perm?: Permission; standard?: boolean }

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'navOverview', icon: <LayoutDashboard />, perm: 'dashboard.view' },
  { to: '/admin/students', label: 'navStudents', icon: <Users />, perm: 'students.view' },
  { to: '/admin/classrooms', label: 'navClassrooms', icon: <School />, perm: 'classrooms.view' },
  { to: '/admin/users', label: 'navUsers', icon: <UserCog />, perm: 'users.view' },
  { to: '/admin/attendance', label: 'navAttendance', icon: <ClipboardCheck />, perm: 'attendance.view_all' },
  { to: '/admin/corrections', label: 'navCorrections', icon: <FileEdit />, perm: 'corrections.review' },
  { to: '/admin/guardians', label: 'navGuardians', icon: <Contact />, perm: 'guardians.view', standard: true },
  { to: '/admin/sms', label: 'navSms', icon: <MessageSquare />, perm: 'sms.view', standard: true },
  { to: '/admin/reports', label: 'navReports', icon: <BarChart3 />, perm: 'reports.view' },
  { to: '/admin/settings', label: 'navSettings', icon: <Settings />, perm: 'settings.view' },
  { to: '/admin/website', label: 'navWebsite', icon: <Globe />, perm: 'website.manage' },
  { to: '/admin/security', label: 'navSecurity', icon: <ShieldCheck />, perm: 'security.view' },
  { to: '/admin/health', label: 'navHealth', icon: <Activity />, perm: 'system.view' },
  { to: '/admin/backups', label: 'navBackups', icon: <DatabaseBackup />, perm: 'backups.manage' },
  { to: '/admin/sync', label: 'navSync', icon: <RefreshCw />, perm: 'sync.view' }
];

const TEACHER_NAV: NavItem[] = [
  { to: '/teacher', label: 'navMyClasses', icon: <BookOpen /> },
  { to: '/teacher/history', label: 'navHistory', icon: <History /> },
  { to: '/teacher/corrections', label: 'navCorrections', icon: <FileEdit /> }
];

export function ConnectionIndicator() {
  const t = useT();
  const { browserOnline, serverReachable } = useConnectivity();
  const { pending, needsAttention, flushing } = useOutbox();
  const offlineSession = useAuth((s) => s.offlineSession);
  const connected = browserOnline && serverReachable && !offlineSession;
  return (
    <div className="flex items-center gap-2">
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', connected ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')} role="status" aria-live="polite">
        {connected ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {connected ? t('online') : !browserOnline ? t('offline') : t('serverUnreachable')}
      </span>
      {pending > 0 && (
        <button onClick={() => void flushOutbox()} disabled={!connected || flushing} className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 disabled:opacity-80" title={t('syncNow')}>
          <RefreshCw className={clsx('h-3.5 w-3.5', flushing && 'animate-spin')} />{flushing ? t('syncing') : t('pendingSync', { n: pending })}
        </button>
      )}
      {needsAttention > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700"><AlertTriangle className="h-3.5 w-3.5" />{needsAttention} {t('needsAttention')}</span>}
      {pending === 0 && needsAttention === 0 && connected && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label={t('allSynced')} />}
    </div>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-lg border border-surface-line bg-white p-0.5 text-xs" role="group" aria-label="Language">
      {(['en', 'ur'] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} className={clsx('rounded-md px-2.5 py-1 font-medium', lang === l ? 'bg-brand text-white' : 'text-ink-soft')} aria-pressed={lang === l}>
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

function Shell({ nav, variant }: { nav: NavItem[]; variant: 'admin' | 'teacher' }) {
  const t = useT();
  const navigate = useNavigate();
  const { user, config, can, needsReauth } = useAuth();
  const [open, setOpen] = useState(false);
  const items = nav.filter((n) => (!n.perm || can(n.perm)) && (!n.standard || config?.package === 'standard'));
  const side = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Main">
      <div className="mb-4 flex items-center gap-3 px-2 pt-2">
        {config?.logoUrl ? <img src={config.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" /> : <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">{config?.schoolName?.[0] ?? 'S'}</div>}
        <div className="min-w-0"><p className="truncate text-sm font-semibold">{config?.schoolName ?? t('appName')}</p><p className="text-xs text-ink-faint">{variant === 'admin' ? t('navOverview') : t('navMyClasses')}</p></div>
      </div>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === '/admin' || n.to === '/teacher'} onClick={() => setOpen(false)}
          className={({ isActive }) => clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition [&>svg]:h-[18px] [&>svg]:w-[18px]', isActive ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted hover:text-ink')}>
          {n.icon}<span>{t(n.label)}</span>
        </NavLink>
      ))}
      <div className="mt-auto border-t border-surface-line pt-3">
        {variant === 'admin' && user?.permissions.includes('attendance.mark') && <NavLink to="/teacher" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:bg-surface-muted"><ClipboardCheck className="h-[18px] w-[18px]" />{t('markAttendance')}</NavLink>}
        <NavLink to="/change-password" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:bg-surface-muted"><KeyRound className="h-[18px] w-[18px]" />{t('changePassword')}</NavLink>
        <button onClick={async () => { await signOut(); navigate('/login'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft hover:bg-surface-muted"><LogOut className="h-[18px] w-[18px] rtl:rotate-180" />{t('signOut')}</button>
        <button onClick={async () => { await signOut(true); navigate('/login'); }} className="w-full px-3 pb-1 text-start text-[11px] text-ink-faint underline-offset-2 hover:underline">Shared device? Sign out &amp; remove offline data</button>
        <p className="px-3 pt-2 text-[11px] text-ink-faint">v{config?.version} · {config?.package} · {config?.mode}</p>
      </div>
    </nav>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-e border-surface-line bg-white lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/40" />
          <aside className="absolute inset-y-0 start-0 w-72 overflow-y-auto bg-white" onClick={(e) => e.stopPropagation()}>{side}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-surface-line bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-surface-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
            <ConnectionIndicator />
          </div>
          <div className="flex items-center gap-3">
            <LangSwitch />
            <div className="hidden text-end sm:block"><p className="text-sm font-medium leading-tight">{user?.fullName}</p><p className="text-xs text-ink-faint">{user ? t(user.role) : ''}</p></div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {needsReauth && <div className="mb-4"><Alert kind="warning">{t('signInAgainToSync')} <button className="font-medium underline" onClick={() => navigate('/login?reauth=1')}>{t('signIn')}</button></Alert></div>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export const AdminLayout = () => <Shell nav={ADMIN_NAV} variant="admin" />;
export const TeacherLayout = () => <Shell nav={TEACHER_NAV} variant="teacher" />;
