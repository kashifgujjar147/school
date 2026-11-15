import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, initialSetupSchema, loginSchema, registerSchema, resetConfirmSchema, resetRequestSchema } from '@sms/shared';
import { env, isTest } from '../config/env.js';
import { LoginHistory, PasswordReset, PasswordResetRequest, SchoolSettings, User } from '../models/index.js';
import { hashPassword, safeEqual, sha256, verifyPassword } from '../security/crypto.js';
import { clearSessionCookies, createSession, revokeAllForUser, revokeSession, sessionToken } from '../security/sessions.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { AppError, badRequest, conflict, escapeRegex, h, ok, parse, unauthorized } from '../utils/http.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { setupAvailable, setupRequired } from '../services/setup.js';
import { logger } from '../utils/logger.js';
import { $cmp } from '../utils/query.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : env.LOGIN_RATE_LIMIT, standardHeaders: 'draft-7', legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false });
const setupLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 60 * 60_000, limit: isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false });

/** Case-insensitive exact email match (older accounts may have stored mixed-case emails). */
const emailMatch = (email: string) => new RegExp(`^${escapeRegex(email.trim())}$`, 'i');

/**
 * Finds the account for a sign-in identifier: a username, or an email address (contains "@").
 * An email shared by more than one account is ambiguous and matches nothing (use the username).
 */
async function findLoginUser(identifier: string) {
  if (!identifier.includes('@')) return User.findOne({ username: identifier, deletedAt: null }).select('+passwordHash');
  const found = await User.find({ email: emailMatch(identifier), deletedAt: null }).select('+passwordHash').limit(2);
  return found.length === 1 ? found[0]! : null;
}

/** Derives a free username from an email address ("Jane.Doe+x@school.pk" -> "jane.doex", "jane.doex2", ...). */
async function usernameFromEmail(email: string): Promise<string> {
  let base = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+|[._-]+$/g, '').slice(0, 32);
  if (base.length < 3) base = `user${base}`;
  if (!(await User.exists({ username: base }))) return base;
  for (let i = 2; i < 1000; i++) { const c = `${base}${i}`; if (!(await User.exists({ username: c }))) return c; }
  throw conflict('Could not choose a username for this email. Please contact the school office.');
}

// Equalise timing for unknown usernames.
let dummyHash: Promise<string> | null = null;
const DUMMY = () => (dummyHash ??= hashPassword('timing-equaliser-not-a-real-password'));

authRouter.post('/login', loginLimiter, h(async (req, res) => {
  const { username, password, portal } = parse(loginSchema, req.body);
  const ip = req.ip; const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  const user = await findLoginUser(username);
  const fail = async (reason: string, userId?: string) => {
    await LoginHistory.create({ userId, username, success: false, reason, ip, userAgent });
    // Single generic message: do not reveal whether the username exists.
    throw unauthorized('Incorrect username or password, or the account is unavailable.');
  };
  if (!user) { await verifyPassword(password, await DUMMY()); return fail('unknown_user'); }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    // Same bcrypt cost as every other path, so response time does not reveal a locked account.
    await verifyPassword(password, await DUMMY());
    return fail('locked', user._id);
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = (user.failedLogins ?? 0) + 1;
    const lock = failed >= env.LOGIN_MAX_ATTEMPTS ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) : null;
    await User.updateOne({ _id: user._id }, { failedLogins: lock ? 0 : failed, lockedUntil: lock });
    if (lock) await audit(null, 'auth.account_locked', 'user', user._id, { ip });
    return fail('bad_password', user._id);
  }
  // Self-registered account not yet reviewed. The password was correct, so telling the owner why
  // they cannot sign in reveals nothing to anyone else.
  if (user.status === 'pending' || (user.status === 'active' && user.role === 'unassigned')) {
    await LoginHistory.create({ userId: user._id, username, success: false, reason: 'pending_approval', ip, userAgent });
    throw new AppError(403, 'ACCOUNT_PENDING', 'Your account has been created but is waiting for an administrator to assign your role. Please try again later or contact the school office.');
  }
  if (user.status !== 'active') return fail(`status_${user.status}`, user._id);
  // Parent, student and staff sign-in pages are separate: each only admits its own kind of account.
  const isPortalRole = user.role === 'parent' || user.role === 'student';
  if ((portal === 'parent' && user.role !== 'parent') || (portal === 'student' && user.role !== 'student') || (portal === 'staff' && isPortalRole)) return fail('wrong_portal', user._id);
  await User.updateOne({ _id: user._id }, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip });
  await LoginHistory.create({ userId: user._id, username, success: true, ip, userAgent });
  // Always issue a fresh session and retire whatever session this browser presented (no fixation,
  // no orphaned session left behind when a different user signs in on a shared computer).
  await revokeSession(sessionToken(req), 'replaced_by_login');
  const { csrf, expiresAt } = await createSession(req, res, user._id);
  ok(res, { csrfToken: csrf, expiresAt, mustChangePassword: false, role: user.role });
}));

authRouter.post('/logout', h(async (req, res) => {
  await revokeSession(sessionToken(req));
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
  // Claim the link atomically: two concurrent requests with the same token cannot both succeed.
  const rec = await PasswordReset.findOneAndUpdate(
    { _id: sha256(token), usedAt: null, expiresAt: $cmp({ gt: new Date() }) },
    { $set: { usedAt: new Date() } },
    { new: true }
  ).lean();
  if (!rec) throw new AppError(400, 'RESET_INVALID', 'This reset link is invalid or has expired.');
  await updateVersioned(User, rec.userId, { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), mustChangePassword: false, failedLogins: 0, lockedUntil: null });
  await revokeAllForUser(rec.userId, 'password_reset');
  await audit(null, 'auth.password_reset_completed', 'user', rec.userId);
  ok(res, { reset: true });
}));

/**
 * Public self-registration ("Create account"). The account is stored with role 'unassigned' and
 * status 'pending': it has no permissions and cannot sign in until an administrator approves it
 * and assigns a role (POST /api/users/:id/approve). Public registration can never grant a role.
 */
authRouter.post('/register', registerLimiter, h(async (req, res) => {
  if (!env.REGISTRATION_ENABLED) throw new AppError(403, 'REGISTRATION_DISABLED', 'Account registration is turned off. Please contact the school office.');
  const { fullName, email, password } = parse(registerSchema, req.body);
  if (await User.exists({ email: emailMatch(email), deletedAt: null })) throw conflict('An account with this email address already exists. Sign in, or use "Forgot password?".');
  const username = await usernameFromEmail(email);
  let user;
  try {
    user = await createVersioned(User, {
      username, fullName, email, role: 'unassigned', status: 'pending', selfRegistered: true,
      passwordHash: await hashPassword(password), mustChangePassword: false
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('That account already exists. Please try signing in.');
    throw e;
  }
  await audit(null, 'auth.registered', 'user', user._id, { username, ip: req.ip });
  ok(res, { username, status: 'pending', message: 'Account created. An administrator must assign your role before you can sign in.' }, undefined, 201);
}));

/** Whether the first-administrator web setup is needed / available (no secrets revealed). */
authRouter.get('/setup-status', h(async (_req, res) => {
  const required = await setupRequired();
  ok(res, { setupRequired: required, setupAvailable: required && Boolean(env.SETUP_TOKEN) });
}));

/**
 * One-time first-administrator setup. Allowed ONLY while no active principal/admin exists, and only
 * with the SETUP_TOKEN from the server environment (never sent to browsers). Creates an active
 * principal; afterwards setup is closed because an administrator exists.
 */
authRouter.post('/setup', setupLimiter, h(async (req, res) => {
  const body = parse(initialSetupSchema, req.body);
  const closed = () => new AppError(403, 'SETUP_CLOSED', 'Initial setup is not available. An administrator account already exists.');
  if (!(await setupAvailable())) throw closed();
  // Compare digests so the comparison is constant-time regardless of input length.
  if (!safeEqual(sha256(body.setupToken), sha256(env.SETUP_TOKEN))) {
    await audit(null, 'auth.setup_failed', 'system', 'setup', { ip: req.ip });
    throw new AppError(403, 'SETUP_TOKEN', 'The setup token is incorrect.');
  }
  // Claim setup atomically so two concurrent requests cannot both create a first administrator.
  // A claim older than a minute that produced no administrator (e.g. a crash) may be re-claimed.
  const now = new Date();
  const claimed = await SchoolSettings.findOneAndUpdate(
    { _id: 'school', $or: [{ setupCompletedAt: null }, { setupCompletedAt: $cmp({ lt: new Date(now.getTime() - 60_000) }) }] },
    { $set: { setupCompletedAt: now } },
    { new: true }
  ).lean();
  if (!claimed || !(await setupRequired())) throw closed();
  if (await User.exists({ username: body.username })) {
    await SchoolSettings.updateOne({ _id: 'school' }, { $set: { setupCompletedAt: null } });
    throw conflict('That username is already taken');
  }
  const user = await createVersioned(User, {
    username: body.username, fullName: body.fullName, email: body.email || null, role: 'principal', status: 'active',
    passwordHash: await hashPassword(body.password), mustChangePassword: false
  });
  await audit(null, 'auth.initial_setup', 'user', user._id, { username: body.username, ip: req.ip });
  logger.warn({ username: body.username }, 'first administrator created via web setup; you can now remove SETUP_TOKEN from the environment');
  ok(res, { username: user.username, role: 'principal' }, undefined, 201);
}));
