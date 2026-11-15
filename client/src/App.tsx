import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@sms/shared';
import { useAuth } from './store/auth';
import { AdminLayout, ParentLayout, StudentLayout, TeacherLayout } from './components/Layout';
import { Spinner, EmptyState } from './components/ui';
import { LoginPage, ChangePasswordPage, ResetPasswordPage, RegisterPage, SetupPage, homeFor } from './pages/Auth';

/**
 * Every dashboard page is its own chunk. They are all registered here so that, after an online sign-in,
 * they can be loaded in the background: navigating to any page then works offline, even one that was
 * never opened (the service worker also keeps them for later visits).
 */
const pageLoaders: (() => Promise<unknown>)[] = [];
function page<T>(load: () => Promise<T>) { pageLoaders.push(load); return load; }
export const preloadAllPages = () => Promise.allSettled(pageLoaders.map((load) => load()));

// The public website is its own chunk: visitors never download the dashboards, and staff never download the site.
const PublicSite = lazy(() => import('./public/PublicSite').then((m) => ({ default: m.PublicSite })));
const Overview = lazy(page(() => import('./admin/Overview')));
const Students = lazy(page(() => import('./admin/Students')));
const StudentProfile = lazy(page(() => import('./admin/StudentProfile')));
const Classrooms = lazy(page(() => import('./admin/Classrooms')));
const UsersPage = lazy(page(() => import('./admin/Users')));
const AttendanceAdmin = lazy(page(() => import('./admin/Attendance')));
const Corrections = lazy(page(() => import('./admin/Corrections')));
const Guardians = lazy(page(() => import('./admin/Guardians')));
const Sms = lazy(page(() => import('./admin/Sms')));
const Reports = lazy(page(() => import('./admin/Reports')));
const SettingsPage = lazy(page(() => import('./admin/Settings')));
const WebsiteAdmin = lazy(page(() => import('./admin/cms')));
const Security = lazy(page(() => import('./admin/Security')));
const Health = lazy(page(() => import('./admin/Health')));
const Backups = lazy(page(() => import('./admin/Backups')));
const SyncPage = lazy(page(() => import('./admin/Sync')));
const TeacherHome = lazy(page(() => import('./teacher/TeacherHome')));
const MarkAttendance = lazy(page(() => import('./teacher/MarkAttendance')));
const TeacherHistory = lazy(page(() => import('./teacher/TeacherHistory')));
const TeacherCorrections = lazy(page(() => import('./teacher/TeacherCorrections')));
const Fees = lazy(page(() => import('./admin/Fees')));
const Exams = lazy(page(() => import('./admin/Exams')));
const HomeworkPage = lazy(page(() => import('./admin/Homework')));
const Analytics = lazy(page(() => import('./admin/Analytics')));
const IdCards = lazy(page(() => import('./admin/IdCards')));
const ParentHome = lazy(page(() => import('./parent/ParentHome')));
const ChildDetail = lazy(page(() => import('./parent/ChildDetail')));
const PaymentStatus = lazy(page(() => import('./parent/PaymentStatus')));
const ParentNotifications = lazy(page(() => import('./parent/ParentNotifications')));
const Verify = lazy(page(() => import('./pages/Verify')));
const TimetableAdmin = lazy(page(() => import('./admin/timetable')));
const TeacherTimetable = lazy(page(() => import('./teacher/TeacherTimetable')));
const StudentHome = lazy(page(() => import('./student/StudentHome')));

type Area = 'staff' | 'parent' | 'student';
const areaOf = (role: string): Area => (role === 'parent' ? 'parent' : role === 'student' ? 'student' : 'staff');

function RequireAuth({ children, perm, area }: { children: ReactNode; perm?: Permission; area?: Area }) {
  const { user, can } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`${area === 'parent' ? '/parent/login' : area === 'student' ? '/student/login' : '/login'}?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  // Defence in depth: the server never issues a session to an unapproved account.
  if (user.role === 'unassigned') return <EmptyState title="Account pending approval">An administrator must assign your role before you can use the system.</EmptyState>;
  // Staff, parents and students each stay in their own area.
  if (area !== undefined && areaOf(user.role) !== area) return <Navigate to={homeFor(user.role)} replace />;
  if (perm && !can(perm)) return <EmptyState title="403">You do not have access to this page.</EmptyState>;
  return <>{children}</>;
}

function Home() {
  const { user, config } = useAuth();
  if (!user) return config?.websiteEnabled ? <Navigate to="/site" replace /> : <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

/** Account settings live inside whichever dashboard the user can open. */
function accountPath(can: (p: Permission) => boolean, role?: string) {
  if (role === 'parent') return '/parent/account';
  if (role === 'student') return '/student/account';
  return role !== 'teacher' && can('dashboard.view') ? '/admin/account' : '/teacher/account';
}

function AccountRedirect() {
  const { user, can } = useAuth();
  return <Navigate to={accountPath(can, user?.role)} replace />;
}

const P = (perm: Permission, el: ReactNode) => <RequireAuth perm={perm}>{el}</RequireAuth>;

export function App() {
  const userId = useAuth((s) => s.user?.id);
  const offlineSession = useAuth((s) => s.offlineSession);
  // Signed in with a connection: fetch every dashboard page's code in the background (offline readiness).
  useEffect(() => {
    if (!userId || offlineSession) return;
    const t = window.setTimeout(() => { void preloadAllPages(); }, 1500);
    return () => window.clearTimeout(t);
  }, [userId, offlineSession]);
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/site/*" element={<PublicSite />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/parent/login" element={<LoginPage portal="parent" />} />
        <Route path="/student/login" element={<LoginPage portal="student" />} />
        <Route path="/verify/:token" element={<Verify />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        {/* Legacy URL: forwards into the dashboard's account settings (never forced). */}
        <Route path="/change-password" element={<RequireAuth><AccountRedirect /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth perm="dashboard.view" area="staff"><AdminLayout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="account" element={<ChangePasswordPage />} />
          <Route path="students"element={P('students.view', <Students />)} />
          <Route path="students/:id" element={P('students.view', <StudentProfile />)} />
          <Route path="classrooms" element={P('classrooms.view', <Classrooms />)} />
          <Route path="timetable" element={P('timetable.view', <TimetableAdmin />)} />
          <Route path="users" element={P('users.view', <UsersPage />)} />
          <Route path="attendance" element={P('attendance.view_all', <AttendanceAdmin />)} />
          <Route path="corrections" element={P('corrections.review', <Corrections />)} />
          <Route path="guardians" element={P('guardians.view', <Guardians />)} />
          <Route path="sms" element={P('sms.view', <Sms />)} />
          <Route path="reports" element={P('reports.view', <Reports />)} />
          <Route path="settings" element={P('settings.view', <SettingsPage />)} />
          <Route path="website/*" element={P('website.manage', <WebsiteAdmin />)} />
          <Route path="security" element={P('security.view', <Security />)} />
          <Route path="health" element={P('system.view', <Health />)} />
          <Route path="backups" element={P('backups.manage', <Backups />)} />
          <Route path="sync" element={P('sync.view', <SyncPage />)} />
          <Route path="fees" element={P('fees.view', <Fees />)} />
          <Route path="exams" element={P('exams.view', <Exams />)} />
          <Route path="homework" element={P('homework.view', <HomeworkPage />)} />
          <Route path="analytics" element={P('analytics.view', <Analytics />)} />
          <Route path="id-cards" element={P('idcards.manage', <IdCards />)} />
        </Route>
        <Route path="/teacher" element={<RequireAuth perm="attendance.mark" area="staff"><TeacherLayout /></RequireAuth>}>
          <Route index element={<TeacherHome />} />
          <Route path="account" element={<ChangePasswordPage />} />
          <Route path="mark/:classroomId" element={<MarkAttendance />} />
          <Route path="history" element={<TeacherHistory />} />
          <Route path="corrections" element={<TeacherCorrections />} />
          <Route path="timetable" element={<TeacherTimetable />} />
          <Route path="homework" element={P('homework.manage', <HomeworkPage />)} />
          <Route path="results" element={P('results.enter', <Exams />)} />
        </Route>
        <Route path="/parent" element={<RequireAuth perm="parent.portal" area="parent"><ParentLayout /></RequireAuth>}>
          <Route index element={<ParentHome />} />
          <Route path="account" element={<ChangePasswordPage />} />
          <Route path="notifications" element={<ParentNotifications />} />
          <Route path="children/:id" element={<ChildDetail />} />
          <Route path="payments/:intentId" element={<PaymentStatus />} />
        </Route>
        <Route path="/student" element={<RequireAuth perm="student.portal" area="student"><StudentLayout /></RequireAuth>}>
          <Route index element={<StudentHome />} />
          <Route path="account" element={<ChangePasswordPage />} />
        </Route>
        <Route path="*" element={<EmptyState title="404">Page not found.</EmptyState>} />
      </Routes>
    </Suspense>
  );
}
