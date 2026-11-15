import type { SessionUser } from '@sms/shared';
import { db } from './db';

/**
 * Offline sign-in. After a successful ONLINE sign-in we store a PBKDF2-SHA256 verifier of the
 * password (random salt, 210k iterations) plus the user's profile. Offline, the typed password
 * is checked against the verifier; success unlocks only data already cached on this device.
 * No password, no session cookie and no token is ever written to IndexedDB. Any server request
 * still requires a real server session, so offline sign-in grants no server-side access.
 * Verifiers expire after 30 days without an online sign-in.
 */
const ITERATIONS = 210_000;
const MAX_AGE_MS = 30 * 86_400_000;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt).buffer, iterations }, key, 256);
  return b64(bits);
}

export async function rememberForOffline(username: string, password: string, user: SessionUser) {
  if (!crypto?.subtle) return; // WebCrypto needs a secure context (HTTPS or localhost)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  await db.offlineCreds.put({ username: username.toLowerCase(), salt: b64(salt.buffer), hash, iterations: ITERATIONS, user, savedAt: Date.now() });
}

export async function offlineLogin(username: string, password: string): Promise<SessionUser | null> {
  if (!crypto?.subtle) return null;
  const rec = await db.offlineCreds.get(username.toLowerCase());
  if (!rec || Date.now() - rec.savedAt > MAX_AGE_MS) return null;
  const hash = await derive(password, unb64(rec.salt), rec.iterations);
  // constant-time-ish comparison
  if (hash.length !== rec.hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0 ? (rec.user as SessionUser) : null;
}

export async function hasOfflineCredential(username: string) {
  const rec = await db.offlineCreds.get(username.toLowerCase());
  return Boolean(rec && Date.now() - rec.savedAt <= MAX_AGE_MS);
}

export async function forgetOfflineCredential(username: string) {
  await db.offlineCreds.delete(username.toLowerCase());
}

/** Exposed for tests. */
export const _internals = { derive };
