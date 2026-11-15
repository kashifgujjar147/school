import { useState } from 'react';
import { Plus, UserPlus, X } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT } from '../i18n';
import { useAuth } from '../store/auth';
import { patch, post } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Select, Spinner, Tabs, errorMessage } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { useClasses, useClassrooms, useSessions, type ClassroomRow } from './shared';

export default function Classrooms() {
  const t = useT();
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'rooms' | 'classes'>('rooms');
  const rooms = useClassrooms(); const classes = useClasses(); const sessions = useSessions();
  const teachers = useGet<{ _id: string; fullName: string }[]>(can('users.view') ? '/api/users?role=teacher&status=active&pageSize=200' : null);
  const [err, setErr] = useState<string | null>(null);
  const inv = ['/api/academic'];
  const mut = useAction(async (fn: () => Promise<unknown>) => fn(), inv);
  const run = (fn: () => Promise<unknown>, after?: () => void) => mut.mutate(fn, { onSuccess: () => { setErr(null); after?.(); }, onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) });

  const [newRoom, setNewRoom] = useState<{ classId: string; sectionId: string; sessionId: string; name: string; room: string } | null>(null);
  const [assign, setAssign] = useState<{ room: ClassroomRow; teacherId: string; isHomeroom: boolean } | null>(null);
  const [newClass, setNewClass] = useState(''); const [newSection, setNewSection] = useState<Record<string, string>>({});

  const defaultSession = sessions.data?.data.find((s) => s.isDefault)?._id ?? '';
  const sectionsFor = (classId: string) => classes.data?.data.find((c) => c._id === classId)?.sections ?? [];

  return (
    <div>
      <PageHeader title={t('navClassrooms')} actions={can('classrooms.manage') && tab === 'rooms' && <Button onClick={() => setNewRoom({ classId: '', sectionId: '', sessionId: defaultSession, name: '', room: '' })}><Plus className="h-4 w-4" />{t('addClassroom')}</Button>} />
      <CacheNotice fromCache={rooms.data?.fromCache} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'rooms', label: t('classrooms') }, { value: 'classes', label: `${t('classes')} & ${t('sections')}` }]} />
      {err && <div className="mb-4"><Alert kind="error">{err}</Alert></div>}

      {tab === 'rooms' && (rooms.isLoading ? <Spinner /> : !rooms.data?.data.length ? <Card><EmptyState>Create classes and sections first, then add classrooms for the academic session.</EmptyState></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rooms.data.data.map((r) => (
            <div key={r._id} className="card flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-lg font-semibold">{r.name}</p><p className="text-sm text-ink-soft">{r.className} · {r.sectionName}{r.room ? ` · ${t('room')} ${r.room}` : ''}</p></div>
                <Badge>{t('studentsCount', { n: r.studentCount })}</Badge>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">{t('teachers')}</p>
                {r.teachers.length === 0 ? <p className="text-sm text-amber-700">{t('noTeacher')}</p> : (
                  <ul className="flex flex-wrap gap-2">{r.teachers.map((tc) => (
                    <li key={tc.assignmentId} className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted py-1 pe-1 ps-3 text-sm">
                      {tc.name}{tc.isHomeroom && <span className="text-xs text-accent">★</span>}
                      {can('assignments.manage') && <button className="rounded-full p-0.5 text-ink-faint hover:bg-white hover:text-red-600" aria-label={t('endAssignment')} onClick={() => run(() => post(`/api/academic/assignments/${tc.assignmentId}/end`))}><X className="h-3.5 w-3.5" /></button>}
                    </li>
                  ))}</ul>
                )}
              </div>
              <div className="mt-auto flex gap-2">
                {can('assignments.manage') && <Button variant="secondary" onClick={() => setAssign({ room: r, teacherId: '', isHomeroom: false })}><UserPlus className="h-4 w-4" />{t('assignTeacher')}</Button>}
                {can('classrooms.manage') && <Button variant="ghost" onClick={() => run(() => patch(`/api/academic/classrooms/${r._id}`, { archived: true }))}>{t('archive')}</Button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {tab === 'classes' && (
        <Card title={t('classes')} actions={can('academic.manage') && <div className="flex gap-2"><Input placeholder={t('class')} value={newClass} onChange={(e) => setNewClass(e.target.value)} /><Button disabled={!newClass} onClick={() => run(() => post('/api/academic/classes', { name: newClass, order: (classes.data?.data.length ?? 0) + 1 }), () => setNewClass(''))}><Plus className="h-4 w-4" />{t('addClass')}</Button></div>}>
          {!classes.data?.data.length ? <EmptyState /> : (
            <ul className="divide-y divide-surface-line">{classes.data.data.map((c) => (
              <li key={c._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.name}</span>{c.sections.map((s) => <Badge key={s._id}>{s.name}</Badge>)}</div>
                {can('academic.manage') && <div className="flex gap-2"><Input className="w-28" placeholder={t('section')} value={newSection[c._id] ?? ''} onChange={(e) => setNewSection({ ...newSection, [c._id]: e.target.value })} /><Button variant="secondary" disabled={!newSection[c._id]} onClick={() => run(() => post('/api/academic/sections', { classId: c._id, name: newSection[c._id] }), () => setNewSection({ ...newSection, [c._id]: '' }))}>{t('addSection')}</Button></div>}
              </li>
            ))}</ul>
          )}
        </Card>
      )}

      <Modal open={Boolean(newRoom)} onClose={() => setNewRoom(null)} title={t('addClassroom')} footer={<><Button variant="secondary" onClick={() => setNewRoom(null)}>{t('cancel')}</Button><Button loading={mut.isPending} disabled={!newRoom?.classId || !newRoom.sectionId || !newRoom.sessionId || !newRoom.name} onClick={() => run(() => post('/api/academic/classrooms', { ...newRoom, room: newRoom!.room || null }), () => setNewRoom(null))}>{t('create')}</Button></>}>
        {newRoom && <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('academicSession')} value={newRoom.sessionId} onChange={(e) => setNewRoom({ ...newRoom, sessionId: e.target.value })} placeholder="—" options={(sessions.data?.data ?? []).map((s) => ({ value: s._id, label: s.name }))} />
          <Select label={t('class')} value={newRoom.classId} onChange={(e) => { const c = classes.data?.data.find((x) => x._id === e.target.value); setNewRoom({ ...newRoom, classId: e.target.value, sectionId: '', name: c?.name ?? '' }); }} placeholder="—" options={(classes.data?.data ?? []).map((c) => ({ value: c._id, label: c.name }))} />
          <Select label={t('section')} value={newRoom.sectionId} onChange={(e) => { const s = sectionsFor(newRoom.classId).find((x) => x._id === e.target.value); const c = classes.data?.data.find((x) => x._id === newRoom.classId); setNewRoom({ ...newRoom, sectionId: e.target.value, name: `${c?.name ?? ''}-${s?.name ?? ''}` }); }} placeholder="—" options={sectionsFor(newRoom.classId).map((s) => ({ value: s._id, label: s.name }))} />
          <Input label={t('name')} value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} />
          <Input label={t('room')} value={newRoom.room} onChange={(e) => setNewRoom({ ...newRoom, room: e.target.value })} />
        </div>}
      </Modal>

      <Modal open={Boolean(assign)} onClose={() => setAssign(null)} title={`${t('assignTeacher')} — ${assign?.room.name}`} footer={<><Button variant="secondary" onClick={() => setAssign(null)}>{t('cancel')}</Button><Button loading={mut.isPending} disabled={!assign?.teacherId} onClick={() => run(() => post('/api/academic/assignments', { teacherId: assign!.teacherId, classroomId: assign!.room._id, isHomeroom: assign!.isHomeroom }), () => setAssign(null))}>{t('save')}</Button></>}>
        {assign && <div className="space-y-4">
          <Select label={t('teacher')} value={assign.teacherId} onChange={(e) => setAssign({ ...assign, teacherId: e.target.value })} placeholder="—" options={(teachers.data?.data ?? []).filter((x) => !assign.room.teachers.some((tc) => tc.id === x._id)).map((x) => ({ value: x._id, label: x.fullName }))} />
          <Checkbox label={t('homeroom')} checked={assign.isHomeroom} onChange={(v) => setAssign({ ...assign, isHomeroom: v })} />
        </div>}
      </Modal>
    </div>
  );
}
