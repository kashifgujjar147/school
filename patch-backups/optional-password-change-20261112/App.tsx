import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@sms/shared';
import { useAuth } from './store/auth';
import { AdminLayout, TeacherLayout } from './components/Layout';
import { Spinner, EmptyState } from './components/ui';
import { LoginPage, ChangePasswordPage, ResetPasswordPage } from './pages/Auth';
import { PublicSite } from './public/PublicSite';

const Overview = lazy(() => import('./admin/Overview'));
const Students = lazy(() => import('./admin/Students'));
const StudentProfile = lazy(() => import('./admin/StudentProfile'));
const Classrooms = lazy(() => import('./admin/Classrooms'));
const UsersPage = lazy(() => import('./admin/Users'));
const AttendanceAdmin = lazy(() => import('./admin/Attendance'));
const Corrections = lazy(() => import('./admin/Corrections'));
const Guardians = lazy(() => import('./admin/Guardians'));
const Sms = lazy(() => import('./admin/Sms'));
const Reports = lazy(() => import('./admin/Reports'));
const SettingsPage = lazy(() => import('./admin/Settings'));
const WebsiteAdmin = lazy(() => import('./admin/Website'));
const Security = lazy(() => import('./admin/Security'));
const Health = lazy(() => import('./admin/Health'));
const Backups = lazy(() => import('./admin/Backups'));
const SyncPage = lazy(() => import('./admin/Sync'));
const TeacherHome = lazy(() => import('./teacher/TeacherHome'));
const MarkAttendance = lazy(() => import('./teacher/MarkAttendance'));
const TeacherHistory = lazy(() => import('./teacher/TeacherHistory'));
const TeacherCorrections = lazy(() => import('./teacher/TeacherCorrections'));

function RequireAuth({ children, perm }: { children: ReactNode; perm?: Permission }) {
  const { user, can } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (perm && !can(perm)) return <EmptyState title="403">You do not have access to this page.</EmptyState>;
  return <>{children}</>;
}

function Home() {
  const { user, config } = useAuth();
  if (!user) return config?.websiteEnabled ? <Navigate to="/site" replace /> : <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'teacher' ? '/teacher' : '/admin'} replace />;
}

const P = (perm: Permission, el: ReactNode) => <RequireAuth perm={perm}>{el}</RequireAuth>;

export function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/site" element={<PublicSite />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth perm="dashboard.view"><AdminLayout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="students" element={P('students.view', <Students />)} />
          <Route path="students/:id" element={P('students.view', <StudentProfile />)} />
          <Route path="classrooms" element={P('classrooms.view', <Classrooms />)} />
          <Route path="users" element={P('users.view', <UsersPage />)} />
          <Route path="attendance" element={P('attendance.view_all', <AttendanceAdmin />)} />
          <Route path="corrections" element={P('corrections.review', <Corrections />)} />
          <Route path="guardians" element={P('guardians.view', <Guardians />)} />
          <Route path="sms" element={P('sms.view', <Sms />)} />
          <Route path="reports" element={P('reports.view', <Reports />)} />
          <Route path="settings" element={P('settings.view', <SettingsPage />)} />
          <Route path="website" element={P('website.manage', <WebsiteAdmin />)} />
          <Route path="security" element={P('security.view', <Security />)} />
          <Route path="health" element={P('system.view', <Health />)} />
          <Route path="backups" element={P('backups.manage', <Backups />)} />
          <Route path="sync" element={P('sync.view', <SyncPage />)} />
        </Route>
        <Route path="/teacher" element={<RequireAuth perm="attendance.mark"><TeacherLayout /></RequireAuth>}>
          <Route index element={<TeacherHome />} />
          <Route path="mark/:classroomId" element={<MarkAttendance />} />
          <Route path="history" element={<TeacherHistory />} />
          <Route path="corrections" element={<TeacherCorrections />} />
        </Route>
        <Route path="*" element={<EmptyState title="404">Page not found.</EmptyState>} />
      </Routes>
    </Suspense>
  );
}
