import { useState } from 'react';
import { useGet } from '../hooks/useApi';
import { patch, post } from '../services/api';
import { useAuth } from '../store/auth';
import { useT } from '../i18n';
import { Alert, Badge, Button, Card, Input, Modal, errorMessage } from '../components/ui';
import { useL } from '../timetable/common';

/** Student portal account (sign-in to see the class timetable). Created from the student record, like a parent account from a guardian. */
export function StudentPortalAccount({ studentId, fullName, admissionNumber }: { studentId: string; fullName: string; admissionNumber: string }) {
  const t = useT(); const L = useL();
  const can = useAuth((s) => s.can);
  const q = useGet<{ username: string; status: string; lastLoginAt?: string } | null>(`/api/students/${studentId}/portal-account`);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ username: '', password: '' });
  const [created, setCreated] = useState<{ username: string; temporaryPassword?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const manage = can('students.manage') && can('users.manage');
  const acc = q.data?.data ?? null;
  const create = async () => {
    setBusy(true); setErr(null);
    try { setCreated(await post<{ username: string; temporaryPassword?: string }>(`/api/students/${studentId}/portal-account`, { username: v.username, ...(v.password ? { password: v.password } : {}) })); void q.refetch(); }
    catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } finally { setBusy(false); }
  };
  const setStatus = async (status: string) => { setErr(null); try { await patch(`/api/students/${studentId}/portal-account`, { status }); void q.refetch(); } catch (e) { setErr(errorMessage(e, t('errorGeneric'))); } };
  return (
    <Card title={L('Student portal', 'طلبہ پورٹل')}>
      <p className="mb-3 text-sm text-ink-soft">{L('Lets the student sign in to see their own class timetable.', 'طالب علم اپنی کلاس کا ٹائم ٹیبل دیکھنے کے لیے سائن ان کر سکتا ہے۔')}</p>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {q.isLoading ? null : acc ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={acc.status === 'active' ? 'green' : 'gray'}>{acc.username}</Badge>
          <span className="text-xs text-ink-faint">{acc.status}{acc.lastLoginAt ? ` · ${L('last sign-in', 'آخری سائن ان')} ${new Date(acc.lastLoginAt).toLocaleDateString()}` : ''}</span>
          {manage && <Button variant="ghost" onClick={() => void setStatus(acc.status === 'active' ? 'suspended' : 'active')}>{acc.status === 'active' ? t('suspend') : t('activate')}</Button>}
        </div>
      ) : manage ? <Button variant="secondary" onClick={() => { setOpen(true); setCreated(null); setErr(null); setV({ username: admissionNumber.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40).padEnd(3, '0'), password: '' }); }}>{t('createPortalAccount')}</Button>
        : <span className="text-sm text-ink-faint">{t('noPortalAccount')}</span>}
      <Modal open={open} onClose={() => setOpen(false)} title={`${t('createPortalAccount')} · ${fullName}`}>
        {created ? (
          <div className="space-y-3 text-sm">
            <Alert kind="success">{L('Account created. Give these sign-in details to the student (shown once):', 'اکاؤنٹ بن گیا۔ یہ تفصیلات طالب علم کو دیں (صرف ایک بار دکھائی جائیں گی):')}</Alert>
            <p>{t('username')}: <code className="rounded bg-surface-muted px-2 py-1">{created.username}</code></p>
            {created.temporaryPassword && <p>{t('password')}: <code className="rounded bg-surface-muted px-2 py-1">{created.temporaryPassword}</code></p>}
            <p className="text-ink-soft">{window.location.origin}/student/login</p>
            <Button onClick={() => setOpen(false)}>{t('close')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {err && <Alert kind="error">{err}</Alert>}
            <Input label={t('username')} value={v.username} autoComplete="off" onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} hint="3-40: a-z 0-9 . _ -" />
            <Input label={t('passwordOptional')} type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel')}</Button><Button loading={busy} disabled={!/^[a-z0-9._-]{3,40}$/.test(v.username)} onClick={() => void create()}>{t('create')}</Button></div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
