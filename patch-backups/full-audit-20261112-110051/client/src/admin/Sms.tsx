import { useEffect, useState } from 'react';
import { Send, RefreshCw } from 'lucide-react';
import { NOTIFICATION_EVENTS, SMS_JOB_STATUSES, TEMPLATE_VARIABLES, renderTemplate, smsSegments, type NotificationEvent } from '@sms/shared';
import { useGet, usePaged, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { del, patch, post, put, qs } from '../services/api';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Modal, PageHeader, Pagination, Select, Spinner, STATUS_TONE, Table, Tabs, Textarea, errorMessage } from '../components/ui';

interface Job { _id: string; date: string; studentName?: string; to: string; event: string; status: string; attempts: number; body: string; lastError?: string; sentAt?: string; deliveredAt?: string; createdAt: string; segments?: number }
interface Provider { provider: string; source: string; problems: string[]; configured: boolean; twilio: { accountSidSet: boolean; authTokenSet: boolean; from: string } | null; http: { url: string; method: string; from: string; idPath: string } | null; webhookTokenSet: boolean; receiptUrl: string }

function Queue() {
  const t = useT(); const f = useFormat();
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1); const [status, setStatus] = useState('');
  const list = usePaged<Job>(`/api/sms/jobs${qs({ page, pageSize: 25, status })}`);
  const [logs, setLogs] = useState<string | null>(null);
  const logQ = useGet<{ _id: string; type: string; detail?: string; at: string }[]>(logs ? `/api/sms/jobs/${logs}/logs` : null);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/sms']);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card padded={false} title={t('queue')} actions={<>
      <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder={`${t('status')}: ${t('all')}`} options={SMS_JOB_STATUSES.map((s) => ({ value: s, label: t(s as TKey) }))} />
      {can('sms.manage') && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate(() => post<{ processed: number; sent: number; failed: number; offline: boolean; blocked: number }>('/api/sms/process-now'), { onSuccess: (r) => { const x = r as { processed: number; sent: number; offline: boolean; blocked: number }; setMsg(`processed ${x.processed}, sent ${x.sent}${x.offline ? ' — provider unreachable (offline)' : ''}${x.blocked ? ` — ${x.blocked} blocked by configuration` : ''}`); } })}><RefreshCw className="h-4 w-4" />{t('processNow')}</Button>}
    </>}>
      {msg && <div className="px-5 pt-4"><Alert kind="info">{msg}</Alert></div>}
      {list.isLoading ? <Spinner /> : !list.data?.items.length ? <EmptyState /> : (
        <>
          <Table>
            <thead><tr><th>{t('date')}</th><th>{t('students')}</th><th>{t('phone')}</th><th>{t('events')}</th><th>{t('status')}</th><th>{t('attempts')}</th><th /></tr></thead>
            <tbody>{list.data.items.map((j) => (
              <tr key={j._id}>
                <td className="num text-xs">{f.date(j.date)}</td><td>{j.studentName}</td><td className="num text-xs">{j.to}</td><td>{t(j.event as TKey)}</td>
                <td><Badge color={STATUS_TONE[j.status]}>{t(j.status as TKey)}</Badge>{j.lastError && <p className="mt-1 max-w-xs truncate text-xs text-red-700" title={j.lastError}>{j.lastError}</p>}</td>
                <td className="num">{j.attempts}</td>
                <td className="whitespace-nowrap text-end">
                  <Button variant="ghost" onClick={() => setLogs(j._id)}>Log</Button>
                  {can('sms.manage') && ['failed', 'dead', 'undelivered', 'blocked_config'].includes(j.status) && <Button variant="ghost" onClick={() => act.mutate(() => post(`/api/sms/jobs/${j._id}/retry`))}>{t('retry')}</Button>}
                  {can('sms.manage') && ['pending', 'failed', 'blocked_config'].includes(j.status) && <Button variant="ghost" onClick={() => act.mutate(() => post(`/api/sms/jobs/${j._id}/cancel`))}>{t('cancel')}</Button>}
                </td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={page} pageSize={25} total={list.data.meta.total} onPage={setPage} />
        </>
      )}
      <Modal open={Boolean(logs)} onClose={() => setLogs(null)} title="Delivery log">
        {!logQ.data ? <Spinner /> : <ul className="space-y-2 text-sm">{logQ.data.data.map((l) => <li key={l._id}><Badge>{l.type}</Badge> <span className="text-xs text-ink-faint">{f.dateTime(l.at)}</span> {l.detail}</li>)}</ul>}
      </Modal>
    </Card>
  );
}

function Templates() {
  const t = useT();
  const config = useAuth((s) => s.config);
  const q = useGet<{ saved: { event: string; language: string; body: string; active: boolean }[]; defaults: Record<string, { en: string; ur: string }> }>('/api/sms/templates');
  const [edit, setEdit] = useState<{ event: NotificationEvent; language: 'en' | 'ur'; body: string; active: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = useAction(() => put('/api/sms/templates', edit), ['/api/sms/templates']);
  if (!q.data) return <Spinner />;
  const get = (event: NotificationEvent, language: 'en' | 'ur') => q.data!.data.saved.find((s) => s.event === event && s.language === language) ?? { event, language, body: q.data!.data.defaults[event]![language], active: true };
  const sample = { studentName: 'Ali Raza', schoolName: config?.schoolName ?? 'School', status: 'absent', date: '2026-11-11', className: '5-A', guardianName: 'Mr. Raza' };
  return (
    <Card title={t('templates')}>
      <p className="mb-4 text-sm text-ink-soft">{t('placeholders')}: {TEMPLATE_VARIABLES.map((v) => <code key={v} className="mx-1 rounded bg-surface-muted px-1.5 py-0.5 text-xs">{`{{${v}}}`}</code>)}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {NOTIFICATION_EVENTS.flatMap((ev) => (['en', 'ur'] as const).map((lang) => {
          const tpl = get(ev, lang);
          return (
            <div key={ev + lang} className="rounded-xl border border-surface-line p-4">
              <div className="mb-2 flex items-center justify-between"><p className="font-medium">{t(ev)} · {lang === 'en' ? 'English' : 'اردو'}</p><Button variant="ghost" onClick={() => setEdit({ ...tpl, event: ev, language: lang } as never)}>{t('edit')}</Button></div>
              <p className="text-sm text-ink-soft" dir={lang === 'ur' ? 'rtl' : 'ltr'}>{renderTemplate(tpl.body, sample)}</p>
              {!tpl.active && <Badge>{t('inactive')}</Badge>}
            </div>
          );
        }))}
      </div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `${t(edit.event)} · ${edit.language}` : ''} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t('cancel')}</Button><Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setEdit(null), onError: (e) => setErr(errorMessage(e, t('errorGeneric'))) })}>{t('save')}</Button></>}>
        {edit && <div className="space-y-3">
          {err && <Alert kind="error">{err}</Alert>}
          <Textarea dir={edit.language === 'ur' ? 'rtl' : 'ltr'} rows={4} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} maxLength={600} />
          <p className="text-xs text-ink-faint">{(() => { const s = smsSegments(renderTemplate(edit.body, sample)); return `${s.encoding} · ${s.segments} segment(s)`; })()}</p>
          <Checkbox label={t('active')} checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />
          <p className="rounded-lg bg-surface-muted p-3 text-sm" dir={edit.language === 'ur' ? 'rtl' : 'ltr'}>{renderTemplate(edit.body, sample)}</p>
        </div>}
      </Modal>
    </Card>
  );
}

function Automation() {
  const t = useT();
  const s = useGet<{ smsAutomation: { enabled: boolean; events: NotificationEvent[]; quietHoursStart: string | null; quietHoursEnd: string | null } }>('/api/settings');
  const [v, setV] = useState<{ enabled: boolean; events: NotificationEvent[]; quietHoursStart: string; quietHoursEnd: string } | null>(null);
  useEffect(() => { if (s.data && !v) { const a = s.data.data.smsAutomation; setV({ enabled: a.enabled, events: a.events, quietHoursStart: a.quietHoursStart ?? '', quietHoursEnd: a.quietHoursEnd ?? '' }); } }, [s.data, v]);
  const save = useAction(() => patch('/api/sms/automation', { ...v, quietHoursStart: v!.quietHoursStart || null, quietHoursEnd: v!.quietHoursEnd || null }), ['/api/settings']);
  if (!v) return <Spinner />;
  return (
    <Card title={t('automation')}>
      <div className="space-y-4">
        <Checkbox label={t('automationEnabled')} checked={v.enabled} onChange={(x) => setV({ ...v, enabled: x })} />
        <div><p className="label">{t('events')}</p><div className="flex gap-4">{NOTIFICATION_EVENTS.map((e) => <Checkbox key={e} label={t(e)} checked={v.events.includes(e)} onChange={(on) => setV({ ...v, events: on ? [...v.events, e] : v.events.filter((x) => x !== e) })} />)}</div></div>
        <div className="grid max-w-md grid-cols-2 gap-4"><Input type="time" label={`${t('quietHours')} — ${t('from')}`} value={v.quietHoursStart} onChange={(e) => setV({ ...v, quietHoursStart: e.target.value })} /><Input type="time" label={t('to')} value={v.quietHoursEnd} onChange={(e) => setV({ ...v, quietHoursEnd: e.target.value })} /></div>
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>{save.isSuccess ? t('saved') : t('save')}</Button>
      </div>
    </Card>
  );
}

function ProviderSettings() {
  const t = useT();
  const q = useGet<Provider>('/api/sms/provider');
  const [kind, setKind] = useState<'none' | 'twilio' | 'http'>('none');
  const [tw, setTw] = useState({ accountSid: '', authToken: '', from: '' });
  const [hp, setHp] = useState({ url: '', method: 'POST', headers: '{"Content-Type":"application/json"}', bodyTemplate: '{"to":"{{to}}","message":"{{message}}","sender":"{{from}}"}', from: '', idPath: 'id', webhookToken: '' });
  const [testTo, setTestTo] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  useEffect(() => { if (q.data) setKind(q.data.data.provider as never); }, [q.data]);
  const save = useAction(async () => {
    let headers: Record<string, string> = {};
    if (kind === 'http') { try { headers = JSON.parse(hp.headers); } catch { throw new Error('Headers must be valid JSON'); } }
    const body = kind === 'none' ? { provider: 'none' } : kind === 'twilio' ? { provider: 'twilio', ...tw } : { provider: 'http', ...hp, headers };
    return put('/api/sms/provider', body);
  }, ['/api/sms/provider', '/api/system/health']);
  const test = useAction(() => post<{ accepted: boolean; error?: string; note?: string }>('/api/sms/test', { to: testTo }));
  const reset = useAction(() => del('/api/sms/provider'), ['/api/sms/provider']);
  if (!q.data) return <Spinner />;
  const p = q.data.data;
  return (
    <Card title={t('smsProvider')} actions={<Badge color={p.configured ? 'green' : 'amber'}>{p.configured ? t('providerConfigured') : t('providerNotConfigured')}</Badge>}>
      <div className="space-y-5">
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        {!p.configured && <Alert kind="warning">{p.problems.join(' · ')}</Alert>}
        <p className="text-sm text-ink-soft">Current: <strong>{p.provider}</strong> (from {p.source}). Delivery receipts URL: <code className="break-all text-xs">{p.receiptUrl}</code></p>
        <Alert kind="info">{t('secretsWriteOnly')}</Alert>
        <Select label={t('smsProvider')} value={kind} onChange={(e) => setKind(e.target.value as never)} options={[{ value: 'none', label: 'None' }, { value: 'twilio', label: 'Twilio' }, { value: 'http', label: 'HTTP gateway (local SMS providers)' }]} />
        {kind === 'twilio' && <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Account SID" value={tw.accountSid} onChange={(e) => setTw({ ...tw, accountSid: e.target.value })} placeholder={p.twilio?.accountSidSet ? '•••••• (set)' : 'AC…'} />
          <Input label="Auth token" type="password" value={tw.authToken} onChange={(e) => setTw({ ...tw, authToken: e.target.value })} placeholder={p.twilio?.authTokenSet ? '•••••• (set)' : ''} />
          <Input label="From number" value={tw.from} onChange={(e) => setTw({ ...tw, from: e.target.value })} placeholder={p.twilio?.from || '+1…'} />
        </div>}
        {kind === 'http' && <div className="grid gap-4 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Gateway URL" value={hp.url} onChange={(e) => setHp({ ...hp, url: e.target.value })} placeholder="https://api.gateway.example/send" />
          <Select label="Method" value={hp.method} onChange={(e) => setHp({ ...hp, method: e.target.value })} options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]} />
          <Input label="Sender ID" value={hp.from} onChange={(e) => setHp({ ...hp, from: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Headers (JSON — put API keys here)" value={hp.headers} onChange={(e) => setHp({ ...hp, headers: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Body template ({{to}} {{message}} {{from}})" value={hp.bodyTemplate} onChange={(e) => setHp({ ...hp, bodyTemplate: e.target.value })} />
          <Input label="Message-id path in response" value={hp.idPath} onChange={(e) => setHp({ ...hp, idPath: e.target.value })} />
          <Input label="Receipt webhook token (16+ chars)" value={hp.webhookToken} onChange={(e) => setHp({ ...hp, webhookToken: e.target.value })} />
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setMsg({ kind: 'success', text: t('saved') }), onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, (e as Error).message) }) })}>{t('save')}</Button>
          {p.source === 'dashboard' && <Button variant="secondary" onClick={() => reset.mutate(undefined)}>Use environment defaults</Button>}
        </div>
        <div className="border-t border-surface-line pt-4">
          <p className="label">{t('sendTest')}</p>
          <div className="flex max-w-md gap-2"><Input className="flex-1" placeholder="03001234567" value={testTo} onChange={(e) => setTestTo(e.target.value)} /><Button variant="secondary" disabled={!testTo} loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: (r) => setMsg(r.accepted ? { kind: 'success', text: r.note ?? 'Accepted' } : { kind: 'error', text: r.error ?? 'Failed' }), onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, 'Failed') }) })}><Send className="h-4 w-4" /></Button></div>
        </div>
      </div>
    </Card>
  );
}

export default function Sms() {
  const t = useT();
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'queue' | 'templates' | 'automation' | 'provider'>('queue');
  const tabs = [{ value: 'queue' as const, label: t('queue') }, { value: 'templates' as const, label: t('templates') }, ...(can('sms.manage') ? [{ value: 'automation' as const, label: t('automation') }, { value: 'provider' as const, label: t('smsProvider') }] : [])];
  return (
    <div>
      <PageHeader title={t('navSms')} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'queue' && <Queue />}{tab === 'templates' && <Templates />}{tab === 'automation' && <Automation />}{tab === 'provider' && <ProviderSettings />}
    </div>
  );
}
