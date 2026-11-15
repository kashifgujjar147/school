import type { Request, Response } from 'express';
import { env } from '../config/env.js';
import { Session } from '../models/index.js';
import { randomToken, sha256 } from './crypto.js';
import { $ne } from '../utils/query.js';

export const SESSION_COOKIE = 'sms_sid';
export const CSRF_COOKIE = 'sms_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const cookieBase = () => ({
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/'
});

export async function createSession(req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await Session.create({
    _id: sha256(token), userId, csrfToken: csrf,
    ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300), expiresAt
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, expires: expiresAt });
  // Readable by JS so the SPA can echo it in the X-CSRF-Token header (double-submit + server match).
  res.cookie(CSRF_COOKIE, csrf, { ...cookieBase(), httpOnly: false, expires: expiresAt });
  return { csrf, expiresAt };
}

/**
 * The session token from the request cookie, only when it is a plain string. cookie-parser turns
 * "j:"-prefixed cookies into objects; those must never reach sha256() or a query.
 */
export function sessionToken(req: Request): string | undefined {
  const v: unknown = req.cookies?.[SESSION_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieBase());
  res.clearCookie(CSRF_COOKIE, cookieBase());
}

export async function loadSession(token: string | undefined) {
  if (!token || token.length > 200) return null;
  const s = await Session.findById(sha256(token)).lean();
  if (!s || s.revokedAt) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() < now) return null;
  if (now - new Date(s.lastSeenAt).getTime() > env.SESSION_IDLE_MINUTES * 60_000) {
    await Session.updateOne({ _id: s._id }, { revokedAt: new Date(), revokedReason: 'idle_timeout' });
    return null;
  }
  // Throttle lastSeen writes to once a minute.
  if (now - new Date(s.lastSeenAt).getTime() > 60_000) await Session.updateOne({ _id: s._id }, { lastSeenAt: new Date() });
  return s;
}

export async function revokeSession(token: string | undefined, reason = 'logout') {
  if (!token) return;
  await Session.updateOne({ _id: sha256(token) }, { revokedAt: new Date(), revokedReason: reason });
}

export async function revokeAllForUser(userId: string, reason: string, exceptSessionId?: string) {
  await Session.updateMany({ userId, revokedAt: null, ...(exceptSessionId ? { _id: $ne(exceptSessionId) } : {}) }, { revokedAt: new Date(), revokedReason: reason });
}
