import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  balanceMinor, feeSettingsSchema, isoDate, manualPaymentSchema, paymentProviderSchema, schoolDate, voucherBulkSchema,
  voucherCreateSchema, voucherListSchema, voucherTotal
} from '@sms/shared';
import { env, isTest } from '../config/env.js';
import { Classroom, FeePayment, FeeVoucher, PaymentIntent, SchoolSettings, SecretSettings, Student, User } from '../models/index.js';
import { can, canAny, requireFeature } from '../middleware/auth.js';
import { idempotent } from '../middleware/idempotency.js';
import { encryptJson } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { applyPayment, newVoucherNumber, queueFeeReminders, studentPlacement } from '../services/fees.js';
import { getPaymentConfig, handlePaymentWebhook, paymentProblems } from '../services/payments.js';
import { renderReceiptPdf, renderVoucherPdf } from '../services/documents.js';
import { createVersioned, updateVersioned } from '../services/repo.js';
import { getSettings, invalidateSettings } from '../services/settings.js';
import { badRequest, conflict, escapeRegex, h, notFound, ok, pageArgs, parse } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';
import { logger } from '../utils/logger.js';

export const feesRouter = Router();
feesRouter.use(requireFeature('fees'));
const idParam = (v: unknown) => z.string().uuid().parse(v);

async function today() { return schoolDate(new Date(), (await getSettings()).timeZone); }

// ------------------------------------------------------------------ Vouchers
feesRouter.get('/vouchers', can('fees.view'), h(async (req, res) => {
  const q = parse(voucherListSchema, req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.studentId) filter.studentId = q.studentId;
  if (q.classroomId) filter.classroomId = q.classroomId;
  if (q.status) filter.status = q.status;
  if (q.period) filter.period = q.period;
  if (q.overdue === 'true') { filter.status = $in(['unpaid', 'partial']); filter.dueDate = $cmp({ lt: await today() }); }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const students = await Student.find({ deletedAt: null, $or: [{ fullName: rx }, { admissionNumber: rx }] }).select('_id').limit(500).lean();
    filter.$or = [{ voucherNumber: rx }, { title: rx }, { studentId: $in(students.map((s) => s._id)) }];
  }
  const sortKey = q.sort ?? '-dueDate';
  const sort: Record<string, 1 | -1> = { [sortKey.replace('-', '')]: sortKey.startsWith('-') ? -1 : 1 };
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([FeeVoucher.find(filter).sort(sort).skip(skip).limit(limit).lean(), FeeVoucher.countDocuments(filter)]);
  const [students, rooms] = await Promise.all([
    Student.find({ _id: $in(items.map((i) => i.studentId)) }).select('fullName admissionNumber').lean(),
    Classroom.find({ _id: $in(items.map((i) => i.classroomId)) }).select('name').lean()
  ]);
  const t = await today();
  ok(res, items.map((v) => ({
    ...v, balanceMinor: balanceMinor(v.totalMinor, v.paidMinor), overdue: (v.status === 'unpaid' || v.status === 'partial') && v.dueDate < t,
    studentName: students.find((s) => s._id === v.studentId)?.fullName, admissionNumber: students.find((s) => s._id === v.studentId)?.admissionNumber,
    classroomName: rooms.find((r) => r._id === v.classroomId)?.name
  })), { page: q.page, pageSize: q.pageSize, total });
}));

feesRouter.get('/vouchers/:id', can('fees.view'), h(async (req, res) => {
  const v = await FeeVoucher.findOne({ _id: idParam(req.params.id), deletedAt: null }).lean();
  if (!v) throw notFound();
  const [student, payments, intents] = await Promise.all([
    Student.findById(v.studentId).select('fullName admissionNumber').lean(),
    FeePayment.find({ voucherId: v._id, deletedAt: null }).sort({ paidAt: 1 }).lean(),
    PaymentIntent.find({ voucherId: v._id }).sort({ createdAt: -1 }).limit(20).select('-checkoutUrl').lean()
  ]);
  const receivers = await User.find({ _id: $in(payments.map((p) => p.receivedBy)) }).select('fullName').lean();
  ok(res, { ...v, balanceMinor: balanceMinor(v.totalMinor, v.paidMinor), student, payments: payments.map((p) => ({ ...p, receivedByName: receivers.find((r) => r._id === p.receivedBy)?.fullName })), intents });
}));

async function buildVoucher(studentId: string, b: z.infer<typeof voucherCreateSchema> | Omit<z.infer<typeof voucherBulkSchema>, 'classroomId'>, actorId: string, currency: string, issueDate: string) {
  const st = await studentPlacement(studentId);
  const totalMinor = voucherTotal(b.items, b.lateFeeMinor, b.discountMinor);
  return createVersioned(FeeVoucher, {
    voucherNumber: newVoucherNumber(b.period), studentId, classroomId: st.classroomId, classId: st.classId, sessionId: st.sessionId,
    title: b.title, period: b.period, issueDate: b.issueDate ?? issueDate, dueDate: b.dueDate, items: b.items,
    lateFeeMinor: b.lateFeeMinor, discountMinor: b.discountMinor, totalMinor, paidMinor: 0, status: totalMinor === 0 ? 'paid' : 'unpaid',
    allowPartial: b.allowPartial, currency, notes: b.notes ?? undefined, createdBy: actorId
  });
}

feesRouter.post('/vouchers', can('fees.manage'), h(async (req, res) => {
  const b = parse(voucherCreateSchema, req.body);
  const s = await getSettings();
  const dup = await FeeVoucher.exists({ studentId: b.studentId, period: b.period, title: b.title, status: $in(['unpaid', 'partial', 'paid']), deletedAt: null });
  if (dup) throw conflict('A voucher with this title and period already exists for this student');
  const v = await buildVoucher(b.studentId, b, req.user!.id, s.fees?.currency ?? 'PKR', await today());
  await audit(req, 'fee.voucher_created', 'fee_voucher', v._id, { studentId: b.studentId, totalMinor: v.totalMinor });
  ok(res, v, undefined, 201);
}));

/** Issues the same voucher to every active student of a classroom. Students who already have it are skipped. */
feesRouter.post('/vouchers/bulk', can('fees.manage'), idempotent(false), h(async (req, res) => {
  const b = parse(voucherBulkSchema, req.body);
  const s = await getSettings();
  if (!(await Classroom.exists({ _id: b.classroomId, deletedAt: null }))) throw notFound('Classroom not found');
  const students = await Student.find({ classroomId: b.classroomId, status: 'active', deletedAt: null }).select('_id').lean();
  const existing = new Set((await FeeVoucher.find({ studentId: $in(students.map((x) => x._id)), period: b.period, title: b.title, status: $in(['unpaid', 'partial', 'paid']), deletedAt: null }).select('studentId').lean()).map((v) => v.studentId));
  const t = await today();
  let created = 0;
  for (const st of students) {
    if (existing.has(st._id)) continue;
    await buildVoucher(st._id, b, req.user!.id, s.fees?.currency ?? 'PKR', t);
    created++;
  }
  await audit(req, 'fee.vouchers_bulk_created', 'classroom', b.classroomId, { created, skipped: existing.size, period: b.period });
  ok(res, { created, skipped: existing.size, students: students.length }, undefined, 201);
}));

feesRouter.post('/vouchers/:id/cancel', can('fees.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const v = await FeeVoucher.findOne({ _id: id, deletedAt: null }).lean();
  if (!v) throw notFound();
  if (v.paidMinor > 0) throw conflict('A voucher with recorded payments cannot be cancelled');
  if (await PaymentIntent.exists({ voucherId: id, status: $in(['pending', 'processing']), expiresAt: $cmp({ gt: new Date() }) })) throw conflict('An online payment for this voucher is in progress. Try again in 30 minutes.');
  const r = await updateVersioned(FeeVoucher, id, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user!.id, cancelReason: b.reason }, {}, v.version);
  await audit(req, 'fee.voucher_cancelled', 'fee_voucher', id, { reason: b.reason });
  ok(res, r);
}));

/** Cash / bank / cheque received at the school office. Idempotency-Key required (double-click safe). */
feesRouter.post('/vouchers/:id/payments', can('fees.manage'), idempotent(true), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(manualPaymentSchema, req.body);
  const t = await today();
  if (b.paidAt && b.paidAt > t) throw badRequest('Payment date cannot be in the future');
  const p = await applyPayment({
    voucherId: id, amountMinor: b.amountMinor, method: b.method, enforceRules: true,
    paidAt: b.paidAt ? new Date(b.paidAt + 'T12:00:00Z') : new Date(), reference: b.reference, note: b.note, receivedBy: req.user!.id
  });
  await audit(req, 'fee.payment_recorded', 'fee_voucher', id, { paymentId: p._id, amountMinor: b.amountMinor, method: b.method });
  ok(res, p, undefined, 201);
}));

feesRouter.get('/vouchers/:id/pdf', can('fees.view'), h(async (req, res) => {
  const v = await FeeVoucher.findOne({ _id: idParam(req.params.id), deletedAt: null }).lean();
  if (!v) throw notFound();
  const [st, room] = await Promise.all([Student.findById(v.studentId).lean(), Classroom.findById(v.classroomId).select('name').lean()]);
  const pdf = await renderVoucherPdf({ voucher: v, student: st!, className: room?.name ?? '' }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="voucher-${v.voucherNumber}.pdf"`);
  res.send(pdf);
}));

// ------------------------------------------------------------------ Payments
feesRouter.get('/payments', can('fees.view'), h(async (req, res) => {
  const q = parse(z.object({
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25),
    from: isoDate.optional(), to: isoDate.optional(), method: z.enum(['cash', 'bank_transfer', 'cheque', 'online']).optional(), studentId: z.string().uuid().optional()
  }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null };
  if (q.from || q.to) filter.paidAt = $cmp({ gte: q.from ? new Date(q.from + 'T00:00:00Z') : undefined, lte: q.to ? new Date(q.to + 'T23:59:59.999Z') : undefined });
  if (q.method) filter.method = q.method;
  if (q.studentId) filter.studentId = q.studentId;
  const { skip, limit } = pageArgs(q);
  const [items, total, sum] = await Promise.all([
    FeePayment.find(filter).sort({ paidAt: -1 }).skip(skip).limit(limit).lean(),
    FeePayment.countDocuments(filter),
    FeePayment.aggregate<{ _id: null; amount: number }>([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amountMinor' } } }])
  ]);
  const students = await Student.find({ _id: $in(items.map((i) => i.studentId)) }).select('fullName admissionNumber').lean();
  const vouchers = await FeeVoucher.find({ _id: $in(items.map((i) => i.voucherId)) }).select('voucherNumber title').lean();
  ok(res, {
    items: items.map((p) => ({ ...p, studentName: students.find((s) => s._id === p.studentId)?.fullName, voucherNumber: vouchers.find((v) => v._id === p.voucherId)?.voucherNumber, voucherTitle: vouchers.find((v) => v._id === p.voucherId)?.title })),
    totalAmountMinor: sum[0]?.amount ?? 0
  }, { page: q.page, pageSize: q.pageSize, total });
}));

feesRouter.get('/payments/:id/receipt', can('fees.view'), h(async (req, res) => {
  const p = await FeePayment.findOne({ _id: idParam(req.params.id), deletedAt: null }).lean();
  if (!p) throw notFound();
  const v = (await FeeVoucher.findById(p.voucherId).lean())!;
  const [st, room, by] = await Promise.all([Student.findById(p.studentId).lean(), Classroom.findById(v.classroomId).select('name').lean(), p.receivedBy ? User.findById(p.receivedBy).select('fullName').lean() : null]);
  const pdf = await renderReceiptPdf({ payment: p, voucher: v, student: st!, className: room?.name ?? '', receivedByName: by?.fullName }, await getSettings());
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt-${p.receiptNumber}.pdf"`);
  res.send(pdf);
}));

feesRouter.get('/summary', canAny('fees.view', 'analytics.view'), h(async (_req, res) => {
  const t = await today();
  const [byStatus, overdue, monthPaid] = await Promise.all([
    FeeVoucher.aggregate<{ _id: string; n: number; total: number; paid: number }>([{ $match: { deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 }, total: { $sum: '$totalMinor' }, paid: { $sum: '$paidMinor' } } }]),
    FeeVoucher.aggregate<{ _id: null; n: number; due: number }>([{ $match: { deletedAt: null, status: $in(['unpaid', 'partial']), dueDate: $cmp({ lt: t }) } }, { $group: { _id: null, n: { $sum: 1 }, due: { $sum: { $subtract: ['$totalMinor', '$paidMinor'] } } } }]),
    FeePayment.aggregate<{ _id: null; amount: number }>([{ $match: { deletedAt: null, paidAt: $cmp({ gte: new Date(t.slice(0, 8) + '01T00:00:00Z') }) } }, { $group: { _id: null, amount: { $sum: '$amountMinor' } } }])
  ]);
  const open = byStatus.filter((x) => x._id === 'unpaid' || x._id === 'partial');
  ok(res, {
    currency: (await getSettings()).fees?.currency ?? 'PKR',
    byStatus, outstandingMinor: open.reduce((a, x) => a + x.total - x.paid, 0),
    overdueCount: overdue[0]?.n ?? 0, overdueMinor: overdue[0]?.due ?? 0, collectedThisMonthMinor: monthPaid[0]?.amount ?? 0
  });
}));

// ------------------------------------------------------------------ Settings, provider, reminders
feesRouter.get('/settings', can('fees.view'), h(async (_req, res) => {
  const s = await getSettings();
  const cfg = await getPaymentConfig();
  ok(res, {
    fees: s.fees,
    provider: {
      provider: cfg.provider, source: cfg.source, currency: cfg.currency, problems: paymentProblems(cfg), configured: paymentProblems(cfg).length === 0,
      stripe: cfg.stripe ? { secretKeySet: Boolean(cfg.stripe.secretKey), mode: cfg.stripe.secretKey.startsWith('sk_live') || cfg.stripe.secretKey.startsWith('rk_live') ? 'live' : cfg.stripe.secretKey ? 'test' : null, webhookSecretSet: Boolean(cfg.stripe.webhookSecret) } : null,
      webhookUrl: `${env.APP_URL}/api/webhooks/payments/${cfg.provider === 'none' ? 'stripe' : cfg.provider}`
    }
  });
}));

feesRouter.patch('/settings', can('fees.manage'), h(async (req, res) => {
  const b = parse(feeSettingsSchema, req.body);
  const s = await getSettings();
  const r = await updateVersioned(SchoolSettings, 'school', { fees: { ...(s.fees ?? {}), ...b } });
  invalidateSettings();
  await audit(req, 'fee.settings_updated', 'settings', 'school', b);
  ok(res, r.fees);
}));

feesRouter.put('/provider', can('payments.configure'), h(async (req, res) => {
  const b = parse(paymentProviderSchema, req.body);
  const cur = await getPaymentConfig();
  const value = b.provider === 'none'
    ? { provider: 'none', currency: cur.currency }
    : { provider: 'stripe', currency: b.currency, stripe: { secretKey: b.secretKey || cur.stripe?.secretKey || '', webhookSecret: b.webhookSecret || cur.stripe?.webhookSecret || '' } };
  const problems = paymentProblems({ ...(value as Omit<Parameters<typeof paymentProblems>[0], 'source'>), source: 'dashboard' });
  if (b.provider !== 'none' && problems.length) throw badRequest(`Incomplete payment settings: ${problems.join('; ')}`);
  await SecretSettings.updateOne({ _id: 'payments' }, { $set: { ...encryptJson(value), updatedBy: req.user!.id } }, { upsert: true });
  await audit(req, 'payments.provider_updated', 'payment_provider', b.provider);
  ok(res, { saved: true });
}));

feesRouter.delete('/provider', can('payments.configure'), h(async (req, res) => {
  await SecretSettings.deleteOne({ _id: 'payments' });
  await audit(req, 'payments.provider_cleared', 'payment_provider');
  ok(res, { cleared: true, nowUsing: 'environment' });
}));

feesRouter.post('/reminders/run', can('fees.manage'), h(async (req, res) => {
  const r = await queueFeeReminders({ force: true, actorId: req.user!.id });
  await audit(req, 'fee.reminders_queued', 'fee_voucher', undefined, r);
  ok(res, r);
}));

// ------------------------------------------------------------------ Provider callbacks (public, signed)
export const paymentWebhookRouter = Router();
const webhookLimiter = rateLimit({ windowMs: 60_000, limit: isTest ? 10_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false });

paymentWebhookRouter.post('/:provider', webhookLimiter, h(async (req, res) => {
  const provider = z.string().regex(/^[a-z]{2,20}$/).safeParse(req.params.provider);
  if (!provider.success) throw notFound();
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  const r = await handlePaymentWebhook(provider.data, raw, req.headers);
  logger.info({ provider: provider.data, outcome: r.outcome }, 'payment webhook processed');
  res.status(200).json({ received: true });
}));
