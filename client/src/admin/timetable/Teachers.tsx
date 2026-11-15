import { useState } from 'react';
import { Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '../../hooks/useApi';
import { put } from '../../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Spinner, Table } from '../../components/ui';
import { subjectColor, useL } from '../../timetable/common';
import { SlotPicker, useGuardedAction, type Board } from './api';

interface Edit { teacherId: string; name: string; subjectIds: string[]; maxPerDay: string; maxPerWeek: string; unavailable: string[] }

/** Which subjects each teacher teaches, when they are unavailable, and their load limits. */
export default function TeachersTab({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const L = useL();
  const qc = useQueryClient();
  const q = useGet<Board>(`/api/timetable/board?sessionId=${sessionId}&state=draft`);
  const g = useGuardedAction(() => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable') }));
  const [edit, setEdit] = useState<Edit | null>(null);
  const [search, setSearch] = useState('');
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data.data;
  const subjects = b.subjects.filter((s) => !s.archived);
  const list = b.teachers.filter((t) => t.fullName.toLowerCase().includes(search.trim().toLowerCase()));
  const save = () => g.exec(async () => {
    await put(`/api/timetable/teachers/${edit!.teacherId}/profile`, { sessionId, subjectIds: edit!.subjectIds, maxPerDay: edit!.maxPerDay ? Number(edit!.maxPerDay) : null, maxPerWeek: edit!.maxPerWeek ? Number(edit!.maxPerWeek) : null, unavailable: edit!.unavailable });
    setEdit(null);
  }, L('Teacher profile saved.', 'استاد کی پروفائل محفوظ ہو گئی۔'));
  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      <Card padded={false}>
        <div className="p-3"><label className="relative block max-w-sm"><span className="sr-only">{L('Search', 'تلاش')}</span><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" /><input className="input ps-9" placeholder={L('Search teachers', 'اساتذہ تلاش کریں')} value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
        {list.length === 0 ? <EmptyState>{L('No active teacher accounts. Add teachers under Users.', 'کوئی فعال استاد نہیں۔')}</EmptyState> : (
          <Table>
            <thead><tr><th>{L('Teacher', 'استاد')}</th><th>{L('Subjects', 'مضامین')}</th><th>{L('Limit / day', 'روزانہ حد')}</th><th>{L('Limit / week', 'ہفتہ وار حد')}</th><th>{L('Unavailable', 'غیر دستیاب')}</th><th>{L('Draft load', 'مسودہ بوجھ')}</th><th /></tr></thead>
            <tbody>
              {list.map((t) => {
                const p = b.profiles.find((x) => x.teacherId === t._id);
                const load = b.entries.filter((e) => e.teacherId === t._id).length;
                const week = p?.maxPerWeek ?? b.config?.teacherMaxPerWeek ?? null;
                return (
                  <tr key={t._id}>
                    <td className="font-medium">{t.fullName}</td>
                    <td><span className="flex flex-wrap gap-1">{(p?.subjectIds ?? []).map((id) => { const s = b.subjects.find((x) => x._id === id); return s ? <span key={id} className="rounded px-1.5 py-0.5 text-[11px] text-white" style={{ background: subjectColor(s.name, s.color) }}>{s.name}</span> : null; })}{!p?.subjectIds.length && <span className="text-xs text-ink-faint">{L('Not set', 'طے نہیں')}</span>}</span></td>
                    <td className="num">{p?.maxPerDay ?? (b.config?.teacherMaxPerDay ? `${b.config.teacherMaxPerDay}*` : '—')}</td>
                    <td className="num">{p?.maxPerWeek ?? (b.config?.teacherMaxPerWeek ? `${b.config.teacherMaxPerWeek}*` : '—')}</td>
                    <td className="num">{p?.unavailable.length || '—'}</td>
                    <td className="num">{week !== null && load > week ? <Badge color="red">{load} / {week}</Badge> : load}</td>
                    <td className="text-end">{!readOnly && <Button variant="ghost" onClick={() => setEdit({ teacherId: t._id, name: t.fullName, subjectIds: p?.subjectIds ?? [], maxPerDay: p?.maxPerDay ? String(p.maxPerDay) : '', maxPerWeek: p?.maxPerWeek ? String(p.maxPerWeek) : '', unavailable: p?.unavailable ?? [] })}>{L('Edit', 'ترمیم')}</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="px-5 pb-3 text-xs text-ink-faint">* {L('school default from School timings', 'اسکول اوقات سے طے شدہ')}</p>
      </Card>
      <Modal open={edit !== null} onClose={() => setEdit(null)} wide title={edit?.name ?? ''}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{L('Cancel', 'منسوخ')}</Button><Button loading={g.busy} onClick={() => void save()}>{L('Save', 'محفوظ کریں')}</Button></>}>
        {edit && <div className="space-y-5">
          <fieldset>
            <legend className="label">{L('Subjects this teacher can teach', 'یہ استاد کون سے مضامین پڑھا سکتا ہے')}</legend>
            {subjects.length === 0 ? <p className="text-sm text-ink-faint">{L('Add subjects first.', 'پہلے مضامین شامل کریں۔')}</p> : (
              <div className="flex flex-wrap gap-2">{subjects.map((s) => (
                <label key={s._id} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line px-2.5 py-1.5 text-sm">
                  <input type="checkbox" checked={edit.subjectIds.includes(s._id)} onChange={(e) => setEdit({ ...edit, subjectIds: e.target.checked ? [...edit.subjectIds, s._id] : edit.subjectIds.filter((x) => x !== s._id) })} />{s.name}
                </label>
              ))}</div>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input type="number" min={1} max={24} label={L('Max periods per day', 'روزانہ زیادہ سے زیادہ')} hint={L('Empty = school default', 'خالی = اسکول کی طے شدہ')} value={edit.maxPerDay} onChange={(e) => setEdit({ ...edit, maxPerDay: e.target.value })} />
            <Input type="number" min={1} max={100} label={L('Max periods per week', 'ہفتہ وار زیادہ سے زیادہ')} hint={L('Empty = school default', 'خالی = اسکول کی طے شدہ')} value={edit.maxPerWeek} onChange={(e) => setEdit({ ...edit, maxPerWeek: e.target.value })} />
          </div>
          {b.config ? <SlotPicker config={b.config} value={edit.unavailable} onChange={(u) => setEdit({ ...edit, unavailable: u })} label={L('Unavailable periods', 'غیر دستیاب پیریڈ')} /> : <p className="text-sm text-ink-faint">{L('Save the school timings first to mark unavailable periods.', 'پہلے اوقات محفوظ کریں۔')}</p>}
        </div>}
      </Modal>
    </div>
  );
}
