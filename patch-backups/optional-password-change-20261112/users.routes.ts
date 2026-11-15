import { Router } from 'express';
import { paginationSchema, userCreateSchema, userUpdateSchema, effectivePermissions, type Permission, type Role } from '@sms/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { LoginHistory, PasswordReset, PasswordResetRequest, Session, TeacherAssignment, User, Classroom } from '../models/index.js';
import { can } from '../middleware/auth.js';
import { hashPassword, randomToken, sha256 } from '../security/crypto.js';
import { revokeAllForUser } from '../security/sessions.js';
import { audit } from '../services/audit.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { badRequest, escapeRegex, forbidden, h, notFound, ok, pageArgs, parse, sortArg } from '../utils/http.js';

export const usersRouter = Router();

const PUBLIC_FIELDS = '-passwordHash';

usersRouter.get('/', can('users.view'), h(async (req, res) => {
  const q = parse(paginationSchema.extend({ role: z.string().optional(), status: z.string().optional() }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.role) filter.role = q.role;
  if (q.status) filter.status = q.status;
  if (q.q) filter.$or = [{ fullName: new RegExp(escapeRegex(q.q), 'i') }, { username: new RegExp(escapeRegex(q.q), 'i') }];
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([
    User.find(filter).select(PUBLIC_FIELDS).sort(sortArg(q.sort, ['fullName', 'username', 'role', 'lastLoginAt', 'createdAt'], { fullName: 1 })).skip(skip).limit(limit).lean(),
    User.countDocuments(filter)
  ]);
  ok(res, items, { page: q.page, pageSize: q.pageSize, total });
}));

usersRouter.get('/:id', can('users.view'), h(async (req, res) => {
  const u = await User.findOne({ _id: req.params.id, deletedAt: null }).select(PUBLIC_FIELDS).lean();
  if (!u) throw notFound();
  const assignments = await TeacherAssignment.find({ teacherId: u._id, deletedAt: null }).sort({ startedAt: -1 }).limit(200).lean();
  const classrooms = await Classroom.find({ _id: { $in: assignments.map((a) => a.classroomId) } }).select('name').lean();
  ok(res, {
    ...u,
    effectivePermissions: effectivePermissions(u.role as Role, env.PACKAGE, u.extraPermissions as Permission[], u.revokedPermissions as Permission[]),
    assignments: assignments.map((a) => ({ ...a, classroomName: classrooms.find((c) => c._id === a.classroomId)?.name }))
  });
}));

/** Only a principal may create or modify principal accounts. */
function guardRole(actorRole: string, targetRole: string) {
  if (targetRole === 'principal' && actorRole !== 'principal') throw forbidden('Only a principal can manage principal accounts');
}

usersRouter.post('/', can('users.manage'), h(async (req, res) => {
  const body = parse(userCreateSchema, req.body);
  guardRole(req.user!.role, body.role);
  const { password, ...rest } = body;
  const user = await createVersioned(User, { ...rest, passwordHash: await hashPassword(password), mustChangePassword: false });
  await audit(req, 'user.created', 'user', user._id, { role: body.role, username: body.username });
  const { passwordHash: _ph, ...safe } = user.toObject();
  ok(res, safe, undefined, 201);
}));

usersRouter.patch('/:id', can('users.manage'), h(async (req, res) => {
  const body = parse(userUpdateSchema.extend({ version: z.number().int().optional() }), req.body);
  const target = await User.findById(req.params.id).lean();
  if (!target || target.deletedAt) throw notFound();
  guardRole(req.user!.role, target.role);
  if (body.role) guardRole(req.user!.role, body.role);
  if (target._id === req.user!.id && (body.status && body.status !== 'active')) throw badRequest('You cannot deactivate your own account');
  if (target._id === req.user!.id && body.role && body.role !== target.role) throw badRequest('You cannot change your own role');
  const { version, ...patch } = body;
  const updated = await updateVersioned(User, target._id, patch, {}, version);
  if (patch.status && patch.status !== 'active') await revokeAllForUser(target._id, `status_${patch.status}`);
  if (patch.role || patch.revokedPermissions || patch.extraPermissions) await revokeAllForUser(target._id, 'permissions_changed');
  await audit(req, 'user.updated', 'user', target._id, { changed: Object.keys(patch) });
  const { passwordHash: _ph, ...safe } = updated.toObject();
  ok(res, safe);
}));

/**
 * Admin password reset. mode=link â†’ one-time link valid 24h (no password ever seen by admin).
 * mode=temporary â†’ generated temporary password shown once; user must change it at next login.
 */
usersRouter.post('/:id/reset-password', can('users.manage'), h(async (req, res) => {
  const { mode } = parse(z.object({ mode: z.enum(['link', 'temporary']) }), req.body);
  const target = await User.findById(req.params.id).lean();
  if (!target || target.deletedAt) throw notFound();
  guardRole(req.user!.role, target.role);
  await PasswordResetRequest.updateMany({ userId: target._id, status: 'open' }, { status: 'handled', handledBy: req.user!.id });
  if (mode === 'link') {
    const token = randomToken(32);
    await PasswordReset.create({ _id: sha256(token), userId: target._id, createdBy: req.user!.id, expiresAt: new Date(Date.now() + 24 * 3600_000) });
    await audit(req, 'user.reset_link_issued', 'user', target._id);
    return ok(res, { resetUrl: `${env.APP_URL}/reset-password?token=${token}`, expiresInHours: 24 });
  }
  throw badRequest('Temporary passwords are disabled. Use the password-reset link instead.');
}));

usersRouter.post('/:id/unlock', can('users.manage'), h(async (req, res) => {
  await User.updateOne({ _id: req.params.id }, { failedLogins: 0, lockedUntil: null });
  await audit(req, 'user.unlocked', 'user', String(req.params.id));
  ok(res, { unlocked: true });
}));

usersRouter.get('/:id/sessions', can('security.view'), h(async (req, res) => {
  const sessions = await Session.find({ userId: req.params.id, revokedAt: null, expiresAt: { $gt: new Date() } }).select('-csrfToken').sort({ lastSeenAt: -1 }).lean();
  ok(res, sessions.map((s) => ({ ...s, _id: s._id.slice(0, 12) })));
}));

usersRouter.post('/:id/revoke-sessions', can('users.manage'), h(async (req, res) => {
  await revokeAllForUser(String(req.params.id), 'revoked_by_admin');
  await audit(req, 'user.sessions_revoked', 'user', String(req.params.id));
  ok(res, { revoked: true });
}));

usersRouter.get('/:id/login-history', can('security.view'), h(async (req, res) => {
  ok(res, await LoginHistory.find({ userId: req.params.id }).sort({ at: -1 }).limit(100).lean());
}));

