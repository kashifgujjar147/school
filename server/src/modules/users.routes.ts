import { Router } from 'express';
import { approveUserSchema, paginationSchema, userCreateSchema, userUpdateSchema, effectivePermissions, type Permission, type Role, type SessionUser } from '@sms/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Guardian, LoginHistory, PasswordReset, PasswordResetRequest, Session, Student, TeacherAssignment, User, Classroom } from '../models/index.js';
import { can } from '../middleware/auth.js';
import { generatePassword, hashPassword, randomToken, sha256 } from '../security/crypto.js';
import { revokeAllForUser } from '../security/sessions.js';
import { audit } from '../services/audit.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { badRequest, conflict, escapeRegex, forbidden, h, notFound, ok, pageArgs, parse, sortArg } from '../utils/http.js';
import { packageHasFeature } from '@sms/shared';
import { $cmp, $in } from '../utils/query.js';

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
  const classrooms = await Classroom.find({ _id: $in(assignments.map((a) => a.classroomId)) }).select('name').lean();
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

/**
 * Nobody may give an account more power than they hold themselves: the account's resulting
 * permissions (role + extra - revoked) must all be permissions the actor has. This stops an admin
 * granting principal-only permissions (backups.restore) and stops a user who was given
 * users.manage from creating or promoting an admin.
 */
function guardGrant(actor: SessionUser, role: Role, extra: Permission[], revoked: Permission[]) {
  const beyond = effectivePermissions(role, env.PACKAGE, extra, revoked).filter((p) => !actor.permissions.includes(p));
  if (beyond.length) throw forbidden(`You cannot grant permissions you do not have yourself: ${beyond.join(', ')}`);
}

const sameSet = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

usersRouter.post('/', can('users.manage'), h(async (req, res) => {
  const body = parse(userCreateSchema, req.body);
  guardRole(req.user!.role, body.role);
  guardGrant(req.user!, body.role, body.extraPermissions, body.revokedPermissions);
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
  // A self-registered account gets its role (and becomes active) only through the approval endpoint,
  // so a role is always assigned deliberately and parent/student accounts are always linked.
  if ((target.role === 'unassigned' || target.status === 'pending') && (body.role || body.status === 'active' || body.extraPermissions?.length || body.revokedPermissions?.length)) {
    throw badRequest('This account is pending approval. Use "Approve account" to assign its role.');
  }
  if (target._id === req.user!.id && (body.status && body.status !== 'active')) throw badRequest('You cannot deactivate your own account');
  if (target._id === req.user!.id && body.role && body.role !== target.role) throw badRequest('You cannot change your own role');
  // A parent account can never be turned into a staff account (or given staff permissions).
  // (body.role can only be a staff role: the update schema does not accept 'parent'.)
  if ((target.role === 'parent' || target.role === 'student') && (body.role || body.extraPermissions?.length || body.revokedPermissions?.length)) {
    throw badRequest('Parent and student accounts cannot be given a staff role or permissions. Create a separate staff account.');
  }
  const currentExtra = target.extraPermissions as Permission[];
  const currentRevoked = target.revokedPermissions as Permission[];
  const extraChanged = body.extraPermissions !== undefined && !sameSet(body.extraPermissions, currentExtra);
  const revokedChanged = body.revokedPermissions !== undefined && !sameSet(body.revokedPermissions, currentRevoked);
  const roleChanged = body.role !== undefined && body.role !== target.role;
  if (target._id === req.user!.id && (extraChanged || revokedChanged)) throw badRequest('You cannot change your own permissions');
  if (roleChanged || extraChanged || revokedChanged) {
    guardGrant(req.user!, body.role ?? (target.role as Role), body.extraPermissions ?? currentExtra, body.revokedPermissions ?? currentRevoked);
  }
  const { version, ...patch } = body;
  const updated = await updateVersioned(User, target._id, patch, {}, version);
  if (patch.status && patch.status !== 'active') await revokeAllForUser(target._id, `status_${patch.status}`);
  if (patch.role || patch.revokedPermissions || patch.extraPermissions) await revokeAllForUser(target._id, 'permissions_changed');
  await audit(req, 'user.updated', 'user', target._id, { changed: Object.keys(patch) });
  const { passwordHash: _ph, ...safe } = updated.toObject();
  ok(res, safe);
}));

/**
 * Approves a pending (self-registered) account: assigns its role and activates it.
 * Same rules as creating an account: only a principal can make a principal, nobody can grant more
 * than they hold, and parent/student accounts must be linked to an existing guardian/student record
 * that does not already have an account.
 */
usersRouter.post('/:id/approve', can('users.manage'), h(async (req, res) => {
  const body = parse(approveUserSchema.extend({ version: z.number().int().optional() }), req.body);
  const target = await User.findOne({ _id: z.string().min(1).max(64).parse(req.params.id), deletedAt: null }).lean();
  if (!target) throw notFound();
  if (target.status !== 'pending' && target.role !== 'unassigned') throw badRequest('This account is not pending approval.');
  if (target._id === req.user!.id) throw badRequest('You cannot approve your own account');
  guardRole(req.user!.role, body.role);
  const patch: Record<string, unknown> = { role: body.role, status: 'active', guardianId: null, studentId: null, extraPermissions: [], revokedPermissions: [], approvedBy: req.user!.id, approvedAt: new Date() };
  if (body.role === 'parent') {
    if (!packageHasFeature(env.PACKAGE, 'parent_portal')) throw forbidden('Parent accounts require the Standard package.');
    if (!body.guardianId) throw badRequest('Choose the guardian record this parent account belongs to.');
    if (!req.user!.permissions.includes('guardians.manage')) throw forbidden();
    if (!(await Guardian.exists({ _id: body.guardianId, deletedAt: null }))) throw notFound('Guardian not found');
    if (await User.exists({ guardianId: body.guardianId, deletedAt: null })) throw conflict('This guardian already has a portal account');
    patch.guardianId = body.guardianId;
  } else if (body.role === 'student') {
    if (!body.studentId) throw badRequest('Choose the student record this account belongs to.');
    if (!req.user!.permissions.includes('students.manage')) throw forbidden();
    if (!(await Student.exists({ _id: body.studentId, deletedAt: null }))) throw notFound('Student not found');
    if (await User.exists({ studentId: body.studentId, deletedAt: null })) throw conflict('This student already has a portal account');
    patch.studentId = body.studentId;
  } else {
    guardGrant(req.user!, body.role, [], []);
  }
  const updated = await updateVersioned(User, target._id, patch, {}, body.version);
  await revokeAllForUser(target._id, 'approved');
  await audit(req, 'user.approved', 'user', target._id, { role: body.role, guardianId: patch.guardianId, studentId: patch.studentId });
  const { passwordHash: _ph, ...safe } = updated.toObject();
  ok(res, safe);
}));

/** Rejects a pending registration: the account is deactivated and can never sign in. */
usersRouter.post('/:id/reject', can('users.manage'), h(async (req, res) => {
  const target = await User.findOne({ _id: z.string().min(1).max(64).parse(req.params.id), deletedAt: null }).lean();
  if (!target) throw notFound();
  if (target.status !== 'pending') throw badRequest('This account is not pending approval.');
  await updateVersioned(User, target._id, { status: 'inactive' });
  await revokeAllForUser(target._id, 'registration_rejected');
  await audit(req, 'user.registration_rejected', 'user', target._id);
  ok(res, { rejected: true });
}));

/**
 * Admin password reset. mode=link -> one-time link valid 24h (no password ever seen by admin).
 * mode=temporary -> generated password shown once; it signs in directly (changing it is optional).
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
  // Generated password works directly for sign-in; changing it later is optional (account settings).
  const temp = generatePassword();
  await updateVersioned(User, target._id, { passwordHash: await hashPassword(temp), mustChangePassword: false, failedLogins: 0, lockedUntil: null });
  await revokeAllForUser(target._id, 'password_reset_by_admin');
  await audit(req, 'user.temporary_password_issued', 'user', target._id);
  ok(res, { temporaryPassword: temp });
}));

/** Loads a live account the actor is allowed to manage (same principal rule as edit / reset). */
async function manageableUser(actorRole: string, id: unknown) {
  const target = await User.findOne({ _id: z.string().min(1).max(64).parse(id), deletedAt: null }).select('_id role').lean();
  if (!target) throw notFound();
  guardRole(actorRole, target.role);
  return target;
}

usersRouter.post('/:id/unlock', can('users.manage'), h(async (req, res) => {
  const target = await manageableUser(req.user!.role, req.params.id);
  await User.updateOne({ _id: target._id }, { failedLogins: 0, lockedUntil: null });
  await audit(req, 'user.unlocked', 'user', target._id);
  ok(res, { unlocked: true });
}));

usersRouter.get('/:id/sessions', can('security.view'), h(async (req, res) => {
  const sessions = await Session.find({ userId: req.params.id, revokedAt: null, expiresAt: $cmp({ gt: new Date() }) }).select('-csrfToken').sort({ lastSeenAt: -1 }).lean();
  ok(res, sessions.map((s) => ({ ...s, _id: s._id.slice(0, 12) })));
}));

usersRouter.post('/:id/revoke-sessions', can('users.manage'), h(async (req, res) => {
  const target = await manageableUser(req.user!.role, req.params.id);
  await revokeAllForUser(target._id, 'revoked_by_admin');
  await audit(req, 'user.sessions_revoked', 'user', target._id);
  ok(res, { revoked: true });
}));

usersRouter.get('/:id/login-history', can('security.view'), h(async (req, res) => {
  ok(res, await LoginHistory.find({ userId: req.params.id }).sort({ at: -1 }).limit(100).lean());
}));

