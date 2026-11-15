import { useEffect, useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { teachingSlots } from '@sms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '../../hooks/useApi';
import { put } from '../../services/api';
import { Alert, Button, Card, EmptyState, ErrorState, Select, Spinner } from '../../components/ui';
import { useL } from '../../timetable/common';
import { useGuardedAction, type Board } from './api';

interface Row { subjectId: string; periodsPerWeek: number; maxPerDay: number; teacherId: string; roomId: string; allowDouble: boolean }

/** Weekly subject requirements per class section: the input of the automatic generator. */
export default function RequirementsTab({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const L = useL();
  const qc = useQueryClient();
  const q = useGet<Board>(`/api/timetable/board?sessionId=${sessionId}&state=draft`);
  const g = useGuardedAction(() => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable') }));
  const [classroomId, setClassroomId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [copyFrom, setCopyFrom] = useState('');
  const b = q.data?.data;
  const classrooms = useMemo(() => (b?.classrooms ?? []).slice().sort((x, y) => x.classOrder - y.classOrder || x.name.localeCompare(y.name)), [b]);
  useEffect(() => { if (!classroomId && classrooms.length) setClassroomId(classrooms[0]!._id); }, [classrooms, classroomId]);
  useEffect(() => {
    if (!b || !classroomId) return;
    setRows(b.requirements.filter((r) => r.classroomId === classroomId).map((r) => ({ subjectId: r.subjectId, periodsPerWeek: r.periodsPerWeek, maxPerDay: r.maxPerDay, teacherId: r.teacherId ?? '', roomId: r.roomId ?? '', allowDouble: Boolean(r.allowDouble) })));
  }, [b, classroomId]);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !b) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!classrooms.length) return <EmptyState>{L('There are no classrooms in this session yet. Create them under Classrooms.', 'اس سیشن میں ابھی کوئی کلاس روم نہیں۔')}</EmptyState>;
  const subjects = b.subjects.filter((s) => !s.archived);
  if (!subjects.length) return <EmptyState>{L('Add subjects on the "Subjects & rooms" tab first.', 'پہلے مضامین شامل کریں۔')}</EmptyState>;
  const capacity = b.config ? teachingSlots(b.config).length : null;
  const total = rows.reduce((a, r) => a + r.periodsPerWeek, 0);
  const qualified = (subjectId: string) => new Set(b.profiles.filter((p) => p.subjectIds.includes(subjectId)).map((p) => p.teacherId));
  const upd = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = () => g.exec(() => put(`/api/timetable/requirements/${classroomId}`, {
    sessionId, items: rows.filter((r) => r.subjectId).map((r) => ({ subjectId: r.subjectId, periodsPerWeek: r.periodsPerWeek, maxPerDay: Math.max(1, r.maxPerDay), teacherId: r.teacherId || null, roomId: r.roomId || null, allowDouble: r.allowDouble }))
  }), L('Weekly periods saved.', 'ہفتہ وار پیریڈ محفوظ ہو گئے۔'));
  const dupe = new Set(rows.map((r) => r.subjectId)).size !== rows.length;

  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Select label={L('Class / section', 'کلاس / سیکشن')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)} options={classrooms.map((c) => ({ value: c._id, label: c.name }))} /></div>
          {!readOnly && <div className="flex items-end gap-2">
            <div className="w-56"><Select label={L('Copy from', 'سے نقل کریں')} value={copyFrom} placeholder={L('Choose a class', 'کلاس منتخب کریں')} onChange={(e) => setCopyFrom(e.target.value)} options={classrooms.filter((c) => c._id !== classroomId).map((c) => ({ value: c._id, label: c.name }))} /></div>
            <Button variant="secondary" disabled={!copyFrom} onClick={() => setRows(b.requirements.filter((r) => r.classroomId === copyFrom).map((r) => ({ subjectId: r.subjectId, periodsPerWeek: r.periodsPerWeek, maxPerDay: r.maxPerDay, teacherId: '', roomId: r.roomId ?? '', allowDouble: Boolean(r.allowDouble) })))}><Copy className="h-4 w-4" />{L('Copy', 'نقل')}</Button>
          </div>}
          <p className="ms-auto text-sm">{L('Periods per week', 'ہفتہ وار پیریڈ')}: <span className={`num font-semibold ${capacity !== null && total > capacity ? 'text-red-700' : ''}`}>{total}</span>{capacity !== null && <span className="text-ink-faint"> / {capacity} {L('available', 'دستیاب')}</span>}</p>
        </div>
      </Card>
      {capacity !== null && total > capacity && <Alert kind="error">{L(`This class needs ${total} periods but the week has only ${capacity} teaching periods. Reduce periods or add periods / working days.`, `اس کلاس کو ${total} پیریڈ چاہییں لیکن ہفتے میں صرف ${capacity} ہیں۔`)}</Alert>}
      {!b.config && <Alert kind="warning">{L('School timings are not set for this session yet.', 'اس سیشن کے اوقات ابھی طے نہیں۔')}</Alert>}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-surface-line text-xs text-ink-soft">
              <th className="p-2 text-start">{L('Subject', 'مضمون')}</th><th className="p-2 text-start">{L('Periods / week', 'ہفتہ وار')}</th><th className="p-2 text-start">{L('Max / day', 'روزانہ حد')}</th>
              <th className="p-2 text-start">{L('Teacher', 'استاد')}</th><th className="p-2 text-start">{L('Room', 'کمرہ')}</th><th className="p-2 text-start">{L('Double lessons', 'دوہرا پیریڈ')}</th><th />
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-ink-faint">{L('No subjects for this class yet.', 'اس کلاس کے لیے ابھی کوئی مضمون نہیں۔')}</td></tr>}
              {rows.map((r, i) => {
                const qual = qualified(r.subjectId);
                return (
                  <tr key={i} className="border-b border-surface-line">
                    <td className="p-2"><select className="input" aria-label={L('Subject', 'مضمون')} value={r.subjectId} disabled={readOnly} onChange={(e) => upd(i, { subjectId: e.target.value, teacherId: '' })}>
                      <option value="">—</option>{subjects.map((s) => <option key={s._id} value={s._id} disabled={s._id !== r.subjectId && rows.some((x) => x.subjectId === s._id)}>{s.name}</option>)}</select></td>
                    <td className="p-2"><input className="input w-20" type="number" min={0} max={40} aria-label={L('Periods / week', 'ہفتہ وار')} value={r.periodsPerWeek} disabled={readOnly} onChange={(e) => upd(i, { periodsPerWeek: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} /></td>
                    <td className="p-2"><input className="input w-20" type="number" min={1} max={12} aria-label={L('Max / day', 'روزانہ حد')} value={r.maxPerDay} disabled={readOnly} onChange={(e) => upd(i, { maxPerDay: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} /></td>
                    <td className="p-2"><select className="input" aria-label={L('Teacher', 'استاد')} value={r.teacherId} disabled={readOnly} onChange={(e) => upd(i, { teacherId: e.target.value })}>
                      <option value="">{L('Automatic (qualified teacher)', 'خودکار (اہل استاد)')}</option>
                      {b.teachers.slice().sort((x, y) => Number(qual.has(y._id)) - Number(qual.has(x._id)) || x.fullName.localeCompare(y.fullName)).map((t) => <option key={t._id} value={t._id}>{qual.has(t._id) ? '✓ ' : ''}{t.fullName}</option>)}
                    </select>{!r.teacherId && r.subjectId && qual.size === 0 && <p className="mt-1 text-xs text-amber-700">{L('No teacher has this subject in their profile.', 'کسی استاد کی پروفائل میں یہ مضمون نہیں۔')}</p>}</td>
                    <td className="p-2"><select className="input" aria-label={L('Room', 'کمرہ')} value={r.roomId} disabled={readOnly} onChange={(e) => upd(i, { roomId: e.target.value })}>
                      <option value="">{L("Class's own room", 'کلاس کا اپنا کمرہ')}</option>{b.rooms.filter((x) => !x.archived).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}</select></td>
                    <td className="p-2"><input type="checkbox" aria-label={L('Double lessons allowed', 'دوہرا پیریڈ')} checked={r.allowDouble} disabled={readOnly} onChange={(e) => upd(i, { allowDouble: e.target.checked })} /></td>
                    <td className="p-2 text-end">{!readOnly && <button type="button" className="rounded p-1.5 text-red-600 hover:bg-red-50" aria-label={L('Remove', 'ہٹائیں')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap justify-between gap-2 p-3">
            <Button variant="secondary" disabled={rows.length >= subjects.length} onClick={() => setRows([...rows, { subjectId: subjects.find((s) => !rows.some((r) => r.subjectId === s._id))?._id ?? '', periodsPerWeek: 4, maxPerDay: 1, teacherId: '', roomId: '', allowDouble: false }])}><Plus className="h-4 w-4" />{L('Add subject', 'مضمون شامل کریں')}</Button>
            <Button loading={g.busy} disabled={dupe || rows.some((r) => !r.subjectId)} onClick={() => void save()}>{L('Save weekly periods', 'محفوظ کریں')}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
