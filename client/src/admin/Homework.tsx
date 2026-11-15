import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useAction, useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { useAuth } from '../store/auth';
import { del, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Select, Spinner, Textarea, errorMessage } from '../components/ui';
import { useClassrooms } from './shared';
import { todayIso } from '../teacher/common';

interface Hw { _id: string; classroomId: string; classroomName?: string; subject: string; title: string; description?: string; assignedDate: string; dueDate: string; createdBy?: string; createdByName?: string }

export default function Homework() {
  const t = useT(); const f = useFormat();
  const { can, config, user } = useAuth();
  const all = useClassrooms();
  const mine = useGet<{ _id: string; name: string }[]>(can('attendance.view_all') ? null : '/api/academic/classrooms?mine=true');
  const rooms = can('attendance.view_all') ? (all.data?.data ?? []) : (mine.data?.data ?? []);
  const [classroomId, setClassroomId] = useState('');
  const list = useGet<Hw[]>(`/api/homework${qs({ classroomId })}`);
  const today = todayIso(config?.timeZone);
  const blank = { classroomId: '', subject: '', title: '', description: '', assignedDate: today, dueDate: today, notifyParents: true };
  const [form, setForm] = useState<typeof blank | null>(null);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const create = useAction(() => post<{ notifications: { queued: number; reason: string | null } | null }>('/api/homework', { ...form, description: form!.description || null }), ['/api/homework']);
  const remove = useAction((id: string) => del(`/api/homework/${id}`), ['/api/homework']);
  const valid = form && form.classroomId && form.subject && form.title && form.assignedDate && form.dueDate >= form.assignedDate;
  return (
    <div className="space-y-5">
      <PageHeader title={t('navHomework')} actions={can('homework.manage') && <Button onClick={() => setForm({ ...blank, classroomId })}><Plus className="h-4 w-4" />{t('newHomework')}</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card padded={false} actions={<Select aria-label={t('classroom')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)} placeholder={`${t('classroom')}: ${t('all')}`} options={rooms.map((r) => ({ value: r._id, label: r.name }))} />} title={t('navHomework')}>
        {list.isLoading ? <Spinner /> : list.isError ? <div className="p-5"><Alert kind="error">{errorMessage(list.error, t('errorGeneric'))}</Alert></div> : !list.data?.data.length ? <EmptyState>{t('noHomework')}</EmptyState> : (
          <ul className="divide-y divide-surface-line">{list.data.data.map((h) => (
            <li key={h._id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium"><Badge color="blue">{h.subject}</Badge> {h.title} {h.dueDate < today ? <Badge>{t('past')}</Badge> : null}</p>
                <p className="num mt-0.5 text-xs text-ink-faint">{h.classroomName} · {t('assignedDate')}: {f.date(h.assignedDate)} · {t('dueDate')}: {f.date(h.dueDate)}{h.createdByName ? ` · ${h.createdByName}` : ''}</p>
                {h.description && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{h.description}</p>}
              </div>
              {can('homework.manage') && (h.createdBy === user?.id || can('students.manage')) && <Button variant="ghost" aria-label={t('delete')} loading={remove.isPending} onClick={() => remove.mutate(h._id, { onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}><Trash2 className="h-4 w-4" /></Button>}
            </li>
          ))}</ul>
        )}
      </Card>
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={t('newHomework')}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button><Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate(undefined, { onSuccess: (r) => { setForm(null); setMsg({ kind: 'success', text: r.notifications ? `${t('saved')} · ${r.notifications.queued} SMS/WhatsApp${r.notifications.reason ? ` (${r.notifications.reason})` : ''}` : t('saved') }); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('save')}</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('classroom')} value={form.classroomId} onChange={(e) => setForm({ ...form, classroomId: e.target.value })} placeholder={t('selectClassroom')} options={rooms.map((r) => ({ value: r._id, label: r.name }))} />
          <Input label={t('subject')} value={form.subject} maxLength={80} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <Input className="sm:col-span-2" label={t('hwTitle')} value={form.title} maxLength={160} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea className="sm:col-span-2" label={t('description')} rows={4} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label={t('assignedDate')} type="date" value={form.assignedDate} onChange={(e) => setForm({ ...form, assignedDate: e.target.value })} />
          <Input label={t('dueDate')} type="date" min={form.assignedDate} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} error={form.dueDate < form.assignedDate ? '!' : undefined} />
          <div className="sm:col-span-2"><Checkbox label={t('notifyParents')} checked={form.notifyParents} onChange={(x) => setForm({ ...form, notifyParents: x })} /></div>
        </div>}
      </Modal>
    </div>
  );
}
