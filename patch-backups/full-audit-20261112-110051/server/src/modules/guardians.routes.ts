import { Router } from 'express';
import { z } from 'zod';
import { guardianSchema, linkGuardianSchema, normalizePhone, paginationSchema } from '@sms/shared';
import { Guardian, Student, StudentGuardian } from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, hardDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { badRequest, conflict, escapeRegex, h, notFound, ok, pageArgs, parse } from '../utils/http.js';

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
  if (q.q) { const rx = new RegExp(escapeRegex(q.q), 'i'); filter.$or = [{ fullName: rx }, { phone: rx }]; }
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([Guardian.find(filter).sort({ fullName: 1 }).skip(skip).limit(limit).lean(), Guardian.countDocuments(filter)]);
  const links = await StudentGuardian.find({ guardianId: { $in: items.map((g) => g._id) }, deletedAt: null }).lean();
  const students = await Student.find({ _id: { $in: links.map((l) => l.studentId) } }).select('fullName admissionNumber').lean();
  ok(res, items.map((g) => ({ ...g, students: links.filter((l) => l.guardianId === g._id).map((l) => ({ ...students.find((s) => s._id === l.studentId), isPrimary: l.isPrimary, receivesAlerts: l.receivesAlerts })) })), { page: q.page, pageSize: q.pageSize, total });
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
  if (b.phone) Object.assign(patch, await normalized({ phone: b.phone, altPhone: b.altPhone }));
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
  if (b.isPrimary) for (const l of await StudentGuardian.find({ studentId: link.studentId, isPrimary: true, _id: { $ne: linkId }, deletedAt: null }).lean()) await updateVersioned(StudentGuardian, l._id, { isPrimary: false });
  const updated = await updateVersioned(StudentGuardian, linkId, b);
  await refreshPrimaryPhone(link.studentId);
  ok(res, updated);
}));

guardiansRouter.delete('/links/:linkId', can('guardians.manage'), h(async (req, res) => {
  const linkId = idParam(req.params.linkId);
  const link = await StudentGuardian.findById(linkId).lean();
  if (!link) throw notFound();
  await hardDeleteVersioned(StudentGuardian, linkId);
  await refreshPrimaryPhone(link.studentId);
  await audit(req, 'guardian.unlinked', 'student', link.studentId, { guardianId: link.guardianId });
  ok(res, { unlinked: true });
}));
