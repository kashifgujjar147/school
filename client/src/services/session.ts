import type { PublicConfig, SessionUser } from '@sms/shared';
import { useAuth } from '../store/auth';
import { applyDir, useLang } from '../i18n';
import { get, post, NetworkError, ApiError } from './api';
import { offlineLogin, rememberForOffline } from '../offline/offlineAuth';
import { db, purgeOtherUsers } from '../offline/db';
import { flushOutbox, useOutbox } from '../sync/outbox';
import { warmOfflineCache } from '../offline/warmup';

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1]!, 16)} ${parseInt(m[2]!, 16)} ${parseInt(m[3]!, 16)}` : null;
}

export function applyBranding(c: PublicConfig) {
  const root = document.documentElement;
  const b = hexToRgb(c.primaryColor); const a = hexToRgb(c.accentColor);
  if (b) {
    root.style.setProperty('--brand', b);
    // Deeper shade of the school colour for hover states and dark chrome (~30% towards black).
    root.style.setProperty('--brand-deep', b.split(' ').map((v) => Math.round(Number(v) * 0.7)).join(' '));
  }
  if (a) root.style.setProperty('--accent', a);
  document.title = c.schoolName;
  const fav = document.getElementById('favicon') as HTMLLinkElement | null;
  if (fav && c.faviconUrl) fav.href = c.faviconUrl;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.primaryColor);
}

/** App start: load branding (cached when offline) and restore the server session if any. */
export async function bootstrap() {
  const auth = useAuth.getState();
  try {
    const cfg = await get<PublicConfig>('/api/public/config');
    auth.setConfig(cfg); applyBranding(cfg);
    if (!localStorage.getItem('sms.lang')) useLang.getState().setLang(cfg.defaultLanguage);
  } catch { /* offline first run: defaults */ }
  applyDir(useLang.getState().lang);
  try {
    const me = await get<{ user: SessionUser }>('/api/auth/me');
    auth.setUser(me.user);
    await useOutbox.getState().refresh();
    // Send anything queued offline first, then download every dashboard's data for offline use.
    void flushOutbox().then(() => warmOfflineCache(true));
  } catch { /* not signed in, or offline: the login screen offers offline sign-in */ }
  auth.setReady();
}

export type LoginResult = { ok: true; offline: boolean; mustChangePassword: boolean } | { ok: false; error: string; code?: string; offlineUnavailable?: boolean };

export async function signIn(username: string, password: string, portal?: 'staff' | 'parent' | 'student'): Promise<LoginResult> {
  try {
    const r = await post<{ mustChangePassword: boolean }>('/api/auth/login', { username, password, ...(portal ? { portal } : {}) });
    const me = await get<{ user: SessionUser }>('/api/auth/me');
    useAuth.getState().setUser(me.user, false);
    await purgeOtherUsers(me.user.id);
    // Password change is optional, so every successful online sign-in can be remembered for offline use.
    await rememberForOffline(username, password, me.user).catch(() => undefined);
    await useOutbox.getState().refresh();
    // Send anything queued offline first, then download every dashboard's data for offline use.
    void flushOutbox().then(() => warmOfflineCache(true));
    return { ok: true, offline: false, mustChangePassword: false };
  } catch (e) {
    if (e instanceof NetworkError) {
      const u = await offlineLogin(username, password);
      if (!u) return { ok: false, error: 'offline', offlineUnavailable: true };
      useAuth.getState().setUser(u, true);
      await useOutbox.getState().refresh();
      return { ok: true, offline: true, mustChangePassword: false };
    }
    return { ok: false, error: e instanceof ApiError ? e.message : 'Sign-in failed', ...(e instanceof ApiError ? { code: e.code } : {}) };
  }
}

/**
 * Sign out. By default cached data stays so the same user can work offline later (it is only
 * readable after offline sign-in with their password). On a shared device use wipe=true, which
 * removes cached data and the offline credential. Unsent queued work is never deleted here.
 */
export async function signOut(wipe = false) {
  const { offlineSession, user } = useAuth.getState();
  if (!offlineSession) await post('/api/auth/logout').catch(() => undefined);
  if (user && wipe) {
    await db.httpCache.where('userId').equals(user.id).delete().catch(() => undefined);
    await db.drafts.where('userId').equals(user.id).delete().catch(() => undefined);
    await db.offlineCreds.delete(user.username).catch(() => undefined);
  }
  useAuth.getState().setUser(null);
}
