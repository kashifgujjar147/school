import { useGet } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { Badge, Card, EmptyState, PageHeader, Spinner, STATUS_TONE, Table } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { useMyOutbox } from './common';

export interface CorrectionRow {
  _id: string; date: string; oldStatus: string; newStatus: string; reason: string; status: string; requestedAt: string; reviewedAt?: string; reviewNote?: string;
  student?: { fullName: string; admissionNumber: string }; classroomName?: string; requestedByName?: string; reviewedByName?: string;
}

export default function TeacherCorrections() {
  const t = useT(); const f = useFormat();
  const q = useGet<CorrectionRow[]>('/api/attendance/corrections');
  const queued = useMyOutbox().filter((o) => o.kind === 'attendance.correction' && o.status !== 'synced');
  return (
    <div>
      <PageHeader title={t('navCorrections')} />
      <CacheNotice fromCache={q.data?.fromCache} />
      {queued.length > 0 && <Card className="mb-4" title={t('savedOnDevice')}><ul className="text-sm">{queued.map((o) => <li key={o.id} className="py-1">{o.label} — <Badge color="blue">{t('pending')}</Badge></li>)}</ul></Card>}
      <Card padded={false}>
        {q.isLoading ? <Spinner /> : !q.data?.data.length ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('students')}</th><th>{t('classroom')}</th><th>{t('original')}</th><th>{t('newStatus')}</th><th>{t('reason')}</th><th>{t('status')}</th><th>{t('reviewNote')}</th></tr></thead>
            <tbody>{q.data.data.map((c) => (
              <tr key={c._id}>
                <td className="num">{f.date(c.date)}</td><td>{c.student?.fullName}</td><td>{c.classroomName}</td>
                <td><Badge color={STATUS_TONE[c.oldStatus]}>{t(c.oldStatus as TKey)}</Badge></td><td><Badge color={STATUS_TONE[c.newStatus]}>{t(c.newStatus as TKey)}</Badge></td>
                <td className="max-w-xs truncate" title={c.reason}>{c.reason}</td><td><Badge color={STATUS_TONE[c.status]}>{t(c.status as TKey)}</Badge></td><td>{c.reviewNote ?? '—'}</td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
