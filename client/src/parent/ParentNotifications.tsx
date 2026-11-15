import { useState } from 'react';
import { useGet } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, STATUS_TONE } from '../components/ui';

interface Note { _id: string; event: string; channel?: string; status: string; body: string; createdAt: string; deliveredAt?: string }

/** Every message the school sent (or tried to send) to this parent, with its real delivery status. */
export default function ParentNotifications() {
  const t = useT(); const f = useFormat();
  const [page, setPage] = useState(1);
  const q = useGet<Note[]>(`/api/parent/notifications?page=${page}`);
  return (
    <div>
      <PageHeader title={t('navNotifications')} />
      <Card padded={false}>
        {q.isLoading ? <Spinner /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState /> : (
          <ul className="divide-y divide-surface-line">
            {q.data.data.map((n) => (
              <li key={n._id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge>{t(n.event as TKey)}</Badge>
                  <Badge color={STATUS_TONE[n.status]}>{t(n.status as TKey)}</Badge>
                  <span className="text-ink-faint">{t((n.channel ?? 'sms') as TKey)} · {f.dateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t border-surface-line px-4 py-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</Button>
          <Button variant="secondary" disabled={(q.data?.data.length ?? 0) < 25} onClick={() => setPage(page + 1)}>{t('next')}</Button>
        </div>
      </Card>
    </div>
  );
}
