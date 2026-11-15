import { useState } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { Badge, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Spinner, STATUS_TONE, Table, Button } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { todayIso } from '../teacher/common';

interface StatusResp { date: string; schoolDay: boolean; classrooms: { classroomId: string; classroomName: string; submitted: boolean; sheetId?: string; submittedAt?: string; submittedBy?: string; source?: string; counts?: Record<string, number>; teachers: string[] }[] }
interface SheetDetail { sheet: { date: string; source: string; submittedAt: string }; records: { _id: string; status: string; originalStatus: string; corrected: boolean; remark?: string; arrivalTime?: string; student?: { fullName: string; admissionNumber: string } }[] }

/** Live monitor of today's (or any day's) attendance submissions across all classrooms. */
export default function AttendanceAdmin() {
  const t = useT(); const f = useFormat();
  const tz = useAuth((s) => s.config?.timeZone);
  const [date, setDate] = useState(todayIso(tz));
  const q = useGet<StatusResp>(`/api/attendance/status?date=${date}`, { refetchInterval: 20_000 });
  const [sheet, setSheet] = useState<string | null>(null);
  const d = useGet<SheetDetail>(sheet ? `/api/attendance/sheets/${sheet}` : null);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data.data.classrooms;
  const done = rows.filter((r) => r.submitted).length;
  return (
    <div>
      <PageHeader title={t('navAttendance')} subtitle={t('submittedOf', { done, total: rows.length })} actions={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('date')} />} />
      <CacheNotice fromCache={q.data.fromCache} />
      {!q.data.data.schoolDay && <p className="mb-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-soft">{t('notSchoolDay')}</p>}
      <Card padded={false}>
        {rows.length === 0 ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('classroom')}</th><th>{t('teachers')}</th><th>{t('status')}</th><th>{t('present')}</th><th>{t('absent')}</th><th>{t('late')}</th><th>{t('leave')}</th><th>{t('submittedBy')}</th><th>{t('source')}</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.classroomId}>
                <td className="font-medium">{r.classroomName}</td><td className="text-xs">{r.teachers.join(', ') || <span className="text-amber-700">{t('noTeacher')}</span>}</td>
                <td>{r.submitted ? <Badge color="green"><CheckCircle2 className="h-3.5 w-3.5" />{t('submitted')}</Badge> : <Badge color="amber"><Clock className="h-3.5 w-3.5" />{t('notSubmitted')}</Badge>}</td>
                {(['present', 'absent', 'late', 'leave'] as const).map((s) => <td key={s} className="num">{r.counts?.[s] ?? '—'}</td>)}
                <td className="text-xs">{r.submittedBy ?? '—'}{r.submittedAt ? <span className="block text-ink-faint">{f.dateTime(r.submittedAt)}</span> : null}</td>
                <td>{r.source && <Badge color={r.source === 'online' ? 'gray' : 'violet'}>{r.source}</Badge>}</td>
                <td className="text-end">{r.sheetId && <Button variant="ghost" onClick={() => setSheet(r.sheetId!)}>{t('viewSheet')}</Button>}</td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Modal open={Boolean(sheet)} onClose={() => setSheet(null)} title={t('viewSheet')} wide>
        {!d.data ? <Spinner /> : (
          <Table>
            <thead><tr><th>{t('admissionNumber')}</th><th>{t('fullName')}</th><th>{t('status')}</th><th>{t('arrivalTime')}</th><th>{t('remark')}</th></tr></thead>
            <tbody>{d.data.data.records.map((r) => (
              <tr key={r._id}><td className="num text-xs">{r.student?.admissionNumber}</td><td>{r.student?.fullName}</td>
                <td><Badge color={STATUS_TONE[r.status]}>{t(r.status as TKey)}</Badge>{r.corrected && <span className="ms-2 text-xs text-ink-faint">{t('original')}: {t(r.originalStatus as TKey)}</span>}</td>
                <td className="num">{r.arrivalTime ?? ''}</td><td className="text-xs">{r.remark ?? ''}</td></tr>
            ))}</tbody>
          </Table>
        )}
      </Modal>
    </div>
  );
}
