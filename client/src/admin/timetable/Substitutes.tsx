import { useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import type { DatePlan } from '@sms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '../../hooks/useApi';
import { post } from '../../services/api';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Select, Spinner, Table } from '../../components/ui';
import { addDays, localToday, useL } from '../../timetable/common';
import { useGuardedAction } from './api';

interface Plan {
  date: string; teacher: string; plan: DatePlan;
  lessons: { entryId: string; periodKey: string; period: { label: string; start: string; end: string }; classroom: string; subject: string;
    cover: { _id: string; substitute: string; reason: string | null } | null;
    candidates: { teacherId: string; fullName: string; qualified: boolean; teachesClass: boolean; lessonsThatDay: number }[]; unavailableCount: number }[];
}
interface SubRow { _id: string; date: string; periodKey: string; classroom: string | null; subject: string | null; substitute: string | null; original: string | null; reason: string | null; status: string }

/** Cover for absent teachers. Assigning a substitute never changes the permanent timetable. */
export default function SubstitutesTab({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const L = useL();
  const qc = useQueryClient();
  const [date, setDate] = useState(localToday());
  const [teacherId, setTeacherId] = useState('');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState<SubRow | null>(null);
  const teachers = useGet<{ _id: string; fullName: string }[]>(`/api/timetable/teachers?sessionId=${sessionId}`);
  const plan = useGet<Plan>(teacherId && date ? `/api/timetable/substitutions/plan?teacherId=${teacherId}&date=${date}` : null);
  const list = useGet<SubRow[]>(`/api/timetable/substitutions?from=${localToday()}&to=${addDays(localToday(), 30)}`);
  const g = useGuardedAction(() => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable/substitutions') }));
  const assign = (entryId: string) => g.exec(async () => {
    const r = await post<{ notification: { guardianMessages: { queued: number } } }>('/api/timetable/substitutions', { date, entryId, substituteTeacherId: choice[entryId], reason: reason.trim() || null });
    g.setToast({ kind: 'success', text: `${L('Substitute assigned. Teachers and the class were notified in their portals.', 'متبادل استاد مقرر ہو گیا۔ پورٹل میں اطلاع دے دی گئی۔')}${r.notification.guardianMessages.queued ? ` ${L(`${r.notification.guardianMessages.queued} guardian message(s) queued — they are sent only when the SMS/WhatsApp provider accepts them.`, `${r.notification.guardianMessages.queued} سرپرست پیغامات قطار میں ہیں۔`)}` : ''}` });
  });

  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      <Card title={L('Absent teacher', 'غیر حاضر استاد')}>
        <div className="grid items-end gap-3 sm:grid-cols-[12rem_1fr_1fr]">
          <Input type="date" label={L('Date', 'تاریخ')} value={date} onChange={(e) => setDate(e.target.value)} />
          <Select label={L('Teacher', 'استاد')} value={teacherId} placeholder={L('Choose the absent teacher', 'غیر حاضر استاد منتخب کریں')} onChange={(e) => setTeacherId(e.target.value)}
            options={(teachers.data?.data ?? []).map((t) => ({ value: t._id, label: t.fullName }))} />
          {!readOnly && <Input label={L('Reason (optional)', 'وجہ (اختیاری)')} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
        </div>
        {teachers.isError && <div className="mt-3"><ErrorState error={teachers.error} /></div>}
      </Card>

      {teacherId && (plan.isLoading ? <Spinner /> : plan.isError ? <ErrorState error={plan.error} onRetry={() => plan.refetch()} /> : plan.data && (
        <Card title={`${plan.data.data.teacher} · ${plan.data.data.date}`}>
          {plan.data.data.plan.closed ? <Alert kind="info">{L('The school is closed on this date', 'اس تاریخ کو اسکول بند ہے')}{plan.data.data.plan.label ? `: ${plan.data.data.plan.label}` : '.'}</Alert>
            : plan.data.data.lessons.length === 0 ? <EmptyState>{L('This teacher has no lessons on this date in the published timetable.', 'شائع شدہ ٹائم ٹیبل میں اس تاریخ کو اس استاد کا کوئی پیریڈ نہیں۔')}</EmptyState> : (
              <ul className="space-y-3">
                {plan.data.data.lessons.map((l) => (
                  <li key={l.entryId} className="rounded-xl border border-surface-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm"><span className="font-semibold">{l.period.label}</span> <span className="num text-ink-faint">{l.period.start}–{l.period.end}</span> · {l.classroom} · {l.subject}</p>
                      {l.cover ? <Badge color="green"><UserCheck className="me-1 inline h-3 w-3" />{L('Covered by', 'متبادل')} {l.cover.substitute}</Badge> : <Badge color="amber">{L('Needs cover', 'متبادل درکار')}</Badge>}
                    </div>
                    {!l.cover && (l.candidates.length === 0 ? <p className="mt-2 text-sm text-red-700">{L('No teacher is free in this period (all are teaching, unavailable, absent or at their daily limit).', 'اس پیریڈ میں کوئی استاد فارغ نہیں۔')}</p> : !readOnly && (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div className="min-w-[16rem] flex-1">
                          <Select aria-label={L('Substitute', 'متبادل استاد')} value={choice[l.entryId] ?? ''} placeholder={L('Choose a free teacher', 'فارغ استاد منتخب کریں')} onChange={(e) => setChoice({ ...choice, [l.entryId]: e.target.value })}
                            options={l.candidates.map((c) => ({ value: c.teacherId, label: `${c.fullName}${c.qualified ? ` · ${L('teaches subject', 'یہ مضمون پڑھاتا ہے')}` : ''}${c.teachesClass ? ` · ${L('knows class', 'کلاس سے واقف')}` : ''} · ${c.lessonsThatDay} ${L('lessons that day', 'اس دن پیریڈ')}` }))} />
                        </div>
                        <Button loading={g.busy} disabled={!choice[l.entryId]} onClick={() => void assign(l.entryId)}>{L('Assign', 'مقرر کریں')}</Button>
                      </div>
                    ))}
                    {!l.cover && l.unavailableCount > 0 && <p className="mt-1 text-xs text-ink-faint">{L(`${l.unavailableCount} other teacher(s) are not free in this period.`, `${l.unavailableCount} دیگر اساتذہ فارغ نہیں۔`)}</p>}
                  </li>
                ))}
              </ul>
            )}
        </Card>
      ))}

      <Card title={L('Upcoming substitutions (30 days)', 'آئندہ متبادل (30 دن)')} padded={false}>
        {list.isLoading ? <Spinner /> : !list.data?.data.length ? <EmptyState>{L('No substitutions.', 'کوئی متبادل نہیں۔')}</EmptyState> : (
          <Table>
            <thead><tr><th>{L('Date', 'تاریخ')}</th><th>{L('Period', 'پیریڈ')}</th><th>{L('Class', 'کلاس')}</th><th>{L('Subject', 'مضمون')}</th><th>{L('Absent', 'غیر حاضر')}</th><th>{L('Substitute', 'متبادل')}</th><th>{L('Reason', 'وجہ')}</th><th /></tr></thead>
            <tbody>{list.data.data.map((s) => (
              <tr key={s._id}><td className="num">{s.date}</td><td>{s.periodKey}</td><td>{s.classroom}</td><td>{s.subject}</td><td>{s.original ?? '—'}</td><td className="font-medium">{s.substitute}</td><td className="text-ink-soft">{s.reason ?? ''}</td>
                <td className="text-end">{!readOnly && <Button variant="ghost" onClick={() => setCancel(s)}><X className="h-4 w-4" />{L('Cancel', 'منسوخ')}</Button>}</td></tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
      <ConfirmDialog open={cancel !== null} danger title={L('Cancel this substitution?', 'یہ متبادل منسوخ کریں؟')} message={L('The regular teacher will be shown again and both teachers are notified. The record is kept in history.', 'باقاعدہ استاد دوبارہ دکھایا جائے گا۔ ریکارڈ محفوظ رہے گا۔')}
        loading={g.busy} onCancel={() => setCancel(null)} onConfirm={async () => { const id = cancel!._id; setCancel(null); await g.exec(() => post(`/api/timetable/substitutions/${id}/cancel`), L('Substitution cancelled.', 'متبادل منسوخ ہو گیا۔')); }} />
    </div>
  );
}
