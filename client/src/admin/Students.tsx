import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Upload, Download, Search, FileSpreadsheet } from 'lucide-react';
import { STUDENT_STATUSES, normalizePhone } from '@sms/shared';
import { usePaged, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { ApiError, downloadFile, patch, post, qs, _raw } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Spinner, STATUS_TONE, Table, Textarea, errorMessage } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { classroomOptions, useClassrooms, useCustomFields, useSessions, type CustomFieldDef } from './shared';

export interface StudentRow {
  _id: string; admissionNumber: string; fullName: string; dateOfBirth?: string; gender?: string; classroomId: string; classroomName?: string;
  status: string; admissionDate?: string; emergencyContactName?: string; emergencyContactPhone?: string; parentName?: string; whatsappNumber?: string; address?: string; notes?: string; version: number; photoPath?: string;
  customFields?: Record<string, string>;
}

const formSchema = z.object({
  admissionNumber: z.string().trim().min(1).max(40), fullName: z.string().trim().min(1).max(160),
  dateOfBirth: z.string().optional(), gender: z.string().optional(), classroomId: z.string().uuid('Select a classroom'),
  admissionDate: z.string().optional(), emergencyContactName: z.string().max(120).optional(), emergencyContactPhone: z.string().max(30).optional(),
  parentName: z.string().max(120).optional(),
  whatsappNumber: z.string().max(30).optional().refine((v) => !v || normalizePhone(v) !== null, 'Enter a valid WhatsApp number, e.g. 0300 1234567'),
  address: z.string().max(400).optional(), notes: z.string().max(2000).optional(),
  customFields: z.record(z.string().max(500)).optional()
});
type FormValues = z.infer<typeof formSchema>;

/** Stored students hold `null` for blank optional fields; the form works with strings only. */
const toFormValues = (s: StudentRow): FormValues => ({
  admissionNumber: s.admissionNumber, fullName: s.fullName, classroomId: s.classroomId,
  dateOfBirth: s.dateOfBirth ?? '', gender: s.gender ?? 'unspecified', admissionDate: s.admissionDate ?? '',
  emergencyContactName: s.emergencyContactName ?? '', emergencyContactPhone: s.emergencyContactPhone ?? '',
  parentName: s.parentName ?? '', whatsappNumber: s.whatsappNumber ?? '',
  address: s.address ?? '', notes: s.notes ?? '',
  customFields: Object.fromEntries(Object.entries(s.customFields ?? {}).map(([k, x]) => [k, x == null ? '' : String(x)]))
});
const clean = (v: FormValues) =>Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
/** Only defined fields are sent; blank values are dropped (the server stores non-empty values only). */
const customValues = (v: FormValues, defs: CustomFieldDef[]) => Object.fromEntries(defs.map((d) => [d.key, (v.customFields?.[d.key] ?? '').trim()]).filter(([, x]) => x));

export function StudentForm({ initial, onDone, onCancel }: { initial?: StudentRow; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const rooms = useClassrooms();
  const defs = useCustomFields(useAuth((s) => s.can('settings.view')));
  const [dups, setDups] = useState<{ student: { fullName: string; admissionNumber: string }; match: { level: string; reason?: string } }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting }, getValues } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial ? toFormValues(initial) : { gender: 'unspecified' } as FormValues
  });
  // Never fail silently: some fields have no inline error slot.
  const onInvalid = (e: Record<string, { message?: string } | undefined>) => {
    const first = Object.entries(e).find(([, x]) => x?.message);
    setErr(first ? `${first[0]}: ${first[1]!.message}` : t('errorGeneric'));
  };
  const save = async (v: FormValues, confirmDuplicate = false) => {
    setErr(null);
    try {
      const customFields = defs.length ? customValues(v, defs) : undefined;
      if (initial) { const { classroomId: _c, ...rest } = clean(v); await patch(`/api/students/${initial._id}`, { ...rest, customFields, version: initial.version, confirmDuplicate }); }
      else await post('/api/students', { ...clean(v), customFields, confirmDuplicate });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && Array.isArray(e.details)) { setDups(e.details as never); return; }
      setErr(errorMessage(e, t('errorGeneric')));
    }
  };
  return (
    <form onSubmit={handleSubmit((v) => save(v), (e) => onInvalid(e as never))} className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      {dups && (
        <Alert kind="warning" title={t('possibleDuplicate')}>
          <p>{t('duplicateExplain')}</p>
          <ul className="my-2 list-disc ps-5">{dups.map((d, i) => <li key={i}>{d.student.fullName} ({d.student.admissionNumber}) — {d.match.level === 'exact' ? t('admissionNumber') : d.match.reason}</li>)}</ul>
          {!dups.some((d) => d.match.level === 'exact') && <Button type="button" variant="secondary" onClick={() => save(getValues(), true)}>{t('createAnyway')}</Button>}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('admissionNumber')} {...register('admissionNumber')} error={errors.admissionNumber?.message} />
        <Input label={t('fullName')} {...register('fullName')} error={errors.fullName?.message} />
        <Input type="date" label={t('dateOfBirth')} {...register('dateOfBirth')} />
        <Select label={t('gender')} {...register('gender')} options={['unspecified', 'male', 'female', 'other'].map((g) => ({ value: g, label: t(g as TKey) }))} />
        {!initial && <Select label={t('classroom')} {...register('classroomId')} placeholder="—" options={classroomOptions(rooms.data?.data)} error={errors.classroomId?.message} />}
        <Input type="date" label={t('admissionDate')} {...register('admissionDate')} />
        <Input label={t('parentNameLabel')} {...register('parentName')} placeholder={t('parentNameHint')} />
        <Input label={t('parentWhatsapp')} type="tel" inputMode="tel" {...register('whatsappNumber')} placeholder="0300 1234567" hint={t('parentWhatsappHint')} error={errors.whatsappNumber?.message} />
        <Input label={t('emergencyContact')} {...register('emergencyContactName')} />
        <Input label={t('emergencyPhone')} {...register('emergencyContactPhone')} />
      </div>
      {defs.length > 0 && <div className="grid gap-4 sm:grid-cols-2">{defs.map((d) => <Input key={d.key} label={d.label} {...register(`customFields.${d.key}`)} />)}</div>}
      <Textarea label={t('address')} {...register('address')} />
      <Textarea label={t('notes')} {...register('notes')} />
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button><Button type="submit" loading={isSubmitting}>{t('save')}</Button></div>
    </form>
  );
}

interface ImportReport { dryRun: boolean; totalRows: number; validRows: number; invalidRows: number; imported: number; report: { row: number; admissionNumber?: string; errors: string[]; warnings: string[] }[] }

function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const sessions = useSessions();
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const sid = sessionId || sessions.data?.data.find((s) => s.isDefault)?._id || '';
      const r = await _raw('POST', `/api/students/import${qs({ dryRun, sessionId: sid })}`, fd);
      const j = await r.json();
      if (!j.ok) throw new ApiError(r.status, j.error.code, j.error.message);
      setReport(j.data);
      if (!dryRun) onImported();
    } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('importStudents')} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">{t('importHelp')}</p>
        <Button variant="secondary" onClick={() => downloadFile('/api/students/import/template', 'student-import-template.csv')}><FileSpreadsheet className="h-4 w-4" />{t('downloadTemplate')}</Button>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('academicSession')} value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder={t('default')} options={(sessions.data?.data ?? []).map((s) => ({ value: s._id, label: s.name }))} />
          <Input type="file" label="CSV / XLSX" accept=".csv,.xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        </div>
        {err && <Alert kind="error">{err}</Alert>}
        {report && (
          <div className="space-y-3">
            <Alert kind={report.imported ? 'success' : report.invalidRows ? 'warning' : 'info'}>{report.imported ? `${report.imported} imported.` : t('rowsValid', { valid: report.validRows, invalid: report.invalidRows })}</Alert>
            {report.report.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-surface-line"><Table><thead><tr><th>{t('row')}</th><th>{t('admissionNumber')}</th><th>{t('errors')}</th></tr></thead>
                <tbody>{report.report.map((r) => <tr key={r.row}><td className="num">{r.row}</td><td>{r.admissionNumber}</td><td><ul className="text-xs">{r.errors.map((e, i) => <li key={i} className="text-red-700">{e}</li>)}{r.warnings.map((w, i) => <li key={'w' + i} className="text-amber-700">{w}</li>)}</ul></td></tr>)}</tbody></Table></div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={!file} loading={busy && !report} onClick={() => run(true)}>{t('checkFile')}</Button>
          {report?.dryRun && report.validRows > 0 && <Button loading={busy} onClick={() => run(false)}>{t('importValidRows', { n: report.validRows })}</Button>}
        </div>
      </div>
    </Modal>
  );
}

export default function Students() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const rooms = useClassrooms();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(''); const [classroomId, setClassroom] = useState(''); const [status, setStatus] = useState('active'); const [sort, setSort] = useState('fullName');
  const url = `/api/students${qs({ page, pageSize: 25, q, classroomId, status, sort })}`;
  const list = usePaged<StudentRow>(url);
  const [params, setParams] = useSearchParams();
  // ?add=1 (from the home page "Add student" button) opens the form straight away.
  const [adding, setAddingState] = useState(() => params.get('add') === '1');
  const setAdding = (v: boolean) => { setAddingState(v); if (!v && params.has('add')) setParams({}, { replace: true }); }; const [importing, setImporting] = useState(false);
  const refresh = useAction(async () => undefined, ['/api/students']);

  return (
    <div>
      <PageHeader title={t('students')} actions={<>
        {can('students.import') && <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" />{t('import')}</Button>}
        <Button variant="secondary" onClick={() => downloadFile(`/api/students/export/file${qs({ format: 'xlsx', classroomId, status })}`, 'students.xlsx')}><Download className="h-4 w-4" />Excel</Button>
        <Button variant="secondary" onClick={() => downloadFile(`/api/students/export/file${qs({ format: 'csv', classroomId, status })}`, 'students.csv')}><Download className="h-4 w-4" />CSV</Button>
        {can('students.manage') && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t('addStudent')}</Button>}
      </>} />
      <CacheNotice fromCache={list.data?.fromCache} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-4">
          <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" /><input className="input ps-9" placeholder={`${t('search')}: ${t('fullName')}, ${t('admissionNumber')}, ${t('phone')}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <Select value={classroomId} onChange={(e) => { setClassroom(e.target.value); setPage(1); }} placeholder={`${t('classroom')}: ${t('all')}`} options={classroomOptions(rooms.data?.data)} aria-label={t('classroom')} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={STUDENT_STATUSES.map((s) => ({ value: s, label: t(s as TKey) }))} aria-label={t('status')} />
        </div>
        {list.isLoading ? <Spinner /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data?.items.length ? <EmptyState /> : (
          <>
            <Table>
              <thead><tr>
                <th><button onClick={() => setSort(sort === 'admissionNumber' ? '-admissionNumber' : 'admissionNumber')}>{t('admissionNumber')}</button></th>
                <th><button onClick={() => setSort(sort === 'fullName' ? '-fullName' : 'fullName')}>{t('fullName')}</button></th>
                <th>{t('classroom')}</th><th>{t('dateOfBirth')}</th><th>{t('status')}</th><th />
              </tr></thead>
              <tbody>{list.data.items.map((s) => (
                <tr key={s._id} className="hover:bg-surface-muted/60">
                  <td className="num font-mono text-xs">{s.admissionNumber}</td>
                  <td><Link to={`/admin/students/${s._id}`} className="font-medium text-ink hover:text-brand">{s.fullName}</Link></td>
                  <td>{s.classroomName}</td><td className="num">{f.date(s.dateOfBirth)}</td>
                  <td><Badge color={STATUS_TONE[s.status]}>{t(s.status as TKey)}</Badge></td>
                  <td className="text-end"><Link to={`/admin/students/${s._id}`} className="text-sm text-brand">{t('viewSheet')} →</Link></td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('addStudent')} wide>
        <StudentForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); refresh.mutate(undefined); }} />
      </Modal>
      <ImportDialog open={importing} onClose={() => setImporting(false)} onImported={() => refresh.mutate(undefined)} />
    </div>
  );
}
