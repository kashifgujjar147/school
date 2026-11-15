import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Download, RotateCcw, Search, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  introducedConflicts, periodsForDay, teachingPeriodsForDay, validateTimetable, type Conflict, type Namer, type TEntry
} from '@sms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useGet } from '../../hooks/useApi';
import { del, downloadFile, patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Input, Modal, Select, Spinner, Textarea, errorMessage } from '../../components/ui';
import { PrintButton, ViewToggle, WeekGrid, subjectColor, useDayName, useL, type GridLesson } from '../../timetable/common';
import { ConflictList, useGuardedAction, type Board, type Entry, type Generation } from './api';

type View = 'section' | 'class' | 'teacher' | 'room';

/** The timetable board: view, generate, edit (draft) and publish. */
export default function BoardTab({ sessionId, readOnly, canPublish }: { sessionId: string; readOnly: boolean; canPublish: boolean }) {
  const L = useL(); const dayName = useDayName();
  const qc = useQueryClient();
  const [state, setState] = useState<'draft' | 'published'>(readOnly ? 'published' : 'draft');
  const [view, setView] = useState<View>('section');
  const [entityId, setEntityId] = useState('');
  const [mode, setMode] = useState<'week' | 'day'>('week');
  const [day, setDay] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showConflicts, setShowConflicts] = useState(false);
  const [lesson, setLesson] = useState<LessonEdit | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const q = useGet<Board>(`/api/timetable/board?sessionId=${sessionId}&state=${state}`);
  const reload = () => void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable') });
  const g = useGuardedAction(reload);
  const b = q.data?.data;

  const classrooms = useMemo(() => (b?.classrooms ?? []).slice().sort((x, y) => x.classOrder - y.classOrder || x.name.localeCompare(y.name)), [b]);
  const classes = useMemo(() => [...new Map(classrooms.map((c) => [c.classId, { _id: c.classId, name: c.className }])).values()], [classrooms]);
  const options = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = view === 'section' ? classrooms.map((c) => ({ value: c._id, label: c.name }))
      : view === 'class' ? classes.map((c) => ({ value: c._id, label: c.name }))
        : view === 'teacher' ? (b?.teachers ?? []).map((t) => ({ value: t._id, label: t.fullName }))
          : (b?.rooms ?? []).filter((r) => !r.archived).map((r) => ({ value: r._id, label: r.name }));
    return s ? list.filter((o) => o.label.toLowerCase().includes(s)) : list;
  }, [view, classrooms, classes, b, search]);
  useEffect(() => { if (!options.some((o) => o.value === entityId)) setEntityId(options[0]?.value ?? ''); }, [options, entityId]);
  useEffect(() => { if (b?.config && (day === null || !b.config.workingDays.includes(day))) setDay(b.config.workingDays[0] ?? 1); }, [b?.config, day]);

  const names: Namer | null = useMemo(() => (!b ? null : {
    classroom: (id) => b.classrooms.find((c) => c._id === id)?.name ?? '?', teacher: (id) => b.teachers.find((t) => t._id === id)?.fullName ?? '?',
    room: (id) => b.rooms.find((r) => r._id === id)?.name ?? '?', subject: (id) => b.subjects.find((s) => s._id === id)?.name ?? '?',
    period: (d: number, k: string) => `${dayName(d)} ${b.config ? (periodsForDay(b.config, d).find((p) => p.key === k)?.label ?? k) : k}`
  }), [b, dayName]);

  if (q.isLoading) return <Spinner />;
  if (q.isError || !b) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!b.config) return <EmptyState title={L('School timings are not set', 'اسکول اوقات طے نہیں')}>{L('Open the "School timings" tab to set working days and periods for this session.', 'اس سیشن کے لیے "اسکول اوقات" میں دن اور پیریڈ طے کریں۔')}</EmptyState>;
  const cfg = b.config;
  const editable = state === 'draft' && !readOnly;
  const errors = b.conflicts.filter((c) => c.severity === 'error');
  const warnings = b.conflicts.filter((c) => c.severity === 'warning');
  const toneOf = new Map<string, { tone: 'error' | 'warning'; text: string }>();
  for (const c of b.conflicts) for (const id of c.entryIds) {
    const cur = toneOf.get(id);
    if (!cur || (cur.tone === 'warning' && c.severity === 'error')) toneOf.set(id, { tone: c.severity, text: c.message }); else toneOf.set(id, { ...cur, text: `${cur.text}\n${c.message}` });
  }
  const subj = (id: string) => b.subjects.find((s) => s._id === id);
  const toGrid = (e: Entry, perspective: View): GridLesson => {
    const s = subj(e.subjectId); const t = e.teacherId ? names!.teacher(e.teacherId) : L('No teacher', 'استاد نہیں');
    const room = e.roomId ? names!.room(e.roomId) : '';
    const tone = toneOf.get(e._id);
    const base = { id: e._id, day: e.day, periodKey: e.periodKey, color: subjectColor(s?.name ?? '', s?.color), locked: e.locked, tone: tone?.tone ?? null, toneText: tone?.text };
    if (perspective === 'teacher') return { ...base, title: names!.classroom(e.classroomId), lines: [s?.name ?? '', room] };
    if (perspective === 'room') return { ...base, title: names!.classroom(e.classroomId), lines: [s?.name ?? '', t] };
    return { ...base, title: s?.name ?? '?', lines: [t, room] };
  };
  const gridFor = (filter: (e: Entry) => boolean, perspective: View) => b.entries.filter(filter).map((e) => toGrid(e, perspective));
  const days = mode === 'day' && day !== null ? [day] : undefined;

  const onCell = editable ? (d: number, periodKey: string, l: GridLesson | null, classroomId?: string) => {
    if (l) { const e = b.entries.find((x) => x._id === l.id)!; setLesson({ mode: 'edit', entry: e, classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId ?? '', roomId: e.roomId ?? '', locked: e.locked, span: 1 }); return; }
    const cid = classroomId ?? (view === 'section' ? entityId : '');
    setLesson({ mode: 'add', entry: null, classroomId: cid, day: d, periodKey, subjectId: '', teacherId: view === 'teacher' ? entityId : '', roomId: view === 'room' ? entityId : '', locked: false, span: 1 });
  } : undefined;
  const onDrop = editable ? (id: string, d: number, periodKey: string, classroomScope?: string) => {
    const e = b.entries.find((x) => x._id === id); if (!e || (e.day === d && e.periodKey === periodKey)) return;
    const target = b.entries.find((x) => x.classroomId === (classroomScope ?? e.classroomId) && x.day === d && x.periodKey === periodKey);
    if (target && target.classroomId === e.classroomId) void g.exec((c) => post('/api/timetable/entries/swap', { sessionId, a: e._id, b: target._id, version: b.meta.version, confirmWarnings: c }), L('Lessons swapped.', 'پیریڈ تبدیل ہو گئے۔'));
    else void g.exec((c) => patch(`/api/timetable/entries/${e._id}`, { day: d, periodKey, version: b.meta.version, confirmWarnings: c }), L('Lesson moved.', 'پیریڈ منتقل ہو گیا۔'));
  } : undefined;

  const pdfUrl = view === 'class' || !entityId ? null : `/api/timetable/export.pdf?sessionId=${sessionId}&state=${state}&view=${view === 'section' ? 'classroom' : view}&id=${entityId}`;
  const pick = (c: Conflict) => {
    if (c.classroomId) { setView('section'); setEntityId(c.classroomId); } else if (c.teacherId) { setView('teacher'); setEntityId(c.teacherId); } else if (c.roomId) { setView('room'); setEntityId(c.roomId); }
    if (c.day !== undefined) { setDay(c.day); }
    setSearch('');
  };

  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      {/* Status & actions */}
      <Card className="no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-surface-line bg-white p-0.5 text-sm" role="group" aria-label={L('Version', 'ورژن')}>
              {(['draft', 'published'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)} className={clsx('rounded-md px-3 py-1.5 font-medium', state === s ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted')}>{s === 'draft' ? L('Draft', 'مسودہ') : L('Published', 'شائع شدہ')}</button>
              ))}
            </div>
            {b.meta.status === 'published' ? <Badge color="green">{L('Published', 'شائع شدہ')} {b.meta.publishedAt ? new Date(b.meta.publishedAt).toLocaleString() : ''}</Badge> : <Badge>{L('Not published yet', 'ابھی شائع نہیں ہوا')}</Badge>}
            {b.meta.draftDirty && <Badge color="amber">{L('Draft has unpublished changes', 'مسودے میں غیر شائع شدہ تبدیلیاں')}</Badge>}
            <button type="button" onClick={() => setShowConflicts(!showConflicts)} className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', errors.length ? 'bg-red-50 text-red-700' : warnings.length ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')} aria-expanded={showConflicts}>
              {errors.length || warnings.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {errors.length} {L('conflicts', 'تنازعات')} · {warnings.length} {L('warnings', 'انتباہات')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && <Button variant="secondary" onClick={() => setGenOpen(true)}><Sparkles className="h-4 w-4" />{L('Generate', 'خودکار بنائیں')}</Button>}
            {editable && b.meta.publishCount > 0 && b.meta.draftDirty && <Button variant="ghost" onClick={() => setResetOpen(true)}><RotateCcw className="h-4 w-4" />{L('Discard draft changes', 'مسودہ تبدیلیاں ختم کریں')}</Button>}
            {state === 'draft' && canPublish && <Button onClick={() => setPubOpen(true)} disabled={!b.entries.length}><Send className="h-4 w-4" />{L('Publish', 'شائع کریں')}</Button>}
          </div>
        </div>
        {showConflicts && <div className="mt-3 max-h-72 overflow-y-auto">{b.conflicts.length ? <ConflictList conflicts={b.conflicts} onPick={pick} /> : <p className="text-sm text-emerald-700">{L('No conflicts.', 'کوئی تنازع نہیں۔')}</p>}</div>}
        {b.meta.lastGeneration && state === 'draft' && <GenerationSummary gen={b.meta.lastGeneration} names={names!} compact />}
      </Card>

      {/* View selectors */}
      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="w-40"><Select label={L('Show by', 'دکھائیں')} value={view} onChange={(e) => { setView(e.target.value as View); setEntityId(''); }} options={[
          { value: 'section', label: L('Section', 'سیکشن') }, { value: 'class', label: L('Class (all sections)', 'کلاس (تمام سیکشن)') },
          { value: 'teacher', label: L('Teacher', 'استاد') }, { value: 'room', label: L('Room', 'کمرہ') }]} /></div>
        <div className="w-56"><Select label={view === 'teacher' ? L('Teacher', 'استاد') : view === 'room' ? L('Room', 'کمرہ') : L('Class', 'کلاس')} value={entityId} onChange={(e) => setEntityId(e.target.value)} options={options} placeholder={options.length ? undefined : L('Nothing found', 'کچھ نہیں ملا')} /></div>
        <label className="relative w-56"><span className="label">{L('Search', 'تلاش')}</span><Search className="pointer-events-none absolute bottom-3 start-3 h-4 w-4 text-ink-faint" /><input className="input ps-9" value={search} placeholder={L('Name, subject, teacher…', 'نام، مضمون، استاد…')} onChange={(e) => setSearch(e.target.value)} /></label>
        <ViewToggle mode={mode} onChange={setMode} week={L('Week', 'ہفتہ')} day={L('Day', 'دن')} />
        {mode === 'day' && <div className="w-36"><Select label={L('Day', 'دن')} value={String(day ?? '')} onChange={(e) => setDay(Number(e.target.value))} options={cfg.workingDays.map((d) => ({ value: String(d), label: dayName(d) }))} /></div>}
        <div className="ms-auto flex gap-2">
          <PrintButton label={L('Print', 'پرنٹ')} />
          <Button variant="secondary" disabled={!pdfUrl} title={pdfUrl ? undefined : L('Choose a section, teacher or room', 'سیکشن، استاد یا کمرہ منتخب کریں')} onClick={() => pdfUrl && downloadFile(pdfUrl, 'timetable.pdf').catch((e) => g.setToast({ kind: 'error', text: errorMessage(e, 'PDF') }))}><Download className="h-4 w-4" />PDF</Button>
        </div>
      </div>
      {editable && <p className="no-print text-xs text-ink-faint">{L('Click an empty period to add a lesson, click a lesson to edit it, or drag a lesson to another period (dropping onto a lesson of the same class swaps them).', 'خالی پیریڈ پر کلک کر کے پیریڈ شامل کریں، پیریڈ پر کلک کر کے ترمیم کریں، یا گھسیٹ کر منتقل کریں۔')}</p>}

      {/* Grid(s) */}
      {!entityId ? <EmptyState>{L('Nothing to show yet.', 'ابھی دکھانے کو کچھ نہیں۔')}</EmptyState> : view === 'class' ? (
        <div className="space-y-6">
          {classrooms.filter((c) => c.classId === entityId).map((c) => (
            <section key={c._id}>
              <h3 className="mb-2 text-sm font-semibold">{c.name}</h3>
              <WeekGrid config={cfg} days={days} highlight={search} lessons={gridFor((e) => e.classroomId === c._id, 'section')} emptyLabel={L('add lesson', 'پیریڈ شامل کریں')}
                onCell={onCell ? (d, k, l) => onCell(d, k, l, c._id) : undefined} onDrop={onDrop ? (id, d, k) => onDrop(id, d, k, c._id) : undefined} />
            </section>
          ))}
        </div>
      ) : (
        <>
          <h3 className="hidden text-base font-semibold print:block">{options.find((o) => o.value === entityId)?.label} — {state === 'draft' ? L('Draft', 'مسودہ') : L('Published', 'شائع شدہ')}</h3>
          <WeekGrid config={cfg} days={days} highlight={search} emptyLabel={L('add lesson', 'پیریڈ شامل کریں')} freeLabel={view !== 'section' ? L('Free', 'خالی') : undefined}
            lessons={gridFor((e) => (view === 'section' ? e.classroomId === entityId : view === 'teacher' ? e.teacherId === entityId : e.roomId === entityId), view)}
            onCell={onCell} onDrop={onDrop} />
        </>
      )}

      {lesson && <LessonDialog key={lesson.entry?._id ?? 'new'} board={b} names={names!} value={lesson} sessionId={sessionId} onClose={() => setLesson(null)} exec={g.exec} />}
      <GenerateDialog open={genOpen} onClose={() => setGenOpen(false)} board={b} names={names!} sessionId={sessionId} onDone={reload} />
      {/* Switch to the published view only after the dialog closes: switching while it is open would reload the board and lose the result report. */}
      <PublishDialog open={pubOpen} onClose={(published) => { setPubOpen(false); if (published) setState('published'); }} board={b} sessionId={sessionId} onDone={reload} />
      <ConfirmDialog open={resetOpen} danger title={L('Discard draft changes?', 'مسودہ تبدیلیاں ختم کریں؟')} message={L('The draft becomes a copy of the published timetable again. Changes made since publishing are lost.', 'مسودہ دوبارہ شائع شدہ ٹائم ٹیبل جیسا ہو جائے گا۔')}
        loading={g.busy} onCancel={() => setResetOpen(false)} onConfirm={async () => { setResetOpen(false); await g.exec(() => post('/api/timetable/draft/reset', { sessionId, version: b.meta.version }), L('Draft reset to the published timetable.', 'مسودہ بحال ہو گیا۔')); }} />
    </div>
  );
}

// ------------------------------------------------------------------ Lesson add / edit
interface LessonEdit { mode: 'add' | 'edit'; entry: Entry | null; classroomId: string; day: number; periodKey: string; subjectId: string; teacherId: string; roomId: string; locked: boolean; span: number }

function LessonDialog({ board: b, names, value, sessionId, onClose, exec }: { board: Board; names: Namer; value: LessonEdit; sessionId: string; onClose: () => void; exec: (fn: (confirm: boolean) => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const L = useL(); const dayName = useDayName();
  const [v, setV] = useState(value);
  const [swapWith, setSwapWith] = useState('');
  const cfg = b.config!;
  const teaching = teachingPeriodsForDay(cfg, v.day);
  const qualified = new Set(b.profiles.filter((p) => p.subjectIds.includes(v.subjectId)).map((p) => p.teacherId));
  // Live preview of what this change would cause (the server checks again before saving).
  const preview = useMemo(() => {
    if (!v.classroomId || !v.subjectId) return [];
    const toT = (e: Entry): TEntry => ({ id: e._id, classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId, locked: e.locked });
    const current = b.entries.map(toT);
    const mine: TEntry = { id: v.entry?._id ?? 'new', classroomId: v.classroomId, day: v.day, periodKey: v.periodKey, subjectId: v.subjectId, teacherId: v.teacherId || null, roomId: v.roomId || null, locked: v.locked };
    const after = v.entry ? current.map((e) => (e.id === v.entry!._id ? mine : e)) : [...current, mine];
    const input = { config: cfg, teachers: b.teachers.map((t) => { const p = b.profiles.find((x) => x.teacherId === t._id); return { id: t._id, subjectIds: p?.subjectIds ?? [], maxPerDay: p?.maxPerDay ?? null, maxPerWeek: p?.maxPerWeek ?? null, unavailable: p?.unavailable ?? [] }; }), rooms: b.rooms.map((r) => ({ id: r._id, unavailable: r.unavailable })), requirements: b.requirements, names };
    return introducedConflicts(validateTimetable({ ...input, entries: current }), validateTimetable({ ...input, entries: after }));
  }, [v, b, cfg, names]);
  const hard = preview.filter((c) => c.severity === 'error');
  const save = async () => {
    const ok = v.mode === 'add'
      ? await exec((c) => post('/api/timetable/entries', { sessionId, classroomId: v.classroomId, day: v.day, periodKey: v.periodKey, subjectId: v.subjectId, teacherId: v.teacherId || null, roomId: v.roomId || null, locked: v.locked, span: v.span, version: b.meta.version, confirmWarnings: c || preview.length > 0 }), L('Lesson added.', 'پیریڈ شامل ہو گیا۔'))
      : await exec((c) => patch(`/api/timetable/entries/${v.entry!._id}`, { day: v.day, periodKey: v.periodKey, subjectId: v.subjectId, teacherId: v.teacherId || null, roomId: v.roomId || null, locked: v.locked, version: b.meta.version, confirmWarnings: c || preview.length > 0 }), L('Lesson saved.', 'پیریڈ محفوظ ہو گیا۔'));
    if (ok) onClose();
  };
  const remove = async () => { if (await exec((c) => del(`/api/timetable/entries/${v.entry!._id}?version=${b.meta.version}${c ? '&confirmWarnings=true' : ''}`), L('Lesson removed.', 'پیریڈ ہٹا دیا گیا۔'))) onClose(); };
  const swap = async () => { if (await exec((c) => post('/api/timetable/entries/swap', { sessionId, a: v.entry!._id, b: swapWith, version: b.meta.version, confirmWarnings: c }), L('Lessons swapped.', 'پیریڈ تبدیل ہو گئے۔'))) onClose(); };
  const sameClass = v.entry ? b.entries.filter((e) => e.classroomId === v.entry!.classroomId && e._id !== v.entry!._id && e.subjectId !== v.entry!.subjectId) : [];
  return (
    <Modal open onClose={onClose} wide title={v.mode === 'add' ? L('Add lesson', 'پیریڈ شامل کریں') : `${names.classroom(v.classroomId)} · ${names.period(value.day, value.periodKey)}`}
      footer={<>
        {v.mode === 'edit' && <Button variant="danger" className="me-auto" onClick={() => void remove()}><Trash2 className="h-4 w-4" />{L('Remove', 'ہٹائیں')}</Button>}
        <Button variant="secondary" onClick={onClose}>{L('Cancel', 'منسوخ')}</Button>
        <Button disabled={!v.classroomId || !v.subjectId || hard.length > 0} onClick={() => void save()}>{preview.length ? L('Save anyway', 'پھر بھی محفوظ کریں') : L('Save', 'محفوظ کریں')}</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {v.mode === 'add' && <Select label={L('Class / section', 'کلاس / سیکشن')} value={v.classroomId} placeholder={L('Choose', 'منتخب کریں')} onChange={(e) => setV({ ...v, classroomId: e.target.value })} options={b.classrooms.map((c) => ({ value: c._id, label: c.name }))} />}
          <Select label={L('Subject', 'مضمون')} value={v.subjectId} placeholder={L('Choose', 'منتخب کریں')} onChange={(e) => setV({ ...v, subjectId: e.target.value })} options={b.subjects.filter((s) => !s.archived || s._id === v.subjectId).map((s) => ({ value: s._id, label: s.name }))} />
          <Select label={L('Teacher', 'استاد')} value={v.teacherId} onChange={(e) => setV({ ...v, teacherId: e.target.value })}
            options={[{ value: '', label: L('— No teacher —', '— کوئی استاد نہیں —') }, ...b.teachers.slice().sort((x, y) => Number(qualified.has(y._id)) - Number(qualified.has(x._id)) || x.fullName.localeCompare(y.fullName)).map((t) => ({ value: t._id, label: `${qualified.has(t._id) ? '✓ ' : ''}${t.fullName}` }))]} />
          <Select label={L('Room', 'کمرہ')} value={v.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })} options={[{ value: '', label: L("Class's own room", 'کلاس کا اپنا کمرہ') }, ...b.rooms.filter((r) => !r.archived || r._id === v.roomId).map((r) => ({ value: r._id, label: r.name }))]} />
          <Select label={L('Day', 'دن')} value={String(v.day)} onChange={(e) => { const d = Number(e.target.value); const ps = teachingPeriodsForDay(cfg, d); setV({ ...v, day: d, periodKey: ps.some((p) => p.key === v.periodKey) ? v.periodKey : ps[0]?.key ?? v.periodKey }); }} options={cfg.workingDays.map((d) => ({ value: String(d), label: dayName(d) }))} />
          <Select label={L('Period', 'پیریڈ')} value={v.periodKey} onChange={(e) => setV({ ...v, periodKey: e.target.value })} options={teaching.map((p) => ({ value: p.key, label: `${p.label} (${p.start}–${p.end})` }))} />
          {v.mode === 'add' && <Input type="number" min={1} max={4} label={L('Length (periods in a row)', 'دورانیہ (مسلسل پیریڈ)')} value={v.span} onChange={(e) => setV({ ...v, span: Math.max(1, Math.min(4, Number(e.target.value) || 1)) })} />}
        </div>
        <Checkbox label={L('Lock this lesson (automatic generation keeps it in place)', 'یہ پیریڈ مقفل کریں (خودکار تیاری اسے نہیں بدلے گی)')} checked={v.locked} onChange={(c) => setV({ ...v, locked: c })} />
        {preview.length > 0 && <div><p className="mb-1 text-sm font-medium">{hard.length ? L('This change is not allowed:', 'یہ تبدیلی ممکن نہیں:') : L('Saving will cause:', 'محفوظ کرنے سے یہ ہو گا:')}</p><ConflictList conflicts={preview} /></div>}
        {v.mode === 'edit' && sameClass.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-surface-line pt-4">
            <div className="min-w-[16rem] flex-1"><Select label={L('Swap with another lesson of this class', 'اسی کلاس کے دوسرے پیریڈ سے تبدیل کریں')} value={swapWith} placeholder={L('Choose a lesson', 'پیریڈ منتخب کریں')} onChange={(e) => setSwapWith(e.target.value)}
              options={sameClass.sort((x, y) => x.day - y.day || x.periodKey.localeCompare(y.periodKey)).map((e) => ({ value: e._id, label: `${names.period(e.day, e.periodKey)} · ${names.subject(e.subjectId)}` }))} /></div>
            <Button variant="secondary" disabled={!swapWith} onClick={() => void swap()}>{L('Swap', 'تبدیل کریں')}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Generation
function GenerateDialog({ open, onClose, board: b, names, sessionId, onDone }: { open: boolean; onClose: () => void; board: Board; names: Namer; sessionId: string; onDone: () => void }) {
  const L = useL(); const dayName = useDayName();
  const [classroomIds, setClassroomIds] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [keepLocked, setKeepLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<(Generation & { written: boolean }) | null>(null);
  const withReqs = new Set(b.requirements.filter((r) => r.periodsPerWeek > 0).map((r) => r.classroomId));
  useEffect(() => { if (open) { setClassroomIds(b.classrooms.filter((c) => withReqs.has(c._id)).map((c) => c._id)); setDays(b.config!.workingDays); setTeacherIds(b.teachers.map((t) => t._id)); setResult(null); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (acceptPartial: boolean, seed?: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await post<Generation & { written: boolean }>('/api/timetable/generate', { sessionId, classroomIds, days, teacherIds: teacherIds.length === b.teachers.length ? undefined : teacherIds, keepLocked, acceptPartial, seed, version: b.meta.version });
      setResult(r);
      if (r.written) onDone();
    } catch (e) { setErr(errorMessage(e, L('Generation failed', 'تیاری ناکام'))); } finally { setBusy(false); }
  };
  const toggle = (list: string[], id: string, set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const byClass = [...new Map(b.classrooms.map((c) => [c.classId, c.className])).entries()];
  return (
    <Modal open={open} onClose={onClose} wide title={L('Generate timetable automatically', 'خودکار ٹائم ٹیبل تیار کریں')}
      footer={result ? <Button onClick={onClose}>{L('Close', 'بند کریں')}</Button> : <><Button variant="secondary" onClick={onClose}>{L('Cancel', 'منسوخ')}</Button><Button loading={busy} disabled={!classroomIds.length || !days.length} onClick={() => void run(false)}><Sparkles className="h-4 w-4" />{L('Generate', 'تیار کریں')}</Button></>}>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {result ? (
        <div className="space-y-3">
          <GenerationSummary gen={result} names={names} />
          {result.written ? <Alert kind={result.status === 'complete' ? 'success' : 'warning'}>{result.status === 'complete' ? L('The draft was updated. Review it, then publish.', 'مسودہ اپ ڈیٹ ہو گیا۔ جائزہ لے کر شائع کریں۔') : L('The incomplete result was saved to the draft as you asked. Missing lessons are listed above.', 'نامکمل نتیجہ مسودے میں محفوظ کر دیا گیا۔')}</Alert>
            : <div className="flex flex-wrap items-center gap-3"><Alert kind="warning">{L('Nothing was saved: not every requirement could be met.', 'کچھ محفوظ نہیں ہوا: تمام ضروریات پوری نہیں ہو سکیں۔')}</Alert>
              <Button variant="secondary" loading={busy} onClick={() => void run(true, result.seed)}>{L('Save the partial result to the draft', 'نامکمل نتیجہ مسودے میں محفوظ کریں')}</Button>
              <Button variant="ghost" onClick={() => setResult(null)}>{L('Change settings', 'ترتیبات بدلیں')}</Button></div>}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-ink-soft">{L('Lessons of the chosen classes in the draft are replaced (locked lessons are kept). Other classes stay as they are and their teachers and rooms are respected. The published timetable does not change until you publish.', 'منتخب کلاسوں کے مسودہ پیریڈ بدل دیے جائیں گے (مقفل پیریڈ برقرار)۔ شائع شدہ ٹائم ٹیبل اشاعت تک نہیں بدلے گا۔')}</p>
          <fieldset>
            <legend className="label">{L('Classes and sections', 'کلاسیں اور سیکشن')} <button type="button" className="ms-2 text-xs text-brand" onClick={() => setClassroomIds(classroomIds.length ? [] : b.classrooms.filter((c) => withReqs.has(c._id)).map((c) => c._id))}>{classroomIds.length ? L('None', 'کوئی نہیں') : L('All', 'سب')}</button></legend>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-surface-line p-3">
              {byClass.map(([cid, cname]) => (
                <div key={cid}><p className="text-xs font-semibold text-ink-soft">{cname}</p>
                  <div className="flex flex-wrap gap-2">{b.classrooms.filter((c) => c.classId === cid).map((c) => (
                    <label key={c._id} className={clsx('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm', withReqs.has(c._id) ? 'border-surface-line' : 'border-dashed border-surface-line text-ink-faint')}>
                      <input type="checkbox" checked={classroomIds.includes(c._id)} onChange={() => toggle(classroomIds, c._id, setClassroomIds)} />{c.name}{!withReqs.has(c._id) && <span className="text-[10px]">({L('no requirements', 'ضروریات نہیں')})</span>}
                    </label>
                  ))}</div>
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">{L('Working days to use', 'استعمال ہونے والے دن')}</legend>
            <div className="flex flex-wrap gap-2">{b.config!.workingDays.map((d) => <label key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line px-2 py-1 text-sm"><input type="checkbox" checked={days.includes(d)} onChange={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())} />{dayName(d, true)}</label>)}</div>
          </fieldset>
          <details>
            <summary className="cursor-pointer text-sm font-medium">{L('Teachers available for this generation', 'اس تیاری کے لیے دستیاب اساتذہ')} ({teacherIds.length}/{b.teachers.length})</summary>
            <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{b.teachers.map((t) => <label key={t._id} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line px-2 py-1 text-sm"><input type="checkbox" checked={teacherIds.includes(t._id)} onChange={() => toggle(teacherIds, t._id, setTeacherIds)} />{t.fullName}</label>)}</div>
          </details>
          <Checkbox label={L('Keep locked lessons', 'مقفل پیریڈ برقرار رکھیں')} checked={keepLocked} onChange={setKeepLocked} />
          {busy && <Spinner label={L('Building the timetable… this can take a few seconds.', 'ٹائم ٹیبل تیار ہو رہا ہے…')} />}
        </div>
      )}
    </Modal>
  );
}

function GenerationSummary({ gen, names, compact }: { gen: Generation; names: Namer; compact?: boolean }) {
  const L = useL();
  const ok = gen.status === 'complete';
  if (compact) return <p className={clsx('mt-3 text-xs', ok ? 'text-ink-faint' : 'text-amber-800')}>{L('Last generation', 'آخری تیاری')}: {new Date(gen.at).toLocaleString()} · {gen.by} · {gen.stats.placed}/{gen.stats.required} {L('lessons placed', 'پیریڈ رکھے گئے')}{ok ? '' : ` · ${L('incomplete', 'نامکمل')}`}</p>;
  return (
    <div className="space-y-3">
      <Alert kind={ok ? 'success' : 'warning'} title={ok ? L('Complete timetable found', 'مکمل ٹائم ٹیبل تیار') : L('Not every requirement can be met', 'تمام ضروریات پوری نہیں ہو سکیں')}>
        {gen.stats.placed} / {gen.stats.required} {L('lessons placed', 'پیریڈ رکھے گئے')} · {(gen.stats.ms / 1000).toFixed(1)}s
      </Alert>
      {gen.diagnostics.length > 0 && <div><p className="mb-1 text-sm font-medium">{L('Problems found in the set-up', 'ترتیب میں مسائل')}</p>
        <ul className="space-y-1.5">{gen.diagnostics.map((d, i) => <li key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{d.message}<span className="block text-xs text-amber-800">→ {d.suggestion}</span></li>)}</ul></div>}
      {gen.unplaced.length > 0 && <div><p className="mb-1 text-sm font-medium">{L('Lessons that could not be placed', 'جو پیریڈ نہیں رکھے جا سکے')}</p>
        <ul className="space-y-1.5">{gen.unplaced.map((u) => <li key={u.requirementId} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"><span className="font-medium">{names.classroom(u.classroomId)} · {names.subject(u.subjectId)}</span>: {u.missing} {L('missing', 'باقی')}{u.reasons.map((r, i) => <span key={i} className="block text-xs">{r}</span>)}<span className="block text-xs font-medium">→ {u.suggestion}</span></li>)}</ul></div>}
    </div>
  );
}

// ------------------------------------------------------------------ Publishing
function PublishDialog({ open, onClose, board: b, sessionId, onDone }: { open: boolean; onClose: (published: boolean) => void; board: Board; sessionId: string; onDone: () => void }) {
  const L = useL();
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ changedPeriods: number; lessons: number; cancelledSubstitutions: number; notification: { guardianMessages: { queued: number; reason: string | null } } | null } | null>(null);
  useEffect(() => { if (open) { setAck(false); setErr(null); setDone(null); } }, [open]);
  const errors = b.conflicts.filter((c) => c.severity === 'error'); const warnings = b.conflicts.filter((c) => c.severity === 'warning');
  const publish = async () => {
    setBusy(true); setErr(null);
    try { setDone(await post('/api/timetable/publish', { sessionId, version: b.meta.version, confirmWarnings: ack, note: note.trim() || undefined })); onDone(); }
    catch (e) { setErr(errorMessage(e, L('Publishing failed', 'اشاعت ناکام'))); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => onClose(Boolean(done))} title={L('Publish timetable', 'ٹائم ٹیبل شائع کریں')}
      footer={done ? <Button onClick={() => onClose(true)}>{L('Close', 'بند کریں')}</Button> : <><Button variant="secondary" onClick={() => onClose(false)}>{L('Cancel', 'منسوخ')}</Button><Button loading={busy} disabled={errors.length > 0 || (warnings.length > 0 && !ack)} onClick={() => void publish()}><Send className="h-4 w-4" />{L('Publish now', 'ابھی شائع کریں')}</Button></>}>
      {done ? (
        <div className="space-y-3">
          <Alert kind="success">{L(`Published ${done.lessons} lessons (${done.changedPeriods} period(s) changed). Teachers, students and parents now see this timetable and were notified in their portals.`, `${done.lessons} پیریڈ شائع ہو گئے۔ پورٹل میں اطلاع دے دی گئی۔`)}</Alert>
          {done.cancelledSubstitutions > 0 && <Alert kind="warning">{L(`${done.cancelledSubstitutions} upcoming substitution(s) were cancelled because their lesson changed.`, `${done.cancelledSubstitutions} متبادل منسوخ ہو گئے کیونکہ پیریڈ بدل گیا۔`)}</Alert>}
          {done.notification && <p className="text-sm text-ink-soft">{done.notification.guardianMessages.queued > 0
            ? L(`${done.notification.guardianMessages.queued} guardian SMS/WhatsApp message(s) were queued. They count as sent only when the provider accepts them (see Notifications).`, `${done.notification.guardianMessages.queued} سرپرست پیغامات قطار میں ہیں۔`)
            : L('No guardian SMS/WhatsApp messages were queued (timetable alerts are switched off in Notification settings, or no provider/guardians).', 'کوئی سرپرست پیغام قطار میں نہیں ڈالا گیا۔')}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">{L('The draft replaces the published timetable for teachers, students and parents. Only the periods that differ are changed.', 'مسودہ شائع شدہ ٹائم ٹیبل کی جگہ لے لے گا۔')}</p>
          {err && <Alert kind="error">{err}</Alert>}
          {errors.length > 0 && <div><Alert kind="error">{L(`${errors.length} conflict(s) must be fixed first.`, `${errors.length} تنازعات پہلے درست کریں۔`)}</Alert><div className="mt-2 max-h-48 overflow-y-auto"><ConflictList conflicts={errors} /></div></div>}
          {errors.length === 0 && warnings.length > 0 && <div className="space-y-2"><Alert kind="warning">{L(`${warnings.length} warning(s):`, `${warnings.length} انتباہات:`)}</Alert><div className="max-h-48 overflow-y-auto"><ConflictList conflicts={warnings} /></div><Checkbox label={L('I have reviewed the warnings; publish anyway', 'میں نے انتباہات دیکھ لیے؛ پھر بھی شائع کریں')} checked={ack} onChange={setAck} /></div>}
          <Textarea label={L('Note for teachers, students and parents (optional)', 'نوٹ (اختیاری)')} value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}
