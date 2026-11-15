import { Router } from 'express';
import { z } from 'zod';
import { guardianSchema, linkGuardianSchema, normalizePhone, paginationSchema, parentAccountSchema } from '@sms/shared';
import { Guardian, Student, StudentGuardian, User } from '../models/index.js';
import { generatePassword, hashPassword } from '../security/crypto.js';
import { revokeAllForUser } from '../security/sessions.js';
import { can, requireFeature } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, hardDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { badRequest, conflict, escapeRegex, h, notFound, ok, pageArgs, parse, phoneSearchRegex } from '../utils/http.js';
import { $in, $ne } from '../utils/query.js';

/** Standard package only — gated in the backend, not just hidden in the UI. */
export const guardiansRouter = Router();
guardiansRouter.use(requireFeature('guardians'));

const idParam = (v: unknown) => z.string().uuid().parse(v);

async function normalized(body: { phone: string; altPhone?: string | null }) {
  const cc = (await getSettings()).defaultCountryCode;
  const phone = normalizePhone(body.phone, cc);
  if (!phone) throw badRequest('Invalid phone number');
  const altPhone = body.altPhone ? normalizePhone(body.altPhone, cc) : null;
  if (body.altPhone && !altPhone) throw badRequest('Invalid alternate phone number');
  return { phone, altPhone };
}

async function refreshPrimaryPhone(studentId: string) {
  const primary = await StudentGuardian.findOne({ studentId, isPrimary: true, deletedAt: null }).lean();
  const g = primary ? await Guardian.findById(primary.guardianId).lean() : null;
  await updateVersioned(Student, studentId, { primaryGuardianPhone: g?.phone ?? null });
}

guardiansRouter.get('/', can('guardians.view'), h(async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const phoneRx = phoneSearchRegex(q.q);
    filter.$or = [{ fullName: rx }, { relation: rx }, ...(phoneRx ? [{ phone: phoneRx }, { altPhone: phoneRx }] : [])];
  }
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([Guardian.find(filter).sort({ fullName: 1 }).skip(skip).limit(limit).lean(), Guardian.countDocuments(filter)]);
  const links = await StudentGuardian.find({ guardianId: $in(items.map((g) => g._id)), deletedAt: null }).lean();
  const students = await Student.find({ _id: $in(links.map((l) => l.studentId)) }).select('fullName admissionNumber').lean();
  const accounts = await User.find({ guardianId: $in(items.map((g) => g._id)), role: 'parent', deletedAt: null }).select('username status lastLoginAt guardianId').lean();
  ok(res, items.map((g) => ({ ...g, portalAccount: accounts.find((a) => a.guardianId === g._id) ?? null, students: links.filter((l) => l.guardianId === g._id).map((l) => ({ ...students.find((s) => s._id === l.studentId), isPrimary: l.isPrimary, receivesAlerts: l.receivesAlerts })) })), { page: q.page, pageSize: q.pageSize, total });
}));

guardiansRouter.post('/', can('guardians.manage'), h(async (req, res) => {
  const b = parse(guardianSchema, req.body);
  const phones = await normalized(b);
  const g = await createVersioned(Guardian, { ...b, ...phones, email: b.email || null });
  await audit(req, 'guardian.created', 'guardian', g._id);
  ok(res, g, undefined, 201);
}));

guardiansRouter.patch('/:id', can('guardians.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(guardianSchema.partial(), req.body);
  const patch: Record<string, unknown> = { ...b };
  if (b.email !== undefined) patch.email = b.email || null;
  // Normalise only the numbers being changed: an omitted altPhone must keep its stored value.
  const cc = (await getSettings()).defaultCountryCode;
  if (b.phone !== undefined) {
    const phone = normalizePhone(b.phone, cc);
    if (!phone) throw badRequest('Invalid phone number');
    patch.phone = phone;
  }
  if (b.altPhone !== undefined) {
    const altPhone = b.altPhone ? normalizePhone(b.altPhone, cc) : null;
    if (b.altPhone && !altPhone) throw badRequest('Invalid alternate phone number');
    patch.altPhone = altPhone;
  }
  const g = await updateVersioned(Guardian, id, patch);
  if (b.phone) for (const l of await StudentGuardian.find({ guardianId: id, isPrimary: true, deletedAt: null }).lean()) await refreshPrimaryPhone(l.studentId);
  await audit(req, 'guardian.updated', 'guardian', id);
  ok(res, g);
}));

guardiansRouter.post('/students/:studentId/link', can('guardians.manage'), h(async (req, res) => {
  const studentId = idParam(req.params.studentId);
  const b = parse(linkGuardianSchema, req.body);
  if (!(await Student.exists({ _id: studentId, deletedAt: null }))) throw notFound('Student not found');
  if (!(await Guardian.exists({ _id: b.guardianId, deletedAt: null }))) throw notFound('Guardian not found');
  if (await StudentGuardian.exists({ studentId, guardianId: b.guardianId, deletedAt: null })) throw conflict('Guardian already linked');
  const hasAny = await StudentGuardian.exists({ studentId, deletedAt: null });
  const isPrimary = b.isPrimary || !hasAny; // first guardian becomes primary
  if (isPrimary) for (const l of await StudentGuardian.find({ studentId, isPrimary: true, deletedAt: null }).lean()) await updateVersioned(StudentGuardian, l._id, { isPrimary: false });
  const link = await createVersioned(StudentGuardian, { studentId, guardianId: b.guardianId, isPrimary, receivesAlerts: b.receivesAlerts });
  await refreshPrimaryPhone(studentId);
  await audit(req, 'guardian.linked', 'student', studentId, { guardianId: b.guardianId });
  ok(res, link, undefined, 201);
}));

guardiansRouter.patch('/links/:linkId', can('guardians.manage'), h(async (req, res) => {
  const linkId = idParam(req.params.linkId);
  const b = parse(z.object({ isPrimary: z.boolean().optional(), receivesAlerts: z.boolean().optional() }), req.body);
  const link = await StudentGuardian.findOne({ _id: linkId, deletedAt: null }).lean();
  if (!link) throw notFound();
  if (b.isPrimary) for (const l of await StudentGuardian.find({ studentId: link.studentId, isPrimary: true, _id: $ne(linkId), deletedAt: null }).lean()) await updateVersioned(StudentGuardian, l._id, { isPrimary: false });
  const updated = await updateVersioned(StudentGuardian, linkId, b);
  await refreshPrimaryPhone(link.studentId);
  ok(res, updated);
}));

guardiansRouter.delete('/links/:linkId', can('guardians.manage'), h(async (req, res) => {
  const linkId = idParam(req.params.linkId);
  const link = await StudentGuardian.findById(linkId).lean();
  if (!link) throw notFound();
  await hardDeleteVersioned(StudentGuardian, linkId);
  // A student with guardians always has a primary one: it is the student's contact phone (student
  // phone search, duplicate detection). Alerts are unaffected — they go to every link with receivesAlerts.
  if (link.isPrimary) {
    const next = await StudentGuardian.findOne({ studentId: link.studentId, deletedAt: null }).sort({ createdAt: 1 }).lean();
    if (next) await updateVersioned(StudentGuardian, next._id, { isPrimary: true });
  }
  await refreshPrimaryPhone(link.studentId);
  await audit(req, 'guardian.unlinked', 'student', link.studentId, { guardianId: link.guardianId });
  ok(res, { unlinked: true });
}));

// ------------------------------------------------------------------ Parent portal accounts (v1.2)
/**
 * A parent account is always created FROM a guardian record, so it can only ever see the children
 * linked to that guardian. One account per guardian (unique index on users.guardianId); one guardian
 * may be linked to several children, so one sign-in covers all of them.
 */
guardiansRouter.get('/:id/portal-account', requireFeature('parent_portal'), can('guardians.view'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const u = await User.findOne({ guardianId: id, role: 'parent', deletedAt: null }).select('username status lastLoginAt createdAt').lean();
  ok(res, u ?? null);
}));

guardiansRouter.post('/:id/portal-account', requireFeature('parent_portal'), can('guardians.manage'), can('users.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(parentAccountSchema, req.body);
  const g = await Guardian.findOne({ _id: id, deletedAt: null }).lean();
  if (!g) throw notFound('Guardian not found');
  if (await User.exists({ guardianId: id, deletedAt: null })) throw conflict('This guardian already has a portal account');
  if (await User.exists({ username: b.username })) throw conflict('That username is already taken');
  const password = b.password ?? generatePassword();
  const u = await createVersioned(User, {
    username: b.username, fullName: g.fullName, email: g.email || null, phone: g.phone, role: 'parent', guardianId: id,
    passwordHash: await hashPassword(password), mustChangePassword: !b.password
  });
  await audit(req, 'parent_account.created', 'user', u._id, { guardianId: id, username: b.username });
  // The generated password is shown ONCE to the administrator to hand over; it is never stored in clear.
  ok(res, { userId: u._id, username: u.username, ...(b.password ? {} : { temporaryPassword: password }) }, undefined, 201);
}));

guardiansRouter.patch('/:id/portal-account', requireFeature('parent_portal'), can('guardians.manage'), can('users.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ status: z.enum(['active', 'inactive', 'suspended']) }), req.body);
  const u = await User.findOne({ guardianId: id, role: 'parent', deletedAt: null }).lean();
  if (!u) throw notFound('No portal account for this guardian');
  await updateVersioned(User, u._id, { status: b.status });
  if (b.status !== 'active') await revokeAllForUser(u._id, `status_${b.status}`);
  await audit(req, 'parent_account.updated', 'user', u._id, { status: b.status });
  ok(res, { status: b.status });
}));
