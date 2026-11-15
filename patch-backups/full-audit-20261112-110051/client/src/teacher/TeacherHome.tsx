import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2, Clock, CloudOff, Users } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { useAuth } from '../store/auth';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { todayIso, useMyOutbox, type ClassroomLite } from './common';

interface StatusResp { date: string; schoolDay: boolean; classrooms: { classroomId: string; submitted: boolean; submittedAt?: string; counts?: Record<string, number> }[] }

export default function TeacherHome() {
  const t = useT(); const f = useFormat();
  const tz = useAuth((s) => s.config?.timeZone);
  const user = useAuth((s) => s.user);
  const date = todayIso(tz);
  const rooms = useGet<ClassroomLite[]>('/api/academic/classrooms?mine=true');
  const status = useGet<StatusResp>(`/api/attendance/status?date=${date}`);
  const outbox = useMyOutbox();

  if (rooms.isLoading) return <Spinner />;
  if (rooms.isError) return <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} />;
  const list = rooms.data?.data ?? [];

  return (
    <div>
      <PageHeader title={t('navMyClasses')} subtitle={`${user?.fullName} · ${f.date(date)}`} />
      <CacheNotice fromCache={rooms.data?.fromCache} />
      {status.data && !status.data.data.schoolDay && <p className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">{t('notSchoolDay')}</p>}
      {list.length === 0 ? <Card><EmptyState title={t('noTeacher')}>Ask an administrator to assign you to a classroom.</EmptyState></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const st = status.data?.data.classrooms.find((c) => c.classroomId === r._id);
            const queued = outbox.find((o) => o.kind === 'attendance.submit' && o.body.classroomId === r._id && o.body.date === date && o.status !== 'synced');
            return (
              <Link key={r._id} to={`/teacher/mark/${r._id}?date=${date}`} className="card group flex flex-col gap-4 p-5 transition hover:border-brand/40 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-lg font-semibold">{r.name}</p><p className="text-sm text-ink-soft">{[r.className, r.sectionName, r.room].filter(Boolean).join(' · ')}</p></div>
                  <ChevronRight className="h-5 w-5 text-ink-faint transition group-hover:text-brand rtl:rotate-180" />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-ink-soft"><Users className="h-4 w-4" />{t('studentsCount', { n: r.studentCount })}</span>
                  {st?.submitted ? <Badge color="green"><CheckCircle2 className="h-3.5 w-3.5" />{t('submitted')}</Badge>
                    : queued ? <Badge color={queued.status === 'pending' || queued.status === 'sending' ? 'blue' : 'red'}><CloudOff className="h-3.5 w-3.5" />{queued.status === 'pending' || queued.status === 'sending' ? t('savedOnDevice') : t('needsAttention')}</Badge>
                    : <Badge color="amber"><Clock className="h-3.5 w-3.5" />{t('notSubmitted')}</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
