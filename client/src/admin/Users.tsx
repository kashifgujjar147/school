import { useState } from 'react';
import { Plus, KeyRound, Lock, LogOut } from 'lucide-react';
import { APPROVABLE_ROLES, PERMISSIONS, STAFF_ROLES as ROLES, type Permission } from '@sms/shared';
import { useGet, usePaged, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { patch, post, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, STATUS_TONE, Table, Tabs, errorMessage } from '../components/ui';

interface UserRow { _id: string; username: string; fullName: string; email?: string; phone?: string; role: string; status: string; lastLoginAt?: string; lockedUntil?: string; version: number; extraPermissions: Permission[]; revokedPermissions: Permission[] }
interface UserDetail extends UserRow { effectivePermissions: Permission[]; assignments: { _id: string; classroomName?: string; startedAt: string; endedAt?: string; isHomeroom: boolean }[] }

function CreateUser({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const me = useAuth((s) => s.user);
  const [v, setV] = useState({ username: '', fullName: '', email: '', phone: '', role: 'teacher', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const m = useAction(() => post('/api/users', { ...v, email: v.email || null, phone: v.phone || null }), ['/api/users']);
  return (
    <div className="space-y-4">
      {err && <Alert kind="error">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('username')} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} hint="a-z, 0-9, . _ -" />
        <Input label={t('fullName')} value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
        <Select label={t('role')} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} options={ROLES.filter((r) => r !== 'principal' || me?.role === 'principal').map((r) => ({ value: r, label: t(r) }))} />
        <Input label={t('temporaryPassword')} type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} hint="Works directly for sign-in; the user can change it later in account settings" />
        <Input label={t('email')} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <Input label={t('phone')} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onCancel}>{t('cancel')}</Button><Button loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: onDone, onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) })}>{t('create')}</Button></div>
    </div>
  );
}

/**
 * Approval of a self-registered (pending) account: pick its role and activate it. Parent and
 * student accounts must be linked to their guardian / student record. The server enforces the
 * same rules (principal-only for principal, no granting beyond your own permissions).
 */
function ApprovePanel({ u, onDone, onError }: { u: UserRow; onDone: (text: string) => void; onError: (e: unknown) => void }) {
  const t = useT();
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const pkg = useAuth((s) => s.config?.package);
  const roles = APPROVABLE_ROLES.filter((r) =>
    (r !== 'principal' || me?.role === 'principal') &&
    (r !== 'parent' || (pkg === 'standard' && can('guardians.manage'))) &&
    (r !== 'student' || can('students.manage')));
  const [role, setRole] = useState<string>('');
  const [search, setSearch] = useState('');
  const [linkId, setLinkId] = useState('');
  const linkUrl = role === 'parent' ? `/api/guardians${qs({ page: 1, pageSize: 20, q: search })}` : role === 'student' ? `/api/students${qs({ page: 1, pageSize: 20, q: search })}` : null;
  const records = usePaged<{ _id: string; fullName: string; admissionNumber?: string; phone?: string }>(linkUrl);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/users']);
  const needsLink = role === 'parent' || role === 'student';
  const approve = () => act.mutate(() => post(`/api/users/${u._id}/approve`, {
    role, version: u.version, ...(role === 'parent' ? { guardianId: linkId } : {}), ...(role === 'student' ? { studentId: linkId } : {})
  }), { onSuccess: () => onDone(t('saved')), onError });
  const reject = () => act.mutate(() => post(`/api/users/${u._id}/reject`), { onSuccess: () => onDone(t('saved')), onError });
  return (
    <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="approve-panel">
      <div><p className="font-medium">{t('approveAccount')}</p><p className="text-sm text-ink-soft">{t('approveHint')}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={t('role')} value={role} onChange={(e) => { setRole(e.target.value); setLinkId(''); setSearch(''); }} placeholder="—" options={roles.map((r) => ({ value: r, label: t(r) }))} />
        {needsLink && <Input label={role === 'parent' ? t('guardianRecord') : t('studentRecord')} placeholder={t('searchToLink')} value={search} onChange={(e) => { setSearch(e.target.value); setLinkId(''); }} />}
        {needsLink && <Select className="sm:col-span-2" label={role === 'parent' ? t('guardianRecord') : t('studentRecord')} value={linkId} onChange={(e) => setLinkId(e.target.value)} placeholder="—"
          options={(records.data?.items ?? []).map((r) => ({ value: r._id, label: [r.fullName, r.admissionNumber, r.phone].filter(Boolean).join(' · ') }))} />}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" loading={act.isPending} onClick={reject}>{t('reject')}</Button>
        <Button loading={act.isPending} disabled={!role || (needsLink && !linkId)} onClick={approve}>{t('approve')}</Button>
      </div>
    </div>
  );
}

function UserPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT(); const f = useFormat();
  const me = useAuth((s) => s.user);
  const can = useAuth((s) => s.can);
  const q = useGet<UserDetail>(`/api/users/${id}`);
  const sessions = useGet<{ _id: string; ip?: string; userAgent?: string; lastSeenAt: string }[]>(can('security.view') ? `/api/users/${id}/sessions` : null);
  const history = useGet<{ _id: string; success: boolean; reason?: string; ip?: string; at: string }[]>(can('security.view') ? `/api/users/${id}/login-history` : null);
  const [tab, setTab] = useState<'profile' | 'permissions' | 'security'>('profile');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ fullName: string; email: string; phone: string } | null>(null);
  const inv = ['/api/users'];
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), inv);
  const onError = (e: unknown) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) });
  const run = (fn: () => Promise<unknown>, ok?: string) => act.mutate(fn, { onSuccess: () => { setMsg(ok ? { kind: 'success', text: ok } : null); void q.refetch(); void sessions.refetch(); }, onError });
  const issue = (mode: 'link' | 'temporary') => act.mutate(() => post<{ resetUrl?: string; temporaryPassword?: string }>(`/api/users/${id}/reset-password`, { mode }), {
    onSuccess: (r) => { setMsg(null); const x = r as { resetUrl?: string; temporaryPassword?: string }; setSecret(x.resetUrl ?? x.temporaryPassword ?? null); void sessions.refetch(); },
    onError
  });
  if (!q.data) return <Spinner />;
  const u = q.data.data;
  const self = u._id === me?.id;
  const canManage = can('users.manage');
  // Principal accounts can only be managed by a principal (enforced by the server as well).
  const locked = !canManage || (u.role === 'principal' && me?.role !== 'principal');
  const pendingApproval = u.status === 'pending' || u.role === 'unassigned';
  const pf = profile ?? { fullName: u.fullName, email: u.email ?? '', phone: u.phone ?? '' };
  const profileChanged = pf.fullName.trim() !== u.fullName || pf.email.trim() !== (u.email ?? '') || pf.phone.trim() !== (u.phone ?? '');
  const toggle = (list: Permission[], p: Permission) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

  return (
    <Modal open onClose={onClose} title={`${u.fullName} (${u.username})`} wide>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {secret && <div className="mb-4"><Alert kind="warning" title={t('shownOnce')}><code className="select-all break-all rounded bg-white px-2 py-1 font-mono text-sm">{secret}</code></Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: t('fullName') }, { value: 'permissions', label: t('permissions') }, { value: 'security', label: t('navSecurity') }]} />
      {tab === 'profile' && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('fullName')} value={pf.fullName} disabled={locked} onChange={(e) => setProfile({ ...pf, fullName: e.target.value })} />
            <Input label={t('email')} type="email" value={pf.email} disabled={locked} onChange={(e) => setProfile({ ...pf, email: e.target.value })} />
            <Input label={t('phone')} value={pf.phone} disabled={locked} onChange={(e) => setProfile({ ...pf, phone: e.target.value })} />
            {!locked && <div className="flex items-end"><Button loading={act.isPending} disabled={!profileChanged || !pf.fullName.trim()} onClick={() => act.mutate(() => patch(`/api/users/${id}`, { fullName: pf.fullName.trim(), email: pf.email.trim() || null, phone: pf.phone.trim() || null, version: u.version }), {
              onSuccess: () => { setProfile(null); setMsg({ kind: 'success', text: t('saved') }); void q.refetch(); }, onError
            })}>{t('save')}</Button></div>}
          </div>
          {pendingApproval && canManage && <ApprovePanel u={u} onError={onError} onDone={(text) => { setMsg({ kind: 'success', text }); void q.refetch(); }} />}
          {!pendingApproval && <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t('role')} value={u.role} disabled={self || locked}onChange={(e) => run(() => patch(`/api/users/${id}`, { role: e.target.value, version: u.version }), t('saved'))} options={ROLES.filter((r) => r !== 'principal' || me?.role === 'principal').map((r) => ({ value: r, label: t(r) }))} />
            <Select label={t('status')} value={u.status} disabled={self || locked}onChange={(e) => run(() => patch(`/api/users/${id}`, { status: e.target.value, version: u.version }), t('saved'))} options={['active', 'inactive', 'suspended'].map((s) => ({ value: s, label: t(s as TKey) }))} />
          </div>}
          <div><p className="label">{t('assignedClassrooms')}</p>
            {u.assignments.length === 0 ? <p className="text-sm text-ink-soft">—</p> : <ul className="space-y-1 text-sm">{u.assignments.map((a) => <li key={a._id} className="flex justify-between"><span>{a.classroomName}{a.isHomeroom ? ' ★' : ''}</span><span className="text-xs text-ink-faint">{f.date(a.startedAt)} → {a.endedAt ? f.date(a.endedAt) : t('active')}</span></li>)}</ul>}
          </div>
        </div>
      )}
      {tab === 'permissions' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">Role permissions are shown checked. Tick to grant an extra permission; untick to revoke one for this user only.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSIONS.map((p) => {
              const effective = u.effectivePermissions.includes(p);
              // The server refuses grants beyond the editor's own permissions (and any self-edit).
              const cannotGrant = !effective && !me?.permissions.includes(p);
              return <Checkbox key={p} label={<span className="font-mono text-xs">{p}</span>} checked={effective} disabled={self || locked || cannotGrant} onChange={(on) => {
                const extra = on ? toggle(u.extraPermissions.filter((x) => x !== p), p) : u.extraPermissions.filter((x) => x !== p);
                const revoked = on ? u.revokedPermissions.filter((x) => x !== p) : [...new Set([...u.revokedPermissions, p])];
                run(() => patch(`/api/users/${id}`, { extraPermissions: extra, revokedPermissions: revoked, version: u.version }));
              }} />;
            })}
          </div>
        </div>
      )}
      {tab === 'security' && (
        <div className="space-y-5">
          {!locked && <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={act.isPending} onClick={() => issue('link')}><KeyRound className="h-4 w-4" />{t('issueResetLink')}</Button>
            <Button variant="secondary" loading={act.isPending} onClick={() => issue('temporary')}><KeyRound className="h-4 w-4" />{t('temporaryPassword')}</Button>
            {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Button variant="secondary" onClick={() => run(() => post(`/api/users/${id}/unlock`), t('saved'))}><Lock className="h-4 w-4" />{t('unlock')}</Button>}
            <Button variant="secondary" onClick={() => run(() => post(`/api/users/${id}/revoke-sessions`), t('saved'))}><LogOut className="h-4 w-4" />{t('revokeSessions')}</Button>
          </div>}
          {sessions.data && <div><p className="label">{t('activeSessions')} ({sessions.data.data.length})</p><ul className="space-y-1 text-xs text-ink-soft">{sessions.data.data.map((s) => <li key={s._id} className="num">{s.ip} · {s.userAgent?.slice(0, 70)} · {f.dateTime(s.lastSeenAt)}</li>)}</ul></div>}
          {history.data && <div><p className="label">{t('loginHistory')}</p><div className="max-h-60 overflow-y-auto"><Table><tbody>{history.data.data.map((h) => <tr key={h._id}><td className="text-xs">{f.dateTime(h.at)}</td><td><Badge color={h.success ? 'green' : 'red'}>{h.success ? 'OK' : h.reason}</Badge></td><td className="num text-xs">{h.ip}</td></tr>)}</tbody></Table></div></div>}
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [status, setStatus] = useState('');
  const list = usePaged<UserRow>(`/api/users${qs({ page, pageSize: 25, q, role, status })}`);
  const pendingCount = usePaged<UserRow>(`/api/users${qs({ page: 1, pageSize: 1, status: 'pending' })}`).data?.meta.total ?? 0;
  const [creating, setCreating] = useState(false); const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t('navUsers')} actions={can('users.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t('addUser')}</Button>} />
      <Card padded={false}>
        {pendingCount > 0 && status !== 'pending' && (
          <div className="border-b border-surface-line p-4"><Alert kind="warning">
            <button type="button" className="font-medium underline" onClick={() => { setStatus('pending'); setRole(''); setPage(1); }}>{t('pendingApproval')}: {pendingCount}</button>
          </Alert></div>
        )}
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-4">
          <Input className="sm:col-span-2" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} placeholder={`${t('role')}: ${t('all')}`} options={[...ROLES, 'parent', 'student', 'unassigned'].map((r) => ({ value: r, label: t(r as TKey) }))} />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder={`${t('status')}: ${t('all')}`} options={['active', 'pending', 'inactive', 'suspended'].map((s) => ({ value: s, label: t(s === 'pending' ? 'pendingApproval' : s as TKey) }))} />
        </div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState /> : (
          <>
            <Table>
              <thead><tr><th>{t('fullName')}</th><th>{t('username')}</th><th>{t('role')}</th><th>{t('status')}</th><th>{t('lastLogin')}</th><th /></tr></thead>
              <tbody>{list.data.items.map((u) => (
                <tr key={u._id}><td className="font-medium">{u.fullName}</td><td className="font-mono text-xs">{u.username}</td><td>{t(u.role as TKey)}</td>
                  <td><Badge color={STATUS_TONE[u.status]}>{t(u.status === 'pending' ? 'pendingApproval' : u.status as TKey)}</Badge>{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge color="red"><Lock className="h-3 w-3" /></Badge>}</td>
                  <td className="text-xs">{f.dateTime(u.lastLoginAt)}</td><td className="text-end"><Button variant="ghost" onClick={() => setOpen(u._id)}>{t('edit')}</Button></td></tr>
              ))}</tbody>
            </Table>
            <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title={t('addUser')} wide><CreateUser onCancel={() => setCreating(false)} onDone={() => setCreating(false)} /></Modal>
      {open && <UserPanel id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
