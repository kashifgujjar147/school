import { useState } from 'react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { post } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner, STATUS_TONE, Table, Tabs, Textarea, errorMessage } from '../components/ui';
import type { CorrectionRow } from '../teacher/TeacherCorrections';

export default function Corrections() {
  const t = useT(); const f = useFormat();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const q = useGet<CorrectionRow[]>(`/api/attendance/corrections?status=${status}`);
  const [review, setReview] = useState<{ c: CorrectionRow; decision: 'approved' | 'rejected' } | null>(null);
  const [note, setNote] = useState(''); const [err, setErr] = useState<string | null>(null);
  const act = useAction(() => post(`/api/attendance/corrections/${review!.c._id}/review`, { decision: review!.decision, reviewNote: note || null }), ['/api/attendance', '/api/system/overview']);
  return (
    <div>
      <PageHeader title={t('navCorrections')} />
      <Tabs value={status} onChange={setStatus} tabs={(['pending', 'approved', 'rejected'] as const).map((s) => ({ value: s, label: t(s) }))} />
      {err && <div className="mb-4"><Alert kind="error">{err}</Alert></div>}
      <Card padded={false}>
        {q.isLoading ? <Spinner /> : !q.data?.data.length ? <EmptyState /> : (
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('students')}</th><th>{t('classroom')}</th><th>{t('original')} → {t('newStatus')}</th><th>{t('reason')}</th><th>{t('requestedBy')}</th>{status !== 'pending' && <th>{t('reviewNote')}</th>}<th /></tr></thead>
            <tbody>{q.data.data.map((c) => (
              <tr key={c._id}>
                <td className="num">{f.date(c.date)}</td><td className="font-medium">{c.student?.fullName}</td><td>{c.classroomName}</td>
                <td><Badge color={STATUS_TONE[c.oldStatus]}>{t(c.oldStatus as TKey)}</Badge> → <Badge color={STATUS_TONE[c.newStatus]}>{t(c.newStatus as TKey)}</Badge></td>
                <td className="max-w-xs text-xs">{c.reason}</td><td className="text-xs">{c.requestedByName}<span className="block text-ink-faint">{f.dateTime(c.requestedAt)}</span></td>
                {status !== 'pending' && <td className="text-xs">{c.reviewedByName}: {c.reviewNote ?? '—'}</td>}
                <td className="whitespace-nowrap text-end">{c.status === 'pending' && <><Button variant="secondary" onClick={() => { setReview({ c, decision: 'rejected' }); setNote(''); }}>{t('reject')}</Button> <Button onClick={() => { setReview({ c, decision: 'approved' }); setNote(''); }}>{t('approve')}</Button></>}</td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <Modal open={Boolean(review)} onClose={() => setReview(null)} title={review?.decision === 'approved' ? t('approve') : t('reject')}
        footer={<><Button variant="secondary" onClick={() => setReview(null)}>{t('cancel')}</Button><Button variant={review?.decision === 'rejected' ? 'danger' : 'primary'} loading={act.isPending} onClick={() => act.mutate(undefined, { onSuccess: () => { setReview(null); setErr(null); }, onError: (e) => { setReview(null); setErr(errorMessage(e, t('errorGeneric'))); } })}>{t('confirm')}</Button></>}>
        {review && <div className="space-y-3 text-sm"><p><strong>{review.c.student?.fullName}</strong> · {f.date(review.c.date)}: {t(review.c.oldStatus as TKey)} → {t(review.c.newStatus as TKey)}</p><p className="text-ink-soft">{review.c.reason}</p><Textarea label={t('reviewNote')} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
      </Modal>
    </div>
  );
}
