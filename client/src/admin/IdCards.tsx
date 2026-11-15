import { useState } from 'react';
import { Download, IdCard, RotateCcw } from 'lucide-react';
import { usePaged } from '../hooks/useApi';
import { useT } from '../i18n';
import { downloadFile, post, qs } from '../services/api';
import { Alert, Button, Card, ConfirmDialog, EmptyState, Input, PageHeader, Pagination, Select, Spinner, Table, errorMessage } from '../components/ui';
import { classroomOptions, useClassrooms } from './shared';

type Layout = 'sheet' | 'card';

/** Card download + revoke, also used on the student profile. */
export function IdCardActions({ studentId, admissionNumber, compact }: { studentId: string; admissionNumber: string; compact?: boolean }) {
  const t = useT();
  const [layout, setLayout] = useState<Layout>('card');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const download = async () => {
    setBusy(true); setMsg(null);
    try { await downloadFile(`/api/id-cards/students/${studentId}${qs({ layout })}`, `id-card-${admissionNumber}.pdf`); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } finally { setBusy(false); }
  };
  const rotate = async () => {
    setBusy(true);
    try { await post(`/api/id-cards/students/${studentId}/rotate`); setMsg({ kind: 'success', text: t('cardReissued') }); } catch (e) { setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }); } finally { setBusy(false); setConfirm(false); }
  };
  return (
    <div className="space-y-2">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {!compact && <Select aria-label={t('cardLayout')} value={layout} onChange={(e) => setLayout(e.target.value as Layout)} options={[{ value: 'card', label: t('layoutCard') }, { value: 'sheet', label: t('layoutSheet') }]} />}
        <Button variant="secondary" loading={busy} onClick={() => void download()}><Download className="h-4 w-4" />{t('idCard')}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}><RotateCcw className="h-4 w-4" />{t('reissueCard')}</Button>
      </div>
      <ConfirmDialog open={confirm} danger title={t('reissueCard')} message={t('reissueConfirm')} confirmLabel={t('reissueCard')} loading={busy} onCancel={() => setConfirm(false)} onConfirm={() => void rotate()} />
    </div>
  );
}

export default function IdCards() {
  const t = useT();
  const rooms = useClassrooms();
  const [classroomId, setClassroomId] = useState('');
  const [layout, setLayout] = useState<Layout>('sheet');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const students = usePaged<{ _id: string; fullName: string; admissionNumber: string; classroomName?: string }>(`/api/students${qs({ q, classroomId, page, pageSize: 25 })}`);
  const bulk = async () => {
    setBusy(true); setErr(null);
    const room = rooms.data?.data.find((r) => r._id === classroomId);
    try { await downloadFile(`/api/id-cards/classrooms/${classroomId}${qs({ layout })}`, `id-cards-${room?.name ?? 'class'}.pdf`); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <PageHeader title={t('navIdCards')} subtitle={t('idCardsHelp')} />
      <Card title={t('printClassCards')}>
        {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
        <div className="flex flex-wrap items-end gap-3">
          <Select label={t('classroom')} value={classroomId} onChange={(e) => { setClassroomId(e.target.value); setPage(1); }} placeholder={t('selectClassroom')} options={classroomOptions(rooms.data?.data)} />
          <Select label={t('cardLayout')} value={layout} onChange={(e) => setLayout(e.target.value as Layout)} options={[{ value: 'sheet', label: t('layoutSheet') }, { value: 'card', label: t('layoutCard') }]} />
          <Button disabled={!classroomId} loading={busy} onClick={() => void bulk()}><IdCard className="h-4 w-4" />{t('download')}</Button>
        </div>
      </Card>
      <Card padded={false} title={t('students')} actions={<Input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}>
        {students.isLoading ? <Spinner /> : !students.data?.items.length ? <EmptyState /> : (
          <>
            <Table>
              <thead><tr><th>{t('name')}</th><th>{t('admissionNumber')}</th><th>{t('classroom')}</th><th /></tr></thead>
              <tbody>{students.data.items.map((s) => (
                <tr key={s._id}><td className="font-medium">{s.fullName}</td><td className="num">{s.admissionNumber}</td><td>{s.classroomName}</td><td className="text-end"><IdCardActions studentId={s._id} admissionNumber={s.admissionNumber} compact /></td></tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={students.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
