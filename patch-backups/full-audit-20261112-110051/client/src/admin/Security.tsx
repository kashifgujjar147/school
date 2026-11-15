import { useState } from 'react';
import { useGet, usePaged, useAction } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { post, qs } from '../services/api';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Pagination, Spinner, StatCard, Table, Tabs } from '../components/ui';

interface Sec {
  failedLogins: { _id: string; username: string; reason: string; ip: string; at: string }[];
  recentLogins: { _id: string; username: string; ip: string; at: string }[];
  lockedAccounts: { _id: string; username: string; fullName: string; lockedUntil: string }[];
  resetRequests: { _id: string; username: string; userId: string; createdAt: string; ip: string }[];
  suspiciousIps: { _id: string; n: number; users: string[] }[];
  activeSessions: { _id: string; ip: string; userAgent: string; lastSeenAt: string; user?: { fullName: string; username: string; role: string } }[];
  config: { sessionTtlHours: number; idleMinutes: number; maxAttempts: number; lockMinutes: number; secureCookies: boolean };
}

function Audit() {
  const t = useT(); const f = useFormat();
  const [page, setPage] = useState(1); const [q, setQ] = useState('');
  const list = usePaged<{ _id: string; at: string; actorName?: string; action: string; entity?: string; entityId?: string; ip?: string; detail?: unknown }>(`/api/system/audit${qs({ page, pageSize: 50, q })}`);
  return (
    <Card padded={false} title={t('auditLog')} actions={<Input placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />}>
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState /> : (<>
        <Table><thead><tr><th>{t('date')}</th><th>User</th><th>{t('actions')}</th><th>Entity</th><th>IP</th></tr></thead>
          <tbody>{list.data.items.map((a) => <tr key={a._id}><td className="whitespace-nowrap text-xs">{f.dateTime(a.at)}</td><td>{a.actorName ?? 'system'}</td><td className="font-mono text-xs">{a.action}</td><td className="text-xs">{a.entity}{a.entityId ? ` · ${String(a.entityId).slice(0, 8)}` : ''}</td><td className="num text-xs">{a.ip}</td></tr>)}</tbody></Table>
        <Pagination page={page} pageSize={50} total={list.data.meta.total} onPage={setPage} />
      </>)}
    </Card>
  );
}

export default function Security() {
  const t = useT(); const f = useFormat();
  const q = useGet<Sec>('/api/system/security', { refetchInterval: 60_000 });
  const [tab, setTab] = useState<'overview' | 'audit'>('overview');
  const dismiss = useAction((id: string) => post(`/api/system/security/reset-requests/${id}/dismiss`), ['/api/system/security']);
  return (
    <div>
      <PageHeader title={t('navSecurity')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: t('navSecurity') }, { value: 'audit', label: t('auditLog') }]} />
      {tab === 'audit' ? <Audit /> : !q.data ? <Spinner /> : (() => { const d = q.data.data; return (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard label={t('failedLogins')} value={d.failedLogins.length} tone={d.failedLogins.length > 20 ? 'red' : 'gray'} />
            <StatCard label={t('lockedAccounts')} value={d.lockedAccounts.length} tone={d.lockedAccounts.length ? 'amber' : 'gray'} />
            <StatCard label={t('activeSessions')} value={d.activeSessions.length} tone="blue" />
            <StatCard label={t('resetRequests')} value={d.resetRequests.length} tone={d.resetRequests.length ? 'amber' : 'gray'} />
          </div>
          {d.suspiciousIps.length > 0 && <Card title={t('suspiciousActivity')}><ul className="space-y-1 text-sm">{d.suspiciousIps.map((s) => <li key={s._id}><Badge color="red">{s.n}</Badge> failed sign-ins in 24 h from <span className="num font-mono">{s._id}</span> ({s.users.join(', ')})</li>)}</ul></Card>}
          {d.resetRequests.length > 0 && <Card title={t('resetRequests')}><ul className="divide-y divide-surface-line text-sm">{d.resetRequests.map((r) => <li key={r._id} className="flex items-center justify-between py-2"><span><strong>{r.username}</strong> · {f.dateTime(r.createdAt)} · <span className="num">{r.ip}</span></span><span className="flex gap-2"><span className="text-xs text-ink-faint">Reset from Staff &amp; users</span><Button variant="ghost" onClick={() => dismiss.mutate(r._id)}>{t('dismiss')}</Button></span></li>)}</ul></Card>}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t('failedLogins')} padded={false}>{!d.failedLogins.length ? <EmptyState /> : <div className="max-h-80 overflow-y-auto"><Table><tbody>{d.failedLogins.map((l) => <tr key={l._id}><td className="text-xs">{f.dateTime(l.at)}</td><td>{l.username}</td><td><Badge color="red">{l.reason}</Badge></td><td className="num text-xs">{l.ip}</td></tr>)}</tbody></Table></div>}</Card>
            <Card title={t('activeSessions')} padded={false}>{!d.activeSessions.length ? <EmptyState /> : <div className="max-h-80 overflow-y-auto"><Table><tbody>{d.activeSessions.map((s) => <tr key={s._id}><td>{s.user?.fullName}<span className="block text-xs text-ink-faint">{s.user?.role}</span></td><td className="num text-xs">{s.ip}</td><td className="text-xs">{f.dateTime(s.lastSeenAt)}</td></tr>)}</tbody></Table></div>}</Card>
          </div>
          <Card title={t('securityConfig')}>
            <dl className="grid gap-4 text-sm sm:grid-cols-5">
              <div><dt className="text-ink-faint">Session lifetime</dt><dd className="num font-medium">{d.config.sessionTtlHours} h</dd></div>
              <div><dt className="text-ink-faint">Idle timeout</dt><dd className="num font-medium">{d.config.idleMinutes} min</dd></div>
              <div><dt className="text-ink-faint">Lock after</dt><dd className="num font-medium">{d.config.maxAttempts} failures</dd></div>
              <div><dt className="text-ink-faint">Lock duration</dt><dd className="num font-medium">{d.config.lockMinutes} min</dd></div>
              <div><dt className="text-ink-faint">Secure cookies (HTTPS)</dt><dd>{d.config.secureCookies ? <Badge color="green">{t('yes')}</Badge> : <Badge color="amber">{t('no')} — LAN/HTTP</Badge>}</dd></div>
            </dl>
          </Card>
        </div>
      ); })()}
    </div>
  );
}
