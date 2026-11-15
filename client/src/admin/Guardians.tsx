import { useState } from 'react';
import { Plus, Search, Star } from 'lucide-react';
import { usePaged, useAction } from '../hooks/useApi';
import { useT } from '../i18n';
import { useAuth } from '../store/auth';
import { del, patch, post, qs, getPaged } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, errorMessage } from '../components/ui';

interface GuardianRow { _id: string; fullName: string; relation: string; phone: string; altPhone?: string; email?: string; smsOptIn: boolean; language: 'en' | 'ur'; students: { _id: string; fullName: string; admissionNumber: string; isPrimary: boolean }[]; portalAccount?: { _id: string; username: string; status: string; lastLoginAt?: string } | null }

/**
 * Parent portal account for one guardian. The account sees exactly the children linked to this
 * guardian, so linking a second child here gives the same sign-in access to both.
 */
function PortalAccount({ g, onChange }: { g: GuardianRow; onChange: () => void }) {
  const t = useT();
  const can = useAuth((s) => s.can);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ username: '', password: '' });
  const [created, setCreated] = useState<{ username: string; temporaryPassword?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const acc = g.portalAccount;
  const manage = can('guardians.manage') && can('users.manage');
  const create = async () => {
    setBusy(true); setErr(null);
    try { setCreated(await post<{ username: string; temporaryPassword?: string }>(`/api/guardians/${g._id}/portal-account`, { username: v.username, ...(v.password ? { password: v.password } : {}) })); onChange(); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  const setStatus = async (status: string) => { try { await patch(`/api/guardians/${g._id}/portal-account`, { status }); onChange(); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } };
  return (
    <>
      {acc ? (
        <span className="inline-flex flex-wrap items-center gap-1"><Badge color={acc.status === 'active' ? 'green' : 'gray'}>{acc.username}</Badge>
          {manage && <Button variant="ghost" onClick={() => void setStatus(acc.status === 'active' ? 'suspended' : 'active')}>{acc.status === 'active' ? t('suspend') : t('activate')}</Button>}</span>
      ) : manage ? <Button variant="ghost" onClick={() => { setOpen(true); setCreated(null); setErr(null); setV({ username: g.phone.replace(/\D/g, '').slice(-10), password: '' }); }}>{t('createPortalAccount')}</Button> : <span className="text-xs text-ink-faint">{t('noPortalAccount')}</span>}
      {err && !open && <p className="text-xs text-red-700">{err}</p>}
      <Modal open={open} onClose={() => setOpen(false)} title={`${t('createPortalAccount')} · ${g.fullName}`}>
        {created ? (
          <div className="space-y-3 text-sm">
            <Alert kind="success">{t('portalAccountCreated')}</Alert>
            <p>{t('username')}: <code className="rounded bg-surface-muted px-2 py-1">{created.username}</code></p>
            {created.temporaryPassword && <p>{t('password')}: <code className="rounded bg-surface-muted px-2 py-1">{created.temporaryPassword}</code></p>}
            <p className="text-ink-soft">{window.location.origin}/parent/login</p>
            <Button onClick={() => setOpen(false)}>{t('close')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {err && <Alert kind="error">{err}</Alert>}
            <p className="text-sm text-ink-soft">{g.students.map((s) => s.fullName).join(', ') || '—'}</p>
            <Input label={t('username')} value={v.username} autoComplete="off" onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} hint="3-40: a-z 0-9 . _ -" />
            <Input label={t('passwordOptional')} type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button loading={busy} disabled={!/^[a-z0-9._-]{3,40}$/.test(v.username)} onClick={() => void create()}>{t('create')}</Button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

function GuardianForm({ initial, onSaved, onCancel }: { initial?: Partial<GuardianRow>; onSaved: (g: { _id: string }) => void; onCancel: () => void }) {
  const t = useT();
  const [v, setV] = useState({ fullName: initial?.fullName ?? '', relation: initial?.relation ?? '', phone: initial?.phone ?? '', altPhone: initial?.altPhone ?? '', email: initial?.email ?? '', smsOptIn: initial?.smsOptIn ?? true, language: initial?.language ?? 'en' });
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(initial?._id ? await patch(`/api/guardians/${initial._id}`, v) : await post('/api/guardians', v)); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('fullName')} value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
        <Input label={t('relation')} value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} placeholder="Father / Mother / Guardian" />
        <Input label={t('phone')} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="0300 1234567" />
        <Input label={t('altPhone')} type="tel" value={v.altPhone} onChange={(e) => setV({ ...v, altPhone: e.target.value })} />
        <Input label={t('email')} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <Select label={t('language')} value={v.language} onChange={(e) => setV({ ...v, language: e.target.value as 'en' | 'ur' })} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} />
      </div>
      <Checkbox label={t('smsOptIn')} checked={v.smsOptIn} onChange={(x) => setV({ ...v, smsOptIn: x })} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>{t('cancel')}</Button><Button loading={busy} disabled={!v.fullName || !v.phone || !v.relation} onClick={save}>{t('save')}</Button></div>
    </div>
  );
}

/** Guardian list + linking, embedded in the student profile. */
export function GuardianLinks({ studentId, guardians, onChange }: { studentId: string; guardians: { _id: string; fullName: string; relation: string; phone: string; smsOptIn: boolean; link: { _id: string; isPrimary: boolean; receivesAlerts: boolean } }[]; onChange: () => void }) {
  const t = useT();
  const can = useAuth((s) => s.can);
  const [mode, setMode] = useState<'none' | 'new' | 'existing'>('none');
  const [search, setSearch] = useState(''); const [results, setResults] = useState<GuardianRow[]>([]); const [searched, setSearched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const link = async (guardianId: string) => {
    try { await post(`/api/guardians/students/${studentId}/link`, { guardianId, isPrimary: guardians.length === 0, receivesAlerts: true }); setMode('none'); onChange(); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); }
  };
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); onChange(); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } };
  return (
    <Card title={t('guardians')} actions={can('guardians.manage') && <><Button variant="secondary" onClick={() => setMode('existing')}>{t('linkGuardian')}</Button><Button onClick={() => setMode('new')}><Plus className="h-4 w-4" />{t('addGuardian')}</Button></>}>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {guardians.length === 0 ? <EmptyState /> : (
        <ul className="divide-y divide-surface-line text-sm">
          {guardians.map((g) => (
            <li key={g._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="font-medium">{g.fullName} {g.link.isPrimary && <Badge color="violet"><Star className="h-3 w-3" />{t('primary')}</Badge>}</p><p className="num text-xs text-ink-faint">{g.relation} · {g.phone}{!g.smsOptIn ? ' · SMS off' : ''}</p></div>
              {can('guardians.manage') && <div className="flex items-center gap-2">
                <Checkbox label="SMS" checked={g.link.receivesAlerts} onChange={(x) => void act(() => patch(`/api/guardians/links/${g.link._id}`, { receivesAlerts: x }))} />
                {!g.link.isPrimary && <Button variant="ghost" onClick={() => void act(() => patch(`/api/guardians/links/${g.link._id}`, { isPrimary: true }))}>{t('makePrimary')}</Button>}
                <Button variant="ghost" onClick={() => void act(() => del(`/api/guardians/links/${g.link._id}`))}>{t('unlink')}</Button>
              </div>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={mode === 'new'} onClose={() => setMode('none')} title={t('addGuardian')}>
        <GuardianForm onCancel={() => setMode('none')} onSaved={(g) => void link(g._id)} />
      </Modal>
      <Modal open={mode === 'existing'} onClose={() => setMode('none')} title={t('linkGuardian')}>
        <div className="space-y-3">
          <div className="flex gap-2"><Input className="flex-1" placeholder={`${t('search')}: ${t('name')} / ${t('phone')}`} value={search} onChange={(e) => setSearch(e.target.value)} /><Button variant="secondary" aria-label={t('search')} onClick={async () => { setErr(null); try { const r = (await getPaged<GuardianRow>(`/api/guardians${qs({ q: search, pageSize: 20 })}`)).items; setResults(r); setSearched(true); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } }}><Search className="h-4 w-4" /></Button></div>
          {err && <Alert kind="error">{err}</Alert>}
          {searched && results.length === 0 && <p className="text-sm text-ink-soft">{t('noMatches')}</p>}
          <ul className="divide-y divide-surface-line text-sm">{results.map((g) => <li key={g._id} className="flex items-center justify-between py-2"><span>{g.fullName} <span className="num text-ink-faint">{g.phone}</span></span><Button variant="secondary" onClick={() => void link(g._id)}>{t('linkGuardian')}</Button></li>)}</ul>
        </div>
      </Modal>
    </Card>
  );
}

export default function Guardians() {
  const t = useT();
  const can = useAuth((s) => s.can);
  const config = useAuth((s) => s.config);
  const [page, setPage] = useState(1); const [q, setQ] = useState('');
  const list = usePaged<GuardianRow>(`/api/guardians${qs({ page, pageSize: 25, q })}`);
  const [editing, setEditing] = useState<Partial<GuardianRow> | null>(null);
  const refresh = useAction(async () => undefined, ['/api/guardians']);
  return (
    <div>
      <PageHeader title={t('navGuardians')} actions={can('guardians.manage') && <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" />{t('addGuardian')}</Button>} />
      <Card padded={false}>
        <div className="border-b border-surface-line p-4"><Input placeholder={`${t('search')}: ${t('name')} / ${t('phone')}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState>Link guardians from each student's profile, or add them here.</EmptyState> : (
          <>
            <Table>
              <thead><tr><th>{t('name')}</th><th>{t('relation')}</th><th>{t('phone')}</th><th>{t('students')}</th><th>SMS</th>{config?.package === 'standard' && <th>{t('portalAccount')}</th>}<th /></tr></thead>
              <tbody>{list.data.items.map((g) => (
                <tr key={g._id}><td className="font-medium">{g.fullName}</td><td>{g.relation}</td><td className="num">{g.phone}</td>
                  <td className="text-xs">{g.students.map((s) => s.fullName).join(', ') || '—'}</td>
                  <td>{g.smsOptIn ? <Badge color="green">{t('yes')}</Badge> : <Badge>{t('no')}</Badge>}</td>
                  {config?.package === 'standard' && <td><PortalAccount g={g} onChange={() => refresh.mutate(undefined)} /></td>}
                  <td className="text-end">{can('guardians.manage') && <Button variant="ghost" onClick={() => setEditing(g)}>{t('edit')}</Button>}</td></tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?._id ? t('edit') : t('addGuardian')}>
        {editing && <GuardianForm initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); refresh.mutate(undefined); }} />}
      </Modal>
    </div>
  );
}
