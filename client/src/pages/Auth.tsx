import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { passwordSchema } from '@sms/shared';
import { useAuth } from '../store/auth';
import { useT } from '../i18n';
import { post } from '../services/api';
import { signIn } from '../services/session';
import { Alert, Button, Card, Input, PageHeader, errorMessage } from '../components/ui';
import { LangSwitch } from '../components/Layout';

/**
 * Post-login redirect target from ?next=. Only same-site paths are honoured: "//host" and "/\host"
 * are protocol-relative URLs in browsers, so they (and anything not starting with one slash, or
 * containing control characters) fall back to the default page. Prevents open redirects after sign-in.
 */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

function AuthFrame({ children, title }: { children: React.ReactNode; title: string }) {
  const config = useAuth((s) => s.config);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-brand/10 via-surface-muted to-accent/10 px-4 py-10">
      <div className="absolute end-4 top-4"><LangSwitch /></div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {config?.logoUrl ? <img src={config.logoUrl} alt="" className="h-16 w-16 rounded-2xl object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white">{config?.schoolName?.[0] ?? 'S'}</div>}
          <div><h1 className="text-xl font-semibold">{config?.schoolName ?? 'School Management'}</h1><p className="text-sm text-ink-soft">{title}</p></div>
        </div>
        <div className="card p-6">{children}</div>
        {config?.websiteEnabled && <p className="mt-4 text-center text-sm"><Link to="/site" className="text-brand hover:underline">← {config.schoolName}</Link></p>}
      </div>
    </div>
  );
}

/** Where each kind of account lands after signing in. */
export function homeFor(role?: string) {
  return role === 'parent' ? '/parent' : role === 'student' ? '/student' : role === 'teacher' ? '/teacher' : '/admin';
}

export function LoginPage({ portal }: { portal?: 'parent' | 'student' } = {}) {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const user = useAuth((s) => s.user);
  const offlineSession = useAuth((s) => s.offlineSession);
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const reauth = params.get('reauth') === '1';

  if (user && !reauth && !offlineSession) return <Navigate to={user.role === 'parent' || user.role === 'student' ? homeFor(user.role) : safeNext(params.get('next')) ?? '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    if (forgot) {
      try { await post('/api/auth/reset/request', { username }); setNotice(t('resetRequested')); } catch (err) { setError(errorMessage(err, t('errorGeneric'))); }
      setBusy(false); return;
    }
    const r = await signIn(username, password, portal ?? 'staff');
    setBusy(false);
    if (!r.ok) { setError(r.offlineUnavailable ? t('offlineSignInUnavailable') : r.error); return; }
    if (r.offline) setNotice(t('offlineSignIn'));
    const role = useAuth.getState().user?.role;
    // A ?next= target from another portal is ignored (a parent or student is never sent into /admin and vice versa).
    const next = safeNext(params.get('next'));
    const areaOf = (path: string) => (path.startsWith('/parent') ? 'parent' : path.startsWith('/student') ? 'student' : 'staff');
    const fits = next && areaOf(next) === (role === 'parent' ? 'parent' : role === 'student' ? 'student' : 'staff');
    nav(fits ? next : homeFor(role), { replace: true });
  };

  return (
    <AuthFrame title={forgot ? t('resetPassword') : portal === 'parent' ? t('parentSignIn') : portal === 'student' ? t('studentSignIn') : t('signIn')}>
      {portal === 'parent' && !forgot && <p className="mb-4 text-sm text-ink-soft">{t('parentLoginHint')}</p>}
      {portal === 'student' && !forgot && <p className="mb-4 text-sm text-ink-soft">{t('studentLoginHint')}</p>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="info">{notice}</Alert>}
        <Input label={t('username')} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} required />
        {!forgot && <Input label={t('password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />}
        <Button type="submit" className="w-full" loading={busy} disabled={!username || (!forgot && !password)}>{busy ? t('signingIn') : forgot ? t('requestReset') : t('signIn')}</Button>
        <button type="button" onClick={() => { setForgot(!forgot); setError(null); setNotice(null); }} className="block w-full text-center text-sm text-brand hover:underline">{forgot ? t('back') : t('forgotPassword')}</button>
        <p className="space-y-1 border-t border-surface-line pt-4 text-center text-sm">
          {portal ? <Link to="/login" className="block text-ink-soft hover:underline">{t('areYouStaff')}</Link> : null}
          {portal !== 'parent' && useAuth.getState().config?.package === 'standard' && <Link to="/parent/login" className="block text-brand hover:underline">{t('areYouParent')}</Link>}
          {portal !== 'student' && <Link to="/student/login" className="block text-brand hover:underline">{t('areYouStudent')}</Link>}
        </p>
      </form>
    </AuthFrame>
  );
}

/**
 * Optional, voluntary password change. Rendered inside the dashboard layout (account settings);
 * it is never a mandatory redirect after sign-in.
 */
export function ChangePasswordPage() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const strength = passwordSchema.safeParse(next);
  const mismatch = confirmPw.length > 0 && confirmPw !== next;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirmPw) { setError(t('passwordsDoNotMatch')); return; }
    setBusy(true); setError(null); setDone(false);
    try {
      await post('/api/auth/change-password', { currentPassword: cur, newPassword: next });
      // Re-sign-in refreshes the session and the offline verifier with the new password.
      await signIn(user!.username, next);
      setCur(''); setNext(''); setConfirmPw(''); setDone(true);
    } catch (err) { setError(errorMessage(err, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <PageHeader title={t('accountSettings')} subtitle={user ? `${user.fullName} (${user.username})` : undefined} />
      <Card title={t('changePassword')} className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          {done && <Alert kind="success">{t('passwordChanged')}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          <Input label={t('currentPassword')} type="password" autoComplete="current-password" value={cur} onChange={(e) => { setCur(e.target.value); setDone(false); }} />
          <Input label={t('newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setDone(false); }} error={next && !strength.success ? strength.error.issues[0]?.message : undefined} hint="10+ characters with upper-case, lower-case and a number" />
          <Input label={t('confirmNewPassword')} type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => { setConfirmPw(e.target.value); setDone(false); }} error={mismatch ? t('passwordsDoNotMatch') : undefined} />
          <Button type="submit" loading={busy} disabled={!cur || !strength.success || confirmPw !== next}>{t('save')}</Button>
        </form>
      </Card>
    </div>
  );
}

export function ResetPasswordPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [pw, setPw] = useState(''); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const strength = passwordSchema.safeParse(pw);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await post('/api/auth/reset/confirm', { token: params.get('token'), newPassword: pw }); setDone(true); } catch (err) { setError(errorMessage(err, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title={t('resetPassword')}>
      {done ? <div className="space-y-4"><Alert kind="success">{t('saved')}</Alert><Link to="/login" className="btn-primary w-full">{t('signIn')}</Link></div> : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <Input label={t('newPassword')} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} error={pw && !strength.success ? strength.error.issues[0]?.message : undefined} />
          <Button type="submit" className="w-full" loading={busy} disabled={!strength.success}>{t('save')}</Button>
        </form>
      )}
    </AuthFrame>
  );
}
