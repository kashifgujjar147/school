import { useState } from 'react';
import { EyeOff, Trash2 } from 'lucide-react';
import { useAction, useGet } from '../hooks/useApi';
import { useFormat, useT, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { del, post } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Select, Spinner, Textarea, errorMessage } from '../components/ui';

interface Item { _id: string; category: string; body: string; visibleToParents: boolean; createdAt: string; authorId: string; authorName?: string }

/** Teacher feedback on a student. Notes marked "visible to parents" appear in the parent portal. */
export function StudentFeedbackCard({ studentId }: { studentId: string }) {
  const t = useT(); const f = useFormat();
  const { can, user } = useAuth();
  const q = useGet<Item[]>(`/api/feedback?studentId=${studentId}`);
  const [v, setV] = useState({ category: 'general', body: '', visibleToParents: true });
  const [err, setErr] = useState<string | null>(null);
  const add = useAction(() => post('/api/feedback', { studentId, ...v }), ['/api/feedback']);
  const remove = useAction((id: string) => del(`/api/feedback/${id}`), ['/api/feedback']);
  if (q.isError) return null; // no access to this student's classroom
  return (
    <Card title={t('feedbackTab')}>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {can('feedback.write') && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Select aria-label={t('category')} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={(['general', 'academic', 'behaviour', 'attendance'] as const).map((c) => ({ value: c, label: t(c === 'attendance' ? 'attendanceTab' : c) }))} />
            <Checkbox label={t('visibleToParents')} checked={v.visibleToParents} onChange={(x) => setV({ ...v, visibleToParents: x })} />
          </div>
          <Textarea aria-label={t('addFeedback')} placeholder={t('addFeedback')} maxLength={2000} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
          <Button loading={add.isPending} disabled={!v.body.trim()} onClick={() => add.mutate(undefined, { onSuccess: () => setV({ ...v, body: '' }), onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) })}>{t('addFeedback')}</Button>
        </div>
      )}
      {q.isLoading ? <Spinner /> : !q.data?.data.length ? <EmptyState>{t('noFeedback')}</EmptyState> : (
        <ul className="space-y-3">{q.data.data.map((x) => (
          <li key={x._id} className="rounded-xl bg-surface-muted p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
              <Badge>{t((x.category === 'attendance' ? 'attendanceTab' : x.category) as TKey)}</Badge>{!x.visibleToParents && <Badge color="amber"><EyeOff className="h-3 w-3" /></Badge>}
              <span>{x.authorName}</span><span>· {f.dateTime(x.createdAt)}</span>
              {(x.authorId === user?.id || can('students.manage')) && <Button variant="ghost" className="ms-auto" aria-label={t('delete')} onClick={() => remove.mutate(x._id, { onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) })}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
            <p className="whitespace-pre-line">{x.body}</p>
          </li>
        ))}</ul>
      )}
    </Card>
  );
}
