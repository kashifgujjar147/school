import { useEffect, useState } from 'react';
import { ArrowUpRight, Plus, RotateCcw, UserPlus, X } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT } from '../i18n';
import { useAuth } from '../store/auth';
import { getPaged, patch, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea, errorMessage } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { useClasses, useSessions, type ClassroomRow } from './shared';

type ClassEdit = { _id: string; name: string; order: number; archived: boolean; sections: { _id: string; name: string; archived: boolean }[] };

/** Rename / reorder / archive a class and its sections (PATCH /api/academic/classes/:id and /sections/:id). */
function EditClassDialog({ initial, onClose, onSaved }: { initial: ClassEdit; onClose: () => void; onSaved: (text: string) => void }) {
  const t = useT();
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/academic']);
  const run = (fn: () => Promise<unknown>) => act.mutate(fn, { onSuccess: () => { setErr(null); onSaved(t('saved')); }, onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) });
  const setSection = (id: string, patchV: Partial<{ name: string; archived: boolean }>) => setV({ ...v, sections: v.sections.map((x) => (x._id === id ? { ...x, ...patchV } : x)) });
  return (
    <Modal open onClose={onClose} title={`${t('edit')} — ${initial.name}`} footer={<Button variant="secondary" onClick={onClose}>{t('close')}</Button>}>
      <div className="space-y-5">
        {err && <Alert kind="error">{err}</Alert>}
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_6rem_auto]">
          <Input label={t('class')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <Input type="number" min={0} label="#" value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} />
          <Button loading={act.isPending} disabled={!v.name.trim()} onClick={() => run(() => patch(`/api/academic/classes/${v._id}`, { name: v.name.trim(), order: v.order, archived: v.archived }))}>{t('save')}</Button>
        </div>
        <Checkbox label={t('archived')} checked={v.archived} onChange={(x) => setV({ ...v, archived: x })} />
        <div className="space-y-2 border-t border-surface-line pt-4">
          <p className="label">{t('sections')}</p>
          {v.sections.length === 0 ? <EmptyState /> : v.sections.map((sec) => (
            <div key={sec._id} className="flex flex-wrap items-center gap-3">
              <Input className="w-32" aria-label={t('section')} value={sec.name} onChange={(e) => setSection(sec._id, { name: e.target.value })} />
              <Checkbox label={t('archived')} checked={sec.archived} onChange={(x) => setSection(sec._id, { archived: x })} />
              <Button variant="secondary" disabled={!sec.name.trim()} onClick={() => run(() => patch(`/api/academic/sections/${sec._id}`, { name: sec.name.trim(), archived: sec.archived }))}>{t('save')}</Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

interface PromoteState { room: ClassroomRow; toClassroomId: string; reason: string; selected: Set<string> }

/** Year-end promotion / moving a whole class: wraps POST /api/students/bulk-promote. */
function PromoteDialog({ state, rooms, onClose, onDone }: { state: PromoteState; rooms: ClassroomRow[]; onClose: () => void; onDone: (text: string) => void }) {
  const t = useT();
  const [v, setV] = useState(state);
  const [students, setStudents] = useState<{ _id: string; fullName: string; admissionNumber: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = useAction(() => post<{ moved: number; skipped: number }>('/api/students/bulk-promote', { fromClassroomId: v.room._id, toClassroomId: v.toClassroomId, studentIds: [...v.selected], reason: v.reason }), ['/api/academic', '/api/students']);
  useEffect(() => {
    let alive = true;
    getPaged<{ _id: string; fullName: string; admissionNumber: string }>(`/api/students${qs({ classroomId: state.room._id, status: 'active', pageSize: 200, sort: 'fullName' })}`)
      .then((r) => { if (alive) { setStudents(r.items); setV((x) => ({ ...x, selected: new Set(r.items.map((s) => s._id)) })); } })
      .catch((e) => { if (alive) setErr(errorMessage(e, t('errorGeneric'))); });
    return () => { alive = false; };
  }, [state.room._id, t]);
  const toggle = (id: string, on: boolean) => setV((x) => { const s = new Set(x.selected); if (on) s.add(id); else s.delete(id); return { ...x, selected: s }; });
  const ready = v.toClassroomId && v.selected.size > 0 && v.reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} wide title={`${t('bulkPromote')} — ${v.room.name}`} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
      <Button loading={act.isPending} disabled={!ready} onClick={() => act.mutate(undefined, { onSuccess: (r) => onDone(t('promoted', { moved: r.moved, skipped: r.skipped })), onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) })}>{t('save')}</Button>
    </>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">{t('promoteHelp', { room: v.room.name })}</p>
        {err && <Alert kind="error">{err}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('promoteTo')} value={v.toClassroomId} onChange={(e) => { const to = e.target.value; setV((x) => ({ ...x, toClassroomId: to })); }} placeholder="—" options={rooms.filter((r) => r._id !== v.room._id && !r.archived).map((r) => ({ value: r._id, label: r.name }))} />
          <Textarea label={t('reason')} value={v.reason} onChange={(e) => { const reason = e.target.value; setV((x) => ({ ...x, reason })); }} hint={t('reasonMin')} />
        </div>
        {!students ? <Spinner /> : students.length === 0 ? <EmptyState /> : (
          <div className="rounded-xl border border-surface-line">
            <div className="border-b border-surface-line px-4 py-2"><Checkbox label={`${t('selectAll')} (${v.selected.size}/${students.length})`} checked={v.selected.size === students.length} onChange={(on) => setV((x) => ({ ...x, selected: new Set(on ? students.map((s) => s._id) : []) }))} /></div>
            <ul className="grid max-h-72 gap-1 overflow-y-auto p-3 sm:grid-cols-2">{students.map((s) => <li key={s._id}><Checkbox label={<span>{s.fullName} <span className="num text-xs text-ink-faint">{s.admissionNumber}</span></span>} checked={v.selected.has(s._id)} onChange={(on) => toggle(s._id, on)} /></li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Classrooms() {
  const t = useT();
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'rooms' | 'classes'>('rooms');
  const [showArchived, setShowArchived] = useState(false);
  const rooms = useGet<ClassroomRow[]>(`/api/academic/classrooms${showArchived ? '?includeArchived=true' : ''}`);
  const classes = useClasses(); const sessions = useSessions();
  const teachers = useGet<{ _id: string; fullName: string }[]>(can('users.view') ? '/api/users?role=teacher&status=active&pageSize=200' : null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inv = ['/api/academic'];
  const mut = useAction(async (fn: () => Promise<unknown>) => fn(), inv);
  const run = (fn: () => Promise<unknown>, after?: () => void, ok?: string) => mut.mutate(fn, { onSuccess: () => { setErr(null); setNotice(ok ?? null); after?.(); }, onError: (e) => { setNotice(null); setErr(errorMessage(e, t('errorGeneric'))); } });

  const [newRoom, setNewRoom] = useState<{ classId: string; sectionId: string; sessionId: string; name: string; room: string } | null>(null);
  const [assign, setAssign] = useState<{ room: ClassroomRow; teacherId: string; isHomeroom: boolean } | null>(null);
  const [archiving, setArchiving] = useState<ClassroomRow | null>(null);
  const [promote, setPromote] = useState<PromoteState | null>(null);
  const [editClass, setEditClass] = useState<ClassEdit | null>(null);
  const [newClass, setNewClass] = useState(''); const [newSection, setNewSection] = useState<Record<string, string>>({});

  const defaultSession = sessions.data?.data.find((s) => s.isDefault)?._id ?? '';
  const sectionsFor = (classId: string) => classes.data?.data.find((c) => c._id === classId)?.sections ?? [];
  const roomList = rooms.data?.data ?? [];

  return (
    <div>
      <PageHeader title={t('navClassrooms')} actions={can('classrooms.manage') && tab === 'rooms' && <Button onClick={() => setNewRoom({ classId: '', sectionId: '', sessionId: defaultSession, name: '', room: '' })}><Plus className="h-4 w-4" />{t('addClassroom')}</Button>} />
      <CacheNotice fromCache={rooms.data?.fromCache} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'rooms', label: t('classrooms') }, { value: 'classes', label: `${t('classes')} & ${t('sections')}` }]} />
      {err && <div className="mb-4"><Alert kind="error">{err}</Alert></div>}
      {notice && <div className="mb-4"><Alert kind="success">{notice}</Alert></div>}

      {tab === 'rooms' && (
        <>
          <div className="mb-4"><Checkbox label={t('showArchived')} checked={showArchived} onChange={setShowArchived} /></div>
          {rooms.isLoading ? <Spinner /> : !roomList.length ? <Card><EmptyState>Create classes and sections first, then add classrooms for the academic session.</EmptyState></Card> : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {roomList.map((r) => (
                <div key={r._id} className={`card flex flex-col gap-4 p-5${r.archived ? ' opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div><p className="text-lg font-semibold">{r.name}</p><p className="text-sm text-ink-soft">{r.className} · {r.sectionName}{r.room ? ` · ${t('room')} ${r.room}` : ''}</p></div>
                    <div className="flex flex-col items-end gap-1"><Badge>{t('studentsCount', { n: r.studentCount })}</Badge>{r.archived && <Badge color="amber">{t('archived')}</Badge>}</div>
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
                  <div className="mt-auto flex flex-wrap gap-2">
                    {!r.archived && can('assignments.manage') && <Button variant="secondary" onClick={() => setAssign({ room: r, teacherId: '', isHomeroom: false })}><UserPlus className="h-4 w-4" />{t('assignTeacher')}</Button>}
                    {!r.archived && r.studentCount > 0 && can('students.manage') && <Button variant="secondary" onClick={() => setPromote({ room: r, toClassroomId: '', reason: '', selected: new Set() })}><ArrowUpRight className="h-4 w-4" />{t('bulkPromote')}</Button>}
                    {can('classrooms.manage') && (r.archived
                      ? <Button variant="ghost" onClick={() => run(() => patch(`/api/academic/classrooms/${r._id}`, { archived: false }), undefined, t('saved'))}><RotateCcw className="h-4 w-4" />{t('unarchive')}</Button>
                      : <Button variant="ghost" onClick={() => setArchiving(r)}>{t('archive')}</Button>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'classes' && (
        <Card title={t('classes')} actions={can('academic.manage') && <div className="flex gap-2"><Input placeholder={t('class')} value={newClass} onChange={(e) => setNewClass(e.target.value)} /><Button disabled={!newClass} onClick={() => run(() => post('/api/academic/classes', { name: newClass, order: (classes.data?.data.length ?? 0) + 1 }), () => setNewClass(''))}><Plus className="h-4 w-4" />{t('addClass')}</Button></div>}>
          {!classes.data?.data.length ? <EmptyState /> : (
            <ul className="divide-y divide-surface-line">{classes.data.data.map((c) => (
              <li key={c._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.name}</span>{c.archived && <Badge color="amber">{t('archived')}</Badge>}{c.sections.map((s) => <Badge key={s._id} color={s.archived ? 'amber' : 'gray'}>{s.name}</Badge>)}</div>
                {can('academic.manage') && <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setEditClass({ _id: c._id, name: c.name, order: c.order, archived: c.archived, sections: c.sections.map((x) => ({ ...x })) })}>{t('edit')}</Button><Input className="w-28" placeholder={t('section')} value={newSection[c._id] ?? ''} onChange={(e) => setNewSection({ ...newSection, [c._id]: e.target.value })} /><Button variant="secondary" disabled={!newSection[c._id]} onClick={() => run(() => post('/api/academic/sections', { classId: c._id, name: newSection[c._id] }), () => setNewSection({ ...newSection, [c._id]: '' }))}>{t('addSection')}</Button></div>}
              </li>
            ))}</ul>
          )}
        </Card>
      )}

      <Modal open={Boolean(newRoom)} onClose={() => setNewRoom(null)} title={t('addClassroom')} footer={<><Button variant="secondary" onClick={() => setNewRoom(null)}>{t('cancel')}</Button><Button loading={mut.isPending} disabled={!newRoom?.classId || !newRoom.sectionId || !newRoom.sessionId || !newRoom.name} onClick={() => run(() => post('/api/academic/classrooms', { ...newRoom, room: newRoom!.room || null }), () => setNewRoom(null))}>{t('create')}</Button></>}>
        {newRoom && <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('academicSession')} value={newRoom.sessionId} onChange={(e) => setNewRoom({ ...newRoom, sessionId: e.target.value })} placeholder="—" options={(sessions.data?.data ?? []).map((s) => ({ value: s._id, label: s.name }))} />
          <Select label={t('class')} value={newRoom.classId} onChange={(e) => { const c = classes.data?.data.find((x) => x._id === e.target.value); setNewRoom({ ...newRoom, classId: e.target.value, sectionId: '', name: c?.name ?? '' }); }} placeholder="—" options={(classes.data?.data ?? []).filter((c) => !c.archived).map((c) => ({ value: c._id, label: c.name }))} />
          <Select label={t('section')} value={newRoom.sectionId} onChange={(e) => { const s = sectionsFor(newRoom.classId).find((x) => x._id === e.target.value); const c = classes.data?.data.find((x) => x._id === newRoom.classId); setNewRoom({ ...newRoom, sectionId: e.target.value, name: `${c?.name ?? ''}-${s?.name ?? ''}` }); }} placeholder="—" options={sectionsFor(newRoom.classId).filter((s) => !s.archived).map((s) => ({ value: s._id, label: s.name }))} />
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

      <ConfirmDialog open={Boolean(archiving)} title={`${t('archive')} — ${archiving?.name ?? ''}`} message={t('confirmArchiveClassroom')} loading={mut.isPending}
        onCancel={() => setArchiving(null)} onConfirm={() => run(() => patch(`/api/academic/classrooms/${archiving!._id}`, { archived: true }), () => setArchiving(null), t('saved'))} />

      {editClass && <EditClassDialog initial={editClass} onClose={() => setEditClass(null)} onSaved={(text) => { setErr(null); setNotice(text); }} />}
      {promote && <PromoteDialog state={promote} rooms={roomList} onClose={() => setPromote(null)} onDone={(text) => { setPromote(null); setErr(null); setNotice(text); }} />}
    </div>
  );
}
