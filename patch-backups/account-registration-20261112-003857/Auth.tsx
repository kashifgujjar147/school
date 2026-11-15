import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { passwordSchema } from '@sms/shared';
import { useAuth } from '../store/auth';
import { useT } from '../i18n';
import { post } from '../services/api';
import { signIn } from '../services/session';
import { Alert, Button, Input, errorMessage } from '../components/ui';
import { LangSwitch } from '../components/Layout';

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

export function LoginPage() {
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

  if (user && !reauth && !offlineSession) return <Navigate to={params.get('next') || '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    if (forgot) {
      try { await post('/api/auth/reset/request', { username }); setNotice(t('resetRequested')); } catch (err) { setError(errorMessage(err, t('errorGeneric'))); }
      setBusy(false); return;
    }
    const r = await signIn(username, password);
    setBusy(false);
    if (!r.ok) { setError(r.offlineUnavailable ? t('offlineSignInUnavailable') : r.error); return; }
    if (r.offline) setNotice(t('offlineSignIn'));
    if (r.mustChangePassword) { nav('/change-password'); return; }
    const role = useAuth.getState().user?.role;
    nav(params.get('next') || (role === 'teacher' ? '/teacher' : '/admin'), { replace: true });
  };

  return (
    <AuthFrame title={forgot ? t('resetPassword') : t('signIn')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        {notice && <Alert kind="info">{notice}</Alert>}
        <Input label={t('username')} autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setU(e.target.value)} required />
        {!forgot && <Input label={t('password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} required />}
        <Button type="submit" className="w-full" loading={busy} disabled={!username || (!forgot && !password)}>{busy ? t('signingIn') : forgot ? t('requestReset') : t('signIn')}</Button>
        <button type="button" onClick={() => { setForgot(!forgot); setError(null); setNotice(null); }} className="block w-full text-center text-sm text-brand hover:underline">{forgot ? t('back') : t('forgotPassword')}</button>
      </form>
    </AuthFrame>
  );
}

export function ChangePasswordPage() {
  const t = useT();
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordSchema.safeParse(next);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await post('/api/auth/change-password', { currentPassword: cur, newPassword: next });
      // Re-sign-in refreshes the session flags and the offline verifier with the new password.
      await signIn(user!.username, next);
      nav(user?.role === 'teacher' ? '/teacher' : '/admin', { replace: true });
    } catch (err) { setError(errorMessage(err, t('errorGeneric'))); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title={t('changePassword')}>
      <form onSubmit={submit} className="space-y-4">
        {user?.mustChangePassword && <Alert kind="warning">{t('mustChangePassword')}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <Input label={t('currentPassword')} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <Input label={t('newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={next && !strength.success ? strength.error.issues[0]?.message : undefined} hint="10+ characters with upper-case, lower-case and a number" />
        <Button type="submit" className="w-full" loading={busy} disabled={!cur || !strength.success}>{t('save')}</Button>
      </form>
    </AuthFrame>
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
