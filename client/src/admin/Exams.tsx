import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Send } from 'lucide-react';
import { gradeFor, percentOf } from '@sms/shared';
import { useAction, useGet } from '../hooks/useApi';
import { useFormat, useT } from '../i18n';
import { useAuth } from '../store/auth';
import { del, downloadFile, post, put, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Tabs, errorMessage } from '../components/ui';
import { useClassrooms } from './shared';

interface Exam { _id: string; name: string; term?: string; startDate: string; endDate?: string; published: boolean; publishedAt?: string }
interface Sheet { exam: Exam; students: { _id: string; fullName: string; admissionNumber: string }[]; results: { studentId: string; subject: string; maxMarks: number; marksObtained: number | null; absent: boolean; remarks?: string }[]; subjects: string[] }
interface Summary { perStudent: { student: { _id: string; fullName: string; admissionNumber: string }; obtained: number; max: number; percent: number | null; grade: string; passed: boolean }[]; subjects: { subject: string; entries: number; average: number | null; passRate: number | null }[] }

/** Classrooms the user may work with: teachers get only their assigned ones (server enforces it too). */
function useMyRooms() {
  const can = useAuth((s) => s.can);
  const all = useClassrooms();
  const mine = useGet<{ _id: string; name: string }[]>(can('attendance.view_all') ? null : '/api/academic/classrooms?mine=true');
  return can('attendance.view_all') ? (all.data?.data ?? []) : (mine.data?.data ?? []);
}

function MarksEntry({ exam }: { exam: Exam }) {
  const t = useT();
  const can = useAuth((s) => s.can);
  const rooms = useMyRooms();
  const [classroomId, setClassroomId] = useState('');
  const [subject, setSubject] = useState('');
  const [maxMarks, setMaxMarks] = useState('100');
  const sheet = useGet<Sheet>(classroomId ? `/api/exams/${exam._id}/results${qs({ classroomId })}` : null);
  const [rows, setRows] = useState<Record<string, { marks: string; absent: boolean; remarks: string }>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const locked = exam.published && !can('exams.manage');
  // Load existing marks for the chosen subject.
  useEffect(() => {
    if (!sheet.data) return;
    const key = subject.trim().toLowerCase();
    const next: typeof rows = {};
    for (const s of sheet.data.data.students) {
      const r = sheet.data.data.results.find((x) => x.studentId === s._id && x.subject.toLowerCase() === key);
      next[s._id] = { marks: r?.marksObtained === null || r?.marksObtained === undefined ? '' : String(r.marksObtained), absent: Boolean(r?.absent), remarks: r?.remarks ?? '' };
      if (r) setMaxMarks(String(r.maxMarks));
    }
    setRows(next);
  }, [sheet.data, subject]);
  const save = useAction(() => put(`/api/exams/${exam._id}/results`, {
    classroomId, subject: subject.trim(), maxMarks: Number(maxMarks),
    entries: Object.entries(rows).filter(([, r]) => r.absent || r.marks !== '').map(([studentId, r]) => ({ studentId, absent: r.absent, marksObtained: r.absent ? null : Number(r.marks), remarks: r.remarks || null }))
  }), ['/api/exams']);
  const max = Number(maxMarks);
  const invalid = Object.values(rows).some((r) => !r.absent && r.marks !== '' && (Number(r.marks) < 0 || Number(r.marks) > max));
  return (
    <Card title={t('enterMarks')}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label={t('classroom')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)} placeholder={t('selectClassroom')} options={rooms.map((r) => ({ value: r._id, label: r.name }))} />
        <div>
          <Input label={t('subject')} list="exam-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={80} />
          <datalist id="exam-subjects">{sheet.data?.data.subjects.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        <Input label={t('maxMarks')} type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
      </div>
      {msg && <div className="mt-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {locked && <div className="mt-4"><Alert kind="info">{t('publishedLabel')}</Alert></div>}
      {!classroomId ? null : sheet.isLoading ? <Spinner /> : !sheet.data?.data.students.length ? <EmptyState /> : !subject.trim() ? <p className="mt-4 text-sm text-ink-soft">{t('subject')}…</p> : (
        <>
          <div className="mt-4"><Table>
            <thead><tr><th>{t('name')}</th><th className="w-28">{t('marks')}</th><th>{t('absentShort')}</th><th>%</th><th>{t('remarks')}</th></tr></thead>
            <tbody>{sheet.data.data.students.map((s) => {
              const r = rows[s._id] ?? { marks: '', absent: false, remarks: '' };
              const pct = r.absent ? 0 : r.marks === '' ? null : percentOf(Number(r.marks), max);
              const bad = !r.absent && r.marks !== '' && (Number(r.marks) < 0 || Number(r.marks) > max);
              return (
                <tr key={s._id}>
                  <td><span className="font-medium">{s.fullName}</span> <span className="num text-xs text-ink-faint">{s.admissionNumber}</span></td>
                  <td><Input aria-label={`${t('marks')} ${s.fullName}`} type="number" min={0} max={max} step="0.5" disabled={r.absent || locked} value={r.marks} error={bad ? '!' : undefined} onChange={(e) => setRows({ ...rows, [s._id]: { ...r, marks: e.target.value } })} /></td>
                  <td><Checkbox label="" checked={r.absent} disabled={locked} onChange={(x) => setRows({ ...rows, [s._id]: { ...r, absent: x } })} /></td>
                  <td className="num text-sm">{pct === null ? '—' : `${pct}% · ${gradeFor(pct)}`}</td>
                  <td><Input aria-label={`${t('remarks')} ${s.fullName}`} disabled={locked} value={r.remarks} maxLength={200} onChange={(e) => setRows({ ...rows, [s._id]: { ...r, remarks: e.target.value } })} /></td>
                </tr>
              );
            })}</tbody>
          </Table></div>
          {!locked && <Button className="mt-4" loading={save.isPending} disabled={invalid || !(max > 0)} onClick={() => save.mutate(undefined, { onSuccess: () => { setMsg({ kind: 'success', text: t('marksSaved') }); void sheet.refetch(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('save')}</Button>}
        </>
      )}
    </Card>
  );
}

function ClassSummary({ exam }: { exam: Exam }) {
  const t = useT(); const f = useFormat();
  const rooms = useMyRooms();
  const [classroomId, setClassroomId] = useState('');
  const q = useGet<Summary>(classroomId ? `/api/exams/${exam._id}/summary${qs({ classroomId })}` : null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title={t('classResults')} actions={<Select aria-label={t('classroom')} value={classroomId} onChange={(e) => setClassroomId(e.target.value)} placeholder={t('selectClassroom')} options={rooms.map((r) => ({ value: r._id, label: r.name }))} />}>
      {err && <Alert kind="error">{err}</Alert>}
      {!classroomId ? <p className="text-sm text-ink-soft">{t('selectClassroom')}</p> : q.isLoading ? <Spinner /> : !q.data?.data.perStudent.length ? <EmptyState /> : (
        <div className="space-y-5">
          <Table>
            <thead><tr><th>#</th><th>{t('name')}</th><th className="text-end">{t('marks')}</th><th className="text-end">%</th><th>{t('grade')}</th><th /><th /></tr></thead>
            <tbody>{q.data.data.perStudent.map((r, i) => (
              <tr key={r.student._id}><td className="num">{i + 1}</td><td>{r.student.fullName}</td><td className="num text-end">{r.obtained}/{r.max}</td><td className="num text-end">{f.pct(r.percent)}</td><td>{r.grade}</td>
                <td><Badge color={r.passed ? 'green' : 'red'}>{r.passed ? t('passedLabel') : t('notPassed')}</Badge></td>
                <td className="text-end"><Button variant="ghost" aria-label={t('reportCard')} onClick={() => downloadFile(`/api/exams/${exam._id}/report-card/${r.student._id}`, `report-card-${r.student.admissionNumber}.pdf`).catch((e) => setErr(errorMessage(e, t('errorGeneric'))))}><Download className="h-4 w-4" /></Button></td></tr>
            ))}</tbody>
          </Table>
          <div><p className="label">{t('subjectAverages')}</p>
            <Table><thead><tr><th>{t('subject')}</th><th className="text-end">{t('averageScore')}</th><th className="text-end">{t('passRate')}</th></tr></thead>
              <tbody>{q.data.data.subjects.map((s) => <tr key={s.subject}><td>{s.subject}</td><td className="num text-end">{f.pct(s.average)}</td><td className="num text-end">{f.pct(s.passRate)}</td></tr>)}</tbody></Table>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Exams() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const list = useGet<Exam[]>('/api/exams');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'marks' | 'summary'>('marks');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', term: '', startDate: '', endDate: '' });
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [confirmPub, setConfirmPub] = useState(false);
  const [notify, setNotify] = useState(true);
  const create = useAction(() => post<Exam>('/api/exams', { name: form.name, term: form.term || null, startDate: form.startDate, endDate: form.endDate || null }), ['/api/exams']);
  const exam = useMemo(() => list.data?.data.find((e) => e._id === selected) ?? null, [list.data, selected]);
  const publish = useAction((published: boolean) => post<{ notifications: { queued: number } | null }>(`/api/exams/${selected}/publish`, { published, notifyParents: notify }), ['/api/exams']);
  const remove = useAction(() => del(`/api/exams/${selected}`), ['/api/exams']);
  useEffect(() => { if (!selected && list.data?.data[0]) setSelected(list.data.data[0]._id); }, [list.data, selected]);
  return (
    <div className="space-y-5">
      <PageHeader title={t('navExams')} actions={can('exams.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t('newExam')}</Button>} />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {list.isLoading ? <Spinner /> : !list.data?.data.length ? <Card><EmptyState /></Card> : (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <Select className="min-w-60 flex-1" label={t('selectExam')} value={selected} onChange={(e) => setSelected(e.target.value)} options={list.data.data.map((e) => ({ value: e._id, label: `${e.name}${e.term ? ` (${e.term})` : ''} · ${f.date(e.startDate)}` }))} />
            {exam && <Badge color={exam.published ? 'green' : 'gray'}>{exam.published ? t('publishedLabel') : t('notPublished')}</Badge>}
            {exam && can('exams.manage') && (exam.published
              ? <Button variant="secondary" loading={publish.isPending} onClick={() => publish.mutate(false, { onSuccess: () => setMsg({ kind: 'success', text: t('saved') }), onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('unpublish')}</Button>
              : <>
                <Button onClick={() => setConfirmPub(true)}><Send className="h-4 w-4" />{t('publishResults')}</Button>
                <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: () => { setSelected(''); setMsg({ kind: 'success', text: t('saved') }); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('delete')}</Button>
              </>)}
          </div>
        </Card>
      )}
      {exam && <>
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'marks', label: t('enterMarks') }, { value: 'summary', label: t('classResults') }]} />
        {tab === 'marks' ? <MarksEntry key={exam._id} exam={exam} /> : <ClassSummary key={exam._id} exam={exam} />}
      </>}
      <Modal open={creating} onClose={() => setCreating(false)} title={t('newExam')} footer={<><Button variant="secondary" onClick={() => setCreating(false)}>{t('cancel')}</Button><Button loading={create.isPending} disabled={!form.name || !form.startDate || (Boolean(form.endDate) && form.endDate < form.startDate)} onClick={() => create.mutate(undefined, { onSuccess: (e) => { setCreating(false); setSelected(e._id); setForm({ name: '', term: '', startDate: '', endDate: '' }); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('save')}</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label={t('examName')} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label={t('term')} value={form.term} maxLength={60} onChange={(e) => setForm({ ...form, term: e.target.value })} />
          <div />
          <Input label={t('startDate')} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <Input label={t('endDate')} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>
      </Modal>
      <ConfirmDialog open={confirmPub} title={t('publishResults')} message={exam?.name ?? ''} confirmLabel={t('publishResults')} loading={publish.isPending} onCancel={() => setConfirmPub(false)}
        onConfirm={() => publish.mutate(true, { onSuccess: (r) => { setConfirmPub(false); setMsg({ kind: 'success', text: r.notifications ? `${t('saved')} · ${r.notifications.queued} SMS/WhatsApp` : t('saved') }); }, onError: (e) => { setConfirmPub(false); setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } })}>
        <Checkbox label={t('notifyParents')} checked={notify} onChange={setNotify} />
      </ConfirmDialog>
    </div>
  );
}
