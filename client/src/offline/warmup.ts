import type { Permission, SessionUser } from '@sms/shared';
import { ApiError, getWithMeta } from '../services/api';
import { useAuth } from '../store/auth';

/**
 * Offline preparation. After an online sign-in (and again when the connection returns, at most every
 * 10 minutes) the data behind every dashboard page this user may open is downloaded into the offline
 * cache, so those pages also open without internet, even if they were never visited on this device.
 * URLs mirror each page's default request; other filters/pages fall back to these (services/api.ts).
 * Only what the server already allows this user to read is fetched (it checks every request).
 */
const today = (tz?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function warmupUrls(user: SessionUser, pkg?: string, tz?: string): string[] {
  const can = (p: Permission) => user.permissions.includes(p);
  const d = today(tz);
  const urls = ['/api/public/config'];
  const add = (p: Permission | null, ...u: string[]) => { if (p === null || can(p)) urls.push(...u); };
  if (user.role === 'parent') { add(null, '/api/parent/dashboard', '/api/parent/notifications?page=1'); return urls; }
  if (user.role === 'student') { add(null, '/api/student/me', '/api/student/timetable'); return urls; }
  add('dashboard.view', '/api/system/overview');
  add('students.view', '/api/students?page=1&pageSize=25&status=active&sort=fullName');
  add('classrooms.view', '/api/academic/classrooms', '/api/academic/classes', '/api/academic/sessions');
  add('users.view', '/api/users?page=1&pageSize=25', '/api/users?page=1&pageSize=1&status=pending', '/api/users?role=teacher&status=active&pageSize=200');
  add('attendance.view_all', `/api/attendance/status?date=${d}`);
  add('corrections.review', '/api/attendance/corrections?status=pending');
  if (pkg === 'standard') add('guardians.view', '/api/guardians?page=1&pageSize=25');
  add('fees.view', '/api/fees/summary', '/api/fees/vouchers?page=1&pageSize=25', '/api/fees/settings');
  add('exams.view', '/api/exams');
  add('homework.view', '/api/homework');
  add('settings.view', '/api/settings', `/api/academic/holidays?year=${new Date().getFullYear()}`);
  if (pkg === 'standard') add('sms.view', '/api/sms/jobs?page=1&pageSize=25', '/api/sms/templates');
  add('security.view', '/api/system/security');
  add('system.view', '/api/system/health');
  add('backups.manage', '/api/backups');
  add('sync.view', '/api/system/sync');
  if (can('attendance.mark')) {
    add(null, can('attendance.view_all') ? '/api/academic/classrooms' : '/api/academic/classrooms?mine=true',
      `/api/attendance/status?date=${d}`, '/api/attendance/corrections', '/api/timetable/my',
      `/api/attendance/history?from=${shift(d, -30)}&to=${d}`);
  }
  return [...new Set(urls)];
}

let running: Promise<void> | null = null;

/**
 * The school's API allows a fixed number of requests per minute per IP, and a whole school often
 * shares one internet IP. So the preparation is gentle: one request at a time with a short pause,
 * at most once per 15 minutes per user on a device (remembered across reloads), and it stops at once
 * if the server says "too many requests". With force (fresh sign-in) the 15-minute rule still applies.
 */
const MIN_INTERVAL = 15 * 60_000;
const PAUSE_MS = 120;
const stampKey = (userId: string) => `sms.offlinePrep.${userId}`;
function lastRunAt(userId: string) { try { return Number(localStorage.getItem(stampKey(userId)) ?? 0); } catch { return 0; } }
function markRun(userId: string) { try { localStorage.setItem(stampKey(userId), String(Date.now())); } catch { /* storage unavailable */ } }
class Stop extends Error {}

export function warmOfflineCache(_force = false): Promise<void> {
  const { user, config, offlineSession } = useAuth.getState();
  if (!user || offlineSession || !navigator.onLine) return Promise.resolve();
  if (running) return running;
  if (Date.now() - lastRunAt(user.id) < MIN_INTERVAL) return Promise.resolve();
  markRun(user.id);
  const fetchOne = async <T>(u: string) => {
    if (useAuth.getState().user?.id !== user.id || useAuth.getState().offlineSession) throw new Stop();
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    try { return await getWithMeta<T>(u); } catch (e) {
      if (e instanceof ApiError && e.status === 429) throw new Stop();
      return null; // no permission for this page, offline again...: skip it
    }
  };
  running = (async () => {
    for (const u of warmupUrls(user, config?.package, config?.timeZone)) await fetchOne(u);
    // Teachers: today's register for each of their classrooms, so attendance can be marked offline.
    if (user.permissions.includes('attendance.mark')) {
      const rooms = await fetchOne<{ _id: string }[]>(user.permissions.includes('attendance.view_all') ? '/api/academic/classrooms' : '/api/academic/classrooms?mine=true');
      const d = today(config?.timeZone);
      for (const r of (rooms?.data ?? []).slice(0, 40)) await fetchOne(`/api/attendance/roster?classroomId=${r._id}&date=${d}`);
    }
    // Staff edit panels reached from the Users list (a small set), so they open offline too.
    if (user.permissions.includes('users.view')) {
      const list = await fetchOne<{ _id: string }[]>('/api/users?page=1&pageSize=25');
      for (const x of (list?.data ?? []).slice(0, 25)) await fetchOne(`/api/users/${x._id}`);
    }
  })().catch((e) => { if (!(e instanceof Stop)) throw e; }).finally(() => { running = null; });
  return running;
}
