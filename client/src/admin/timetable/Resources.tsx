import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ROOM_KINDS } from '@sms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '../../hooks/useApi';
import { patch, post } from '../../services/api';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Input, Modal, Select, Spinner, Table } from '../../components/ui';
import { subjectColor, useL } from '../../timetable/common';
import { SlotPicker, useGuardedAction, type ConfigDoc, type RoomRow, type SubjectRow } from './api';

/** Subjects (shared by every class) and rooms / labs with their unavailable periods. */
export default function ResourcesTab({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const L = useL();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const subjects = useGet<SubjectRow[]>(`/api/timetable/subjects?archived=${showArchived}`);
  const rooms = useGet<RoomRow[]>(`/api/timetable/rooms?archived=${showArchived}`);
  const cfg = useGet<ConfigDoc | null>(`/api/timetable/config?sessionId=${sessionId}`);
  const reload = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable') });
  const g = useGuardedAction(reload);
  const [subj, setSubj] = useState<{ id?: string; name: string; code: string; color: string } | null>(null);
  const [room, setRoom] = useState<{ id?: string; name: string; kind: string; capacity: string; unavailable: string[] } | null>(null);
  const kindLabel: Record<string, string> = { classroom: L('Classroom', 'کلاس روم'), lab: L('Laboratory', 'لیبارٹری'), hall: L('Hall', 'ہال'), library: L('Library', 'لائبریری'), ground: L('Ground', 'گراؤنڈ'), other: L('Other', 'دیگر') };

  if (subjects.isLoading || rooms.isLoading) return <Spinner />;
  if (subjects.isError) return <ErrorState error={subjects.error} onRetry={() => subjects.refetch()} />;
  const saveSubject = () => g.exec(async () => {
    const body = { name: subj!.name.trim(), code: subj!.code.trim() || null, color: subj!.color || null };
    if (subj!.id) await patch(`/api/timetable/subjects/${subj!.id}`, body); else await post('/api/timetable/subjects', body);
    setSubj(null);
  }, L('Subject saved.', 'مضمون محفوظ ہو گیا۔'));
  const saveRoom = () => g.exec(async () => {
    const body = { name: room!.name.trim(), kind: room!.kind, capacity: room!.capacity ? Number(room!.capacity) : null, unavailable: room!.unavailable };
    if (room!.id) await patch(`/api/timetable/rooms/${room!.id}`, body); else await post('/api/timetable/rooms', body);
    setRoom(null);
  }, L('Room saved.', 'کمرہ محفوظ ہو گیا۔'));

  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      <Checkbox label={L('Show archived', 'محفوظ شدہ (آرکائیو) دکھائیں')} checked={showArchived} onChange={setShowArchived} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={L('Subjects', 'مضامین')} actions={!readOnly && <Button onClick={() => setSubj({ name: '', code: '', color: '' })}><Plus className="h-4 w-4" />{L('Add subject', 'مضمون شامل کریں')}</Button>} padded={false}>
          {!subjects.data?.data.length ? <EmptyState>{L('No subjects yet. Add the subjects your school teaches.', 'ابھی کوئی مضمون نہیں۔')}</EmptyState> : (
            <Table>
              <thead><tr><th>{L('Subject', 'مضمون')}</th><th>{L('Code', 'کوڈ')}</th><th /></tr></thead>
              <tbody>
                {subjects.data.data.map((s) => (
                  <tr key={s._id}>
                    <td><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: subjectColor(s.name, s.color) }} aria-hidden />{s.name}{s.archived && <Badge>{L('Archived', 'آرکائیو')}</Badge>}</span></td>
                    <td className="num">{s.code ?? ''}</td>
                    <td className="text-end">{!readOnly && <>
                      <Button variant="ghost" onClick={() => setSubj({ id: s._id, name: s.name, code: s.code ?? '', color: s.color ?? '' })}>{L('Edit', 'ترمیم')}</Button>
                      <Button variant="ghost" onClick={() => void g.exec(() => patch(`/api/timetable/subjects/${s._id}`, { archived: !s.archived }))}>{s.archived ? L('Restore', 'بحال') : L('Archive', 'آرکائیو')}</Button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={L('Rooms & labs', 'کمرے اور لیبز')} actions={!readOnly && <Button onClick={() => setRoom({ name: '', kind: 'lab', capacity: '', unavailable: [] })}><Plus className="h-4 w-4" />{L('Add room', 'کمرہ شامل کریں')}</Button>} padded={false}>
          <p className="px-5 pt-3 text-xs text-ink-faint">{L('Only rooms that several classes share (labs, halls) need to be added. A lesson without a room uses the class\'s own room.', 'صرف مشترکہ کمرے (لیب، ہال) شامل کریں۔')}</p>
          {!rooms.data?.data.length ? <EmptyState>{L('No rooms yet.', 'ابھی کوئی کمرہ نہیں۔')}</EmptyState> : (
            <Table>
              <thead><tr><th>{L('Room', 'کمرہ')}</th><th>{L('Type', 'قسم')}</th><th>{L('Capacity', 'گنجائش')}</th><th>{L('Unavailable', 'غیر دستیاب')}</th><th /></tr></thead>
              <tbody>
                {rooms.data.data.map((r) => (
                  <tr key={r._id}>
                    <td>{r.name} {r.archived && <Badge>{L('Archived', 'آرکائیو')}</Badge>}</td>
                    <td>{kindLabel[r.kind] ?? r.kind}</td>
                    <td className="num">{r.capacity ?? '—'}</td>
                    <td className="num">{r.unavailable.length || '—'}</td>
                    <td className="text-end">{!readOnly && <>
                      <Button variant="ghost" onClick={() => setRoom({ id: r._id, name: r.name, kind: r.kind, capacity: r.capacity ? String(r.capacity) : '', unavailable: r.unavailable })}>{L('Edit', 'ترمیم')}</Button>
                      <Button variant="ghost" onClick={() => void g.exec(() => patch(`/api/timetable/rooms/${r._id}`, { archived: !r.archived }))}>{r.archived ? L('Restore', 'بحال') : L('Archive', 'آرکائیو')}</Button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Modal open={subj !== null} onClose={() => setSubj(null)} title={subj?.id ? L('Edit subject', 'مضمون میں ترمیم') : L('Add subject', 'مضمون شامل کریں')}
        footer={<><Button variant="secondary" onClick={() => setSubj(null)}>{L('Cancel', 'منسوخ')}</Button><Button loading={g.busy} disabled={!subj?.name.trim()} onClick={() => void saveSubject()}>{L('Save', 'محفوظ کریں')}</Button></>}>
        {subj && <div className="space-y-4">
          <Input label={L('Name', 'نام')} value={subj.name} maxLength={80} onChange={(e) => setSubj({ ...subj, name: e.target.value })} />
          <Input label={L('Short code (optional)', 'مختصر کوڈ')} value={subj.code} maxLength={16} onChange={(e) => setSubj({ ...subj, code: e.target.value })} />
          <Input type="color" label={L('Colour', 'رنگ')} value={subj.color || subjectColor(subj.name || 'x')} onChange={(e) => setSubj({ ...subj, color: e.target.value })} />
        </div>}
      </Modal>
      <Modal open={room !== null} onClose={() => setRoom(null)} wide title={room?.id ? L('Edit room', 'کمرے میں ترمیم') : L('Add room', 'کمرہ شامل کریں')}
        footer={<><Button variant="secondary" onClick={() => setRoom(null)}>{L('Cancel', 'منسوخ')}</Button><Button loading={g.busy} disabled={!room?.name.trim()} onClick={() => void saveRoom()}>{L('Save', 'محفوظ کریں')}</Button></>}>
        {room && <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label={L('Name', 'نام')} value={room.name} maxLength={60} onChange={(e) => setRoom({ ...room, name: e.target.value })} />
            <Select label={L('Type', 'قسم')} value={room.kind} onChange={(e) => setRoom({ ...room, kind: e.target.value })} options={ROOM_KINDS.map((k) => ({ value: k, label: kindLabel[k] ?? k }))} />
            <Input type="number" min={1} label={L('Capacity', 'گنجائش')} value={room.capacity} onChange={(e) => setRoom({ ...room, capacity: e.target.value })} />
          </div>
          {cfg.data?.data ? <SlotPicker config={cfg.data.data} value={room.unavailable} onChange={(u) => setRoom({ ...room, unavailable: u })} label={L('Periods when this room cannot be booked', 'جب یہ کمرہ دستیاب نہیں')} />
            : <p className="text-sm text-ink-faint">{L('Save the school timings first to mark unavailable periods.', 'غیر دستیاب پیریڈ کے لیے پہلے اوقات محفوظ کریں۔')}</p>}
        </div>}
      </Modal>
    </div>
  );
}
