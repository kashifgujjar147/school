import { useState } from 'react';
import { Plus, KeyRound, Lock, LogOut } from 'lucide-react';
import { PERMISSIONS, ROLES, type Permission } from '@sms/shared';
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
  const inv = ['/api/users'];
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), inv);
  const run = (fn: () => Promise<unknown>, ok?: string) => act.mutate(fn, { onSuccess: () => { setMsg(ok ? { kind: 'success', text: ok } : null); void q.refetch(); void sessions.refetch(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  if (!q.data) return <Spinner />;
  const u = q.data.data;
  const self = u._id === me?.id;
  const toggle = (list: Permission[], p: Permission) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

  return (
    <Modal open onClose={onClose} title={`${u.fullName} (${u.username})`} wide>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {secret && <div className="mb-4"><Alert kind="warning" title={t('shownOnce')}><code className="select-all break-all rounded bg-white px-2 py-1 font-mono text-sm">{secret}</code></Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: t('fullName') }, { value: 'permissions', label: t('permissions') }, { value: 'security', label: t('navSecurity') }]} />
      {tab === 'profile' && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label={t('role')} value={u.role} disabled={self} onChange={(e) => run(() => patch(`/api/users/${id}`, { role: e.target.value, version: u.version }), t('saved'))} options={ROLES.filter((r) => r !== 'principal' || me?.role === 'principal').map((r) => ({ value: r, label: t(r) }))} />
            <Select label={t('status')} value={u.status} disabled={self} onChange={(e) => run(() => patch(`/api/users/${id}`, { status: e.target.value, version: u.version }), t('saved'))} options={['active', 'inactive', 'suspended'].map((s) => ({ value: s, label: t(s as TKey) }))} />
          </div>
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
              return <Checkbox key={p} label={<span className="font-mono text-xs">{p}</span>} checked={effective} disabled={self} onChange={(on) => {
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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => act.mutate(() => post<{ resetUrl: string }>(`/api/users/${id}/reset-password`, { mode: 'link' }), { onSuccess: (r) => setSecret((r as { resetUrl: string }).resetUrl) })}><KeyRound className="h-4 w-4" />{t('issueResetLink')}</Button>
            <Button variant="secondary" onClick={() => act.mutate(() => post<{ temporaryPassword: string }>(`/api/users/${id}/reset-password`, { mode: 'temporary' }), { onSuccess: (r) => setSecret((r as { temporaryPassword: string }).temporaryPassword) })}><KeyRound className="h-4 w-4" />{t('temporaryPassword')}</Button>
            {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Button variant="secondary" onClick={() => run(() => post(`/api/users/${id}/unlock`), t('saved'))}><Lock className="h-4 w-4" />{t('unlock')}</Button>}
            <Button variant="secondary" onClick={() => run(() => post(`/api/users/${id}/revoke-sessions`), t('saved'))}><LogOut className="h-4 w-4" />{t('revokeSessions')}</Button>
          </div>
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
  const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [role, setRole] = useState('');
  const list = usePaged<UserRow>(`/api/users${qs({ page, pageSize: 25, q, role })}`);
  const [creating, setCreating] = useState(false); const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title={t('navUsers')} actions={can('users.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{t('addUser')}</Button>} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-surface-line p-4 sm:grid-cols-3">
          <Input className="sm:col-span-2" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} placeholder={`${t('role')}: ${t('all')}`} options={ROLES.map((r) => ({ value: r, label: t(r) }))} />
        </div>
        {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState /> : (
          <>
            <Table>
              <thead><tr><th>{t('fullName')}</th><th>{t('username')}</th><th>{t('role')}</th><th>{t('status')}</th><th>{t('lastLogin')}</th><th /></tr></thead>
              <tbody>{list.data.items.map((u) => (
                <tr key={u._id}><td className="font-medium">{u.fullName}</td><td className="font-mono text-xs">{u.username}</td><td>{t(u.role as TKey)}</td>
                  <td><Badge color={STATUS_TONE[u.status]}>{t(u.status as TKey)}</Badge>{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge color="red"><Lock className="h-3 w-3" /></Badge>}</td>
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
