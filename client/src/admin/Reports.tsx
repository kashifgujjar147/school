import { useState } from 'react';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useT, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { downloadFile, getPaged, qs } from '../services/api';
import { Alert, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Spinner, Table, errorMessage } from '../components/ui';
import { CacheNotice } from '../components/Layout';
import { classroomOptions, dateRangePreset, useClassrooms } from './shared';

const TYPES = ['summary', 'register', 'absentees', 'late', 'leave', 'percentage', 'student', 'submissions', 'notifications'] as const;
type ReportType = (typeof TYPES)[number];
interface Report { title: string; subtitle: string; columns: { header: string; key: string; align?: string }[]; rows: Record<string, unknown>[]; summary: string[] }

export default function Reports() {
  const t = useT();
  const config = useAuth((s) => s.config);
  const rooms = useClassrooms();
  const [type, setType] = useState<ReportType>('summary');
  const tz = config?.timeZone;
  const [range, setRange] = useState(() => dateRangePreset('month', tz));
  const [classroomId, setClassroom] = useState('');
  const [studentQ, setStudentQ] = useState(''); const [studentId, setStudentId] = useState('');
  const [students, setStudents] = useState<{ _id: string; fullName: string; admissionNumber: string }[]>([]);
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('');
  const [run, setRun] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const params = { from: range.from, to: range.to, classroomId, studentId: type === 'student' ? studentId : undefined, q: search, sort };
  const report = useGet<Report>(run);
  const types = TYPES.filter((x) => x !== 'notifications' || config?.package === 'standard');

  const exp = (format: 'csv' | 'xlsx' | 'pdf') => downloadFile(`/api/reports/${type}${qs({ ...params, format })}`, `report.${format}`).catch((e) => setErr(errorMessage(e, t('errorGeneric'))));

  return (
    <div>
      <PageHeader title={t('reports')} />
      <Card className="mb-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Select label={t('reportType')} value={type} onChange={(e) => { setType(e.target.value as ReportType); setRun(null); }} options={types.map((x) => ({ value: x, label: t(`rep_${x}` as TKey) }))} />
          <Input type="date" label={t('from')} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input type="date" label={t('to')} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <Select label={t('classroom')} value={classroomId} onChange={(e) => setClassroom(e.target.value)} placeholder={t('all')} options={classroomOptions(rooms.data?.data)} />
        </div>
        {type === 'student' && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Input label={t('students')} value={studentQ} onChange={(e) => setStudentQ(e.target.value)} placeholder={`${t('fullName')} / ${t('admissionNumber')}`} />
            <Button variant="secondary" onClick={async () => setStudents((await getPaged<{ _id: string; fullName: string; admissionNumber: string }>(`/api/students${qs({ q: studentQ, pageSize: 20, status: 'active' })}`)).items)}>{t('search')}</Button>
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="—" options={students.map((s) => ({ value: s._id, label: `${s.fullName} (${s.admissionNumber})` }))} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['today', 'week', 'month'] as const).map((p) => <Button key={p} variant="ghost" onClick={() => setRange(dateRangePreset(p, tz))}>{t(p === 'today' ? 'today' : p === 'week' ? 'thisWeek' : 'thisMonth')}</Button>)}
          <div className="ms-auto flex flex-wrap gap-2">
            <Button disabled={type === 'student' && !studentId} onClick={() => { setErr(null); setRun(`/api/reports/${type}${qs(params)}`); }}>{t('generate')}</Button>
            <Button variant="secondary" onClick={() => exp('pdf')}><FileText className="h-4 w-4" />PDF</Button>
            <Button variant="secondary" onClick={() => exp('xlsx')}><FileSpreadsheet className="h-4 w-4" />Excel</Button>
            <Button variant="secondary" onClick={() => exp('csv')}><FileDown className="h-4 w-4" />CSV</Button>
          </div>
        </div>
      </Card>
      {err && <div className="mb-4"><Alert kind="error">{err}</Alert></div>}
      {run && (report.isLoading ? <Spinner /> : report.isError ? <ErrorState error={report.error} /> : report.data && (
        <Card title={report.data.data.title} actions={<span className="text-sm text-ink-soft">{report.data.data.subtitle}</span>} padded={false}>
          <div className="px-5 pt-3"><CacheNotice fromCache={report.data.fromCache} /></div>
          {['register', 'absentees', 'late', 'leave', 'student'].includes(type) && <div className="flex gap-2 px-5 pt-3"><Input placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} /><Button variant="secondary" onClick={() => setRun(`/api/reports/${type}${qs(params)}`)}>{t('filter')}</Button></div>}
          {type === 'percentage' && <div className="px-5 pt-3"><Select value={sort} onChange={(e) => { setSort(e.target.value); setRun(`/api/reports/${type}${qs({ ...params, sort: e.target.value })}`); }} options={[{ value: '', label: `↕ ${t('fullName')}` }, { value: 'percent', label: '↕ %' }]} /></div>}
          {report.data.data.summary.length > 0 && <div className="space-y-1 px-5 py-3 text-sm font-medium">{report.data.data.summary.map((s, i) => <p key={i}>{s}</p>)}</div>}
          {report.data.data.rows.length === 0 ? <EmptyState /> : (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <thead><tr>{report.data.data.columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'text-end' : ''}>{c.header}</th>)}</tr></thead>
                <tbody>{report.data.data.rows.slice(0, 2000).map((r, i) => <tr key={i} className={r.status === 'MISSING' ? 'bg-amber-50' : ''}>{report.data!.data.columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'num text-end' : ''}>{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody>
              </Table>
              {report.data.data.rows.length > 2000 && <p className="p-4 text-sm text-ink-soft">Showing first 2000 of {report.data.data.rows.length} rows. Export for the full report.</p>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
