import { useEffect, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useGet, useAction } from '../hooks/useApi';
import { useT, useFormat, type TKey } from '../i18n';
import { useAuth } from '../store/auth';
import { del, get, patch, post, upload } from '../services/api';
import { applyBranding } from '../services/session';
import type { PublicConfig } from '@sms/shared';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, PageHeader, Select, Spinner, Table, Tabs, Textarea, errorMessage } from '../components/ui';
import { useSessions } from './shared';

interface SettingsData {
  version: number; name: string; shortName?: string; description?: string; address?: string; phone?: string; email?: string; logoPath?: string; faviconPath?: string;
  primaryColor: string; accentColor: string; reportHeader?: string; reportFooter?: string; academicIdentity?: string; defaultLanguage: string; timeZone: string; dateFormat: string; defaultCountryCode: string;
  policy: { workingDays: number[]; cutoffTime: string | null; lateThresholdTime: string | null; allowBackdatedDays: number; lateCountsAsPresent: boolean; excludeLeaveFromTotal: boolean; maxLeaveDaysPerTerm: number | null };
  studentCustomFields: { key: string; label: string }[];
  package: string; mode: string; nodeId: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Europe/London', 'UTC'];

async function refreshBranding() { const c = await get<PublicConfig>('/api/public/config'); useAuth.getState().setConfig(c); applyBranding(c); }

function Profile({ s }: { s: SettingsData }) {
  const t = useT();
  const can = useAuth((x) => x.can('settings.manage'));
  const [v, setV] = useState(s);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => setV(s), [s]);
  const save = useAction(() => patch('/api/settings/profile', {
    version: v.version, name: v.name, shortName: v.shortName || null, description: v.description || null, address: v.address || null, phone: v.phone || null, email: v.email || '',
    primaryColor: v.primaryColor, accentColor: v.accentColor, reportHeader: v.reportHeader || null, reportFooter: v.reportFooter || null, academicIdentity: v.academicIdentity || null,
    defaultLanguage: v.defaultLanguage, timeZone: v.timeZone, dateFormat: v.dateFormat, defaultCountryCode: v.defaultCountryCode
  }), ['/api/settings']);
  const up = useAction(({ kind, file }: { kind: 'logo' | 'favicon'; file: File }) => upload(`/api/settings/branding/${kind}`, file), ['/api/settings']);
  const F = (k: keyof SettingsData, label: TKey, p: Record<string, unknown> = {}) => <Input label={t(label)} value={String(v[k] ?? '')} onChange={(e) => setV({ ...v, [k]: e.target.value })} disabled={!can} {...p} />;
  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title={t('schoolProfile')}>
        <div className="grid gap-4 md:grid-cols-2">
          {F('name', 'schoolName')}{F('shortName', 'shortName')}{F('phone', 'phone')}{F('email', 'email', { type: 'email' })}
          <Textarea className="md:col-span-2" label={t('address')} value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.target.value })} disabled={!can} />
          <Textarea className="md:col-span-2" label={t('description')} value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} disabled={!can} />
          {F('academicIdentity', 'academicIdentity')}
          <Select label={t('timeZone')} value={v.timeZone} onChange={(e) => setV({ ...v, timeZone: e.target.value })} disabled={!can} options={[...new Set([v.timeZone, ...ZONES])].map((z) => ({ value: z, label: z }))} />
          <Select label={t('dateFormat')} value={v.dateFormat} onChange={(e) => setV({ ...v, dateFormat: e.target.value })} disabled={!can} options={['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((d) => ({ value: d, label: d }))} />
          <Select label={t('defaultLanguage')} value={v.defaultLanguage} onChange={(e) => setV({ ...v, defaultLanguage: e.target.value })} disabled={!can} options={[{ value: 'en', label: 'English' }, { value: 'ur', label: 'اردو' }]} />
          {F('defaultCountryCode', 'countryCode')}
        </div>
      </Card>
      <Card title={t('branding')}>
        <div className="grid gap-6 md:grid-cols-2">
          {(['logo', 'favicon'] as const).map((k) => (
            <div key={k} className="flex items-center gap-4">
              {s[k === 'logo' ? 'logoPath' : 'faviconPath'] ? <img src={s[k === 'logo' ? 'logoPath' : 'faviconPath']} alt="" className="h-16 w-16 rounded-xl border border-surface-line object-contain p-1" /> : <div className="h-16 w-16 rounded-xl border border-dashed border-surface-line" />}
              {can && <label className="btn-secondary cursor-pointer"><Upload className="h-4 w-4" />{t(k)}<input type="file" className="hidden" accept={k === 'logo' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/x-icon'} onChange={(e) => { const file = e.target.files?.[0]; if (file) up.mutate({ kind: k, file }, { onSuccess: () => void refreshBranding(), onError: (x) => setMsg({ kind: 'error', text: errorMessage(x, t('errorGeneric')) }) }); }} /></label>}
            </div>
          ))}
          <div className="flex items-end gap-3"><Input type="color" label={t('primaryColor')} value={v.primaryColor} onChange={(e) => setV({ ...v, primaryColor: e.target.value })} className="w-32" disabled={!can} /><Input type="color" label={t('accentColor')} value={v.accentColor} onChange={(e) => setV({ ...v, accentColor: e.target.value })} className="w-32" disabled={!can} /></div>
          <div />
          {F('reportHeader', 'reportHeader')}{F('reportFooter', 'reportFooter')}
        </div>
      </Card>
      {can && <Button loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { setMsg({ kind: 'success', text: t('saved') }); void refreshBranding(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) })}>{t('save')}</Button>}
    </div>
  );
}

function Academic({ s }: { s: SettingsData }) {
  const t = useT(); const f = useFormat();
  const can = useAuth((x) => x.can('academic.manage'));
  const sessions = useSessions();
  const year = new Date().getFullYear();
  const holidays = useGet<{ _id: string; date: string; endDate?: string; name: string }[]>(`/api/academic/holidays?year=${year}`);
  const [policy, setPolicy] = useState(s.policy);
  const [ns, setNs] = useState({ name: '', startDate: '', endDate: '' });
  const [nh, setNh] = useState({ date: '', endDate: '', name: '' });
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const act = useAction(async (fn: () => Promise<unknown>) => fn(), ['/api/academic', '/api/settings']);
  const run = (fn: () => Promise<unknown>, after?: () => void) => act.mutate(fn, { onSuccess: () => { setMsg({ kind: 'success', text: t('saved') }); after?.(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  return (
    <div className="space-y-6">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <Card title={t('attendancePolicy')}>
        <div className="space-y-4">
          <div><p className="label">{t('workingDays')}</p><div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} label={d} disabled={!can} checked={policy.workingDays.includes(i)} onChange={(on) => setPolicy({ ...policy, workingDays: on ? [...policy.workingDays, i].sort() : policy.workingDays.filter((x) => x !== i) })} />)}</div></div>
          <div className="grid gap-4 md:grid-cols-4">
            <Input type="time" label={t('cutoffTime')} value={policy.cutoffTime ?? ''} disabled={!can} onChange={(e) => setPolicy({ ...policy, cutoffTime: e.target.value || null })} />
            <Input type="time" label={t('lateThreshold')} value={policy.lateThresholdTime ?? ''} disabled={!can} onChange={(e) => setPolicy({ ...policy, lateThresholdTime: e.target.value || null })} />
            <Input type="number" min={0} max={31} label={t('backdatedDays')} value={policy.allowBackdatedDays} disabled={!can} onChange={(e) => setPolicy({ ...policy, allowBackdatedDays: Number(e.target.value) })} />
            <Input type="number" min={0} label={t('maxLeave')} value={policy.maxLeaveDaysPerTerm ?? ''} disabled={!can} onChange={(e) => setPolicy({ ...policy, maxLeaveDaysPerTerm: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <div className="flex flex-wrap gap-6"><Checkbox label={t('lateCountsPresent')} disabled={!can} checked={policy.lateCountsAsPresent} onChange={(x) => setPolicy({ ...policy, lateCountsAsPresent: x })} /><Checkbox label={t('excludeLeave')} disabled={!can} checked={policy.excludeLeaveFromTotal} onChange={(x) => setPolicy({ ...policy, excludeLeaveFromTotal: x })} /></div>
          {can && <Button loading={act.isPending} onClick={() => run(() => patch('/api/settings/attendance-policy', policy))}>{t('save')}</Button>}
        </div>
      </Card>
      <Card title={t('sessions')} padded={false}>
        <Table><thead><tr><th>{t('name')}</th><th>{t('startDate')}</th><th>{t('endDate')}</th><th /></tr></thead>
          <tbody>{(sessions.data?.data ?? []).map((x) => <tr key={x._id}><td className="font-medium">{x.name} {x.isDefault && <Badge color="green">{t('default')}</Badge>}</td><td className="num">{f.date(x.startDate)}</td><td className="num">{f.date(x.endDate)}</td><td className="text-end">{can && !x.isDefault && <Button variant="ghost" onClick={() => run(() => patch(`/api/academic/sessions/${x._id}`, { isDefault: true }))}>{t('makeDefault')}</Button>}</td></tr>)}</tbody></Table>
        {can && <div className="grid gap-3 border-t border-surface-line p-4 sm:grid-cols-4"><Input placeholder="2026-2027" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /><Input type="date" value={ns.startDate} onChange={(e) => setNs({ ...ns, startDate: e.target.value })} aria-label={t('startDate')} /><Input type="date" value={ns.endDate} onChange={(e) => setNs({ ...ns, endDate: e.target.value })} aria-label={t('endDate')} /><Button disabled={!ns.name || !ns.startDate || !ns.endDate} onClick={() => run(() => post('/api/academic/sessions', { ...ns, isDefault: false }), () => setNs({ name: '', startDate: '', endDate: '' }))}><Plus className="h-4 w-4" />{t('addSession')}</Button></div>}
      </Card>
      <Card title={`${t('holidays')} ${year}`} padded={false}>
        {!holidays.data?.data.length ? <EmptyState /> : <Table><tbody>{holidays.data.data.map((h) => <tr key={h._id}><td className="num">{f.date(h.date)}{h.endDate ? ` – ${f.date(h.endDate)}` : ''}</td><td>{h.name}</td><td className="text-end">{can && <Button variant="ghost" onClick={() => run(() => del(`/api/academic/holidays/${h._id}`))}><Trash2 className="h-4 w-4" /></Button>}</td></tr>)}</tbody></Table>}
        {can && <div className="grid gap-3 border-t border-surface-line p-4 sm:grid-cols-4"><Input type="date" value={nh.date} onChange={(e) => setNh({ ...nh, date: e.target.value })} aria-label={t('startDate')} /><Input type="date" value={nh.endDate} onChange={(e) => setNh({ ...nh, endDate: e.target.value })} aria-label={t('endDate')} /><Input placeholder={t('name')} value={nh.name} onChange={(e) => setNh({ ...nh, name: e.target.value })} /><Button disabled={!nh.date || !nh.name} onClick={() => run(() => post('/api/academic/holidays', { ...nh, endDate: nh.endDate || null }), () => setNh({ date: '', endDate: '', name: '' }))}><Plus className="h-4 w-4" />{t('addHoliday')}</Button></div>}
      </Card>
    </div>
  );
}

const FIELD_KEY = /^[a-z][a-zA-Z0-9_]{1,30}$/;

function CustomFields({ s }: { s: SettingsData }) {
  const t = useT();
  const can = useAuth((x) => x.can('settings.manage'));
  const [fields, setFields] = useState(s.studentCustomFields ?? []);
  const [nf, setNf] = useState({ key: '', label: '' });
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const save = useAction((next: { key: string; label: string }[]) => patch('/api/settings/student-fields', { fields: next }), ['/api/settings']);
  const persist = (next: { key: string; label: string }[], after?: () => void) => save.mutate(next, { onSuccess: () => { setFields(next); setMsg({ kind: 'success', text: t('saved') }); after?.(); }, onError: (e) => setMsg({ kind: 'error', text: errorMessage(e, t('errorGeneric')) }) });
  const keyError = nf.key && !FIELD_KEY.test(nf.key) ? t('fieldKey') : nf.key && fields.some((f) => f.key === nf.key) ? 'Key already used' : undefined;
  return (
    <Card title={t('customFields')}>
      <p className="mb-4 text-sm text-ink-soft">{t('customFieldsHelp')}</p>
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {!fields.length ? <EmptyState /> : (
        <Table><thead><tr><th>{t('fieldLabel')}</th><th>{t('fieldKey')}</th><th /></tr></thead>
          <tbody>{fields.map((f) => <tr key={f.key}><td className="font-medium">{f.label}</td><td className="font-mono text-xs">{f.key}</td><td className="text-end">{can && <Button variant="ghost" onClick={() => persist(fields.filter((x) => x.key !== f.key))}><Trash2 className="h-4 w-4" />{t('removeField')}</Button>}</td></tr>)}</tbody></Table>
      )}
      {can && fields.length < 20 && <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder={t('fieldLabel')} aria-label={t('fieldLabel')} value={nf.label} onChange={(e) => setNf({ label: e.target.value, key: nf.key || '' })} />
        <Input placeholder="bloodGroup" aria-label={t('fieldKey')} value={nf.key} onChange={(e) => setNf({ ...nf, key: e.target.value.trim() })} error={keyError} />
        <Button disabled={!nf.label.trim() || !nf.key || Boolean(keyError)} loading={save.isPending} onClick={() => persist([...fields, { key: nf.key, label: nf.label.trim() }], () => setNf({ key: '', label: '' }))}><Plus className="h-4 w-4" />{t('addField')}</Button>
      </div>}
    </Card>
  );
}

function Deployment({ s }: { s: SettingsData }) {
  const t = useT();
  return (
    <Card title={t('readOnlyDeployment')}>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-ink-faint">{t('package')}</dt><dd className="mt-1"><Badge color={s.package === 'standard' ? 'violet' : 'gray'}>{s.package}</Badge></dd></div>
        <div><dt className="text-ink-faint">{t('mode')}</dt><dd className="mt-1"><Badge>{s.mode}</Badge></dd></div>
        <div><dt className="text-ink-faint">Node</dt><dd className="mt-1 font-mono text-xs">{s.nodeId}</dd></div>
      </dl>
      <p className="mt-4 text-sm text-ink-soft">Database connection details and server secrets are managed in the server's environment file and are never shown here.</p>
    </Card>
  );
}

export default function SettingsPage() {
  const t = useT();
  const q = useGet<SettingsData>('/api/settings');
  const [tab, setTab] = useState<'profile' | 'academic' | 'deployment'>('profile');
  if (!q.data) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('navSettings')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: t('schoolProfile') }, { value: 'academic', label: t('academicSettings') }, { value: 'deployment', label: t('package') }]} />
      {tab === 'profile' && <Profile s={q.data.data} />}{tab === 'academic' && <div className="space-y-6"><Academic s={q.data.data} /><CustomFields s={q.data.data} /></div>}{tab === 'deployment' && <Deployment s={q.data.data} />}
    </div>
  );
}
