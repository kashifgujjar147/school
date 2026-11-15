import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, loginSchema, resetConfirmSchema, resetRequestSchema } from '@sms/shared';
import { env, isTest } from '../config/env.js';
import { LoginHistory, PasswordReset, PasswordResetRequest, User } from '../models/index.js';
import { hashPassword, sha256, verifyPassword } from '../security/crypto.js';
import { SESSION_COOKIE, clearSessionCookies, createSession, revokeAllForUser, revokeSession } from '../security/sessions.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { AppError, badRequest, h, ok, parse, unauthorized } from '../utils/http.js';
import { updateVersioned } from '../services/repo.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 30, standardHeaders: 'draft-7', legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 60 * 60_000, limit: isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false });

// Equalise timing for unknown usernames.
let dummyHash: Promise<string> | null = null;
const DUMMY = () => (dummyHash ??= hashPassword('timing-equaliser-not-a-real-password'));

authRouter.post('/login', loginLimiter, h(async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const ip = req.ip; const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const user = await User.findOne({ username, deletedAt: null }).select('+passwordHash');
  const fail = async (reason: string, userId?: string) => {
    await LoginHistory.create({ userId, username, success: false, reason, ip, userAgent });
    // Single generic message: do not reveal whether the username exists.
    throw unauthorized('Incorrect username or password, or the account is unavailable.');
  };
  if (!user) { await verifyPassword(password, await DUMMY()); return fail('unknown_user'); }
  if (user.lockedUntil && user.lockedUntil > new Date()) return fail('locked', user._id);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = (user.failedLogins ?? 0) + 1;
    const lock = failed >= env.LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) : null;
    await User.updateOne({ _id: user._id }, { failedLogins: lock ? 0 : failed, lockedUntil: lock });
    if (lock) await audit(null, 'auth.account_locked', 'user', user._id, { ip });
    return fail('bad_password', user._id);
  }
  if (user.status !== 'active') return fail(`status_${user.status}`, user._id);
  await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip });
  await LoginHistory.create({ userId: user._id, username, success: true, ip, userAgent });
  const { csrf, expiresAt } = await createSession(req, res, user._id);
  ok(res, { csrfToken: csrf, expiresAt, mustChangePassword: false });
}));

authRouter.post('/logout', h(async (req, res) => {
  await revokeSession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookies(res);
  ok(res, { loggedOut: true });
}));

authRouter.get('/me', h(async (req, res) => {
  if (!req.user) throw unauthorized();
  ok(res, { user: req.user, csrfToken: req.csrfToken });
}));

authRouter.post('/change-password', requireAuth, h(async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  if (currentPassword === newPassword) throw badRequest('New password must be different');
  await updateVersioned(User, user._id, { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), mustChangePassword: false });
  await revokeAllForUser(user._id, 'password_changed', req.sessionId);
  await audit(req, 'auth.password_changed', 'user', user._id);
  ok(res, { changed: true });
}));

/**
 * Self-service reset request. Schools often run offline with no email service, so the request is
 * routed to administrators (Security Center), who issue a one-time reset link in person.
 */
authRouter.post('/reset/request', resetLimiter, h(async (req, res) => {
  const { username } = parse(resetRequestSchema, req.body);
  const user = await User.findOne({ username, deletedAt: null }).lean();
  if (user) await PasswordResetRequest.create({ userId: user._id, username, ip: req.ip });
  ok(res, { received: true, message: 'If the account exists, an administrator has been notified.' });
}));

authRouter.post('/reset/confirm', resetLimiter, h(async (req, res) => {
  const { token, newPassword } = parse(resetConfirmSchema, req.body);
  const rec = await PasswordReset.findById(sha256(token));
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw new AppError(400, 'RESET_INVALID', 'This reset link is invalid or has expired.');
  await updateVersioned(User, rec.userId, { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), mustChangePassword: false, failedLogins: 0, lockedUntil: null });
  rec.usedAt = new Date(); await rec.save();
  await revokeAllForUser(rec.userId, 'password_reset');
  await audit(null, 'auth.password_reset_completed', 'user', rec.userId);
  ok(res, { reset: true });
}));

