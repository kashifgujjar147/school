import { z } from 'zod';
import { MANUAL_PAYMENT_METHODS, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, FEE_VOUCHER_STATUSES } from '../constants.js';
import { isoDate, passwordSchema, uuid } from './index.js';

/** v1.2 request validation: parent portal, fees, exams, homework, feedback, ID cards, analytics. */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
/** Amounts arrive in MINOR units (integer paisa/cents). The UI converts from rupees before sending. */
const minor = z.number().int().min(0).max(10_000_000_000);
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the month format YYYY-MM, e.g. 2026-11');

// ---------------------------------------------------------------- Parent accounts
export const parentAccountSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  /** Omit to have the server generate a strong one-time password. */
  password: passwordSchema.optional()
});

// ---------------------------------------------------------------- Fees
export const feeLineSchema = z.object({ label: trimmed(80), amountMinor: minor });
const voucherBase = {
  title: trimmed(120),
  period: periodSchema,
  dueDate: isoDate,
  issueDate: isoDate.optional(),
  items: z.array(feeLineSchema).min(1).max(20),
  lateFeeMinor: minor.default(0),
  discountMinor: minor.default(0),
  allowPartial: z.boolean().default(false),
  notes: optText(500)
};
export const voucherCreateSchema = z.object({ studentId: uuid, ...voucherBase });
export const voucherBulkSchema = z.object({ classroomId: uuid, ...voucherBase });
export const voucherListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  studentId: uuid.optional(), classroomId: uuid.optional(),
  status: z.enum(FEE_VOUCHER_STATUSES).optional(), period: periodSchema.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sort: z.enum(['dueDate', '-dueDate', 'createdAt', '-createdAt', 'totalMinor', '-totalMinor']).optional()
});
export const manualPaymentSchema = z.object({
  amountMinor: minor.refine((v) => v > 0, 'Amount must be greater than zero'),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: optText(80),
  paidAt: isoDate.optional(),
  note: optText(300)
});
export const paymentProviderSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('none') }),
  z.object({
    provider: z.literal('stripe'),
    // Blank = keep the stored secret (secrets are never sent back to the browser).
    secretKey: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/, 'Expected a Stripe secret key (sk_live_… / sk_test_…)').or(z.literal('')).optional(),
    webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]{10,}$/, 'Expected a Stripe webhook signing secret (whsec_…)').or(z.literal('')).optional(),
    currency: z.string().regex(/^[a-z]{3}$/i).transform((v) => v.toLowerCase())
  })
]);
export const feeSettingsSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  reminderDaysBefore: z.number().int().min(0).max(60),
  remindersEnabled: z.boolean(),
  voucherFooter: optText(300),
  /** Message for the free WhatsApp (click-to-chat) fee reminders. Placeholders: see FEE_WHATSAPP_FIELDS. */
  whatsappTemplate: optText(1000)
}).partial();

// ---------------------------------------------------------------- Exams & results
export const examSchema = z.object({
  name: trimmed(120), term: optText(60), startDate: isoDate, endDate: isoDate.optional().nullable()
}).refine((v) => !v.endDate || v.startDate <= v.endDate, { message: 'startDate must be before endDate', path: ['endDate'] });
export const resultEntrySchema = z.object({
  studentId: uuid,
  marksObtained: z.number().min(0).max(10_000).nullable(),
  absent: z.boolean().default(false),
  remarks: optText(200)
});
export const resultsSaveSchema = z.object({
  classroomId: uuid, subject: trimmed(80), maxMarks: z.number().positive().max(10_000),
  entries: z.array(resultEntrySchema).min(1).max(1000)
}).superRefine((v, ctx) => {
  v.entries.forEach((e, i) => {
    if (!e.absent && e.marksObtained === null) ctx.addIssue({ code: 'custom', path: ['entries', i, 'marksObtained'], message: 'Marks required unless absent' });
    if (e.marksObtained !== null && e.marksObtained > v.maxMarks) ctx.addIssue({ code: 'custom', path: ['entries', i, 'marksObtained'], message: 'Marks exceed maximum' });
  });
});

// ---------------------------------------------------------------- Homework & feedback
export const homeworkSchema = z.object({
  classroomId: uuid, subject: trimmed(80), title: trimmed(160), description: optText(4000),
  assignedDate: isoDate, dueDate: isoDate, notifyParents: z.boolean().default(true)
}).refine((v) => v.assignedDate <= v.dueDate, { message: 'Due date must be on or after the assigned date', path: ['dueDate'] });
export const homeworkUpdateSchema = z.object({
  subject: trimmed(80), title: trimmed(160), description: optText(4000), assignedDate: isoDate, dueDate: isoDate
}).partial();
export const FEEDBACK_CATEGORIES = ['academic', 'behaviour', 'attendance', 'general'] as const;
export const feedbackSchema = z.object({
  studentId: uuid, category: z.enum(FEEDBACK_CATEGORIES).default('general'),
  body: trimmed(2000), visibleToParents: z.boolean().default(true)
});

// ---------------------------------------------------------------- Notifications (v1.2)
export const notificationPrefsSchema = z.object({
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(NOTIFICATION_CHANNELS.length),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).max(NOTIFICATION_EVENTS.length)
}).partial();
export const whatsappProviderSchema = z.object({
  enabled: z.boolean(),
  // Blank = keep the stored value.
  accessToken: z.string().min(20).max(1000).or(z.literal('')).optional(),
  phoneNumberId: z.string().regex(/^\d{5,30}$/).or(z.literal('')).optional(),
  appSecret: z.string().min(16).max(200).or(z.literal('')).optional(),
  verifyToken: z.string().min(16).max(200).or(z.literal('')).optional(),
  templateName: z.string().regex(/^[a-z0-9_]{1,512}$/).or(z.literal('')).optional(),
  templateLanguage: z.string().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).default('en'),
  apiVersion: z.string().regex(/^v\d{2}\.\d$/).default('v21.0')
});
export const broadcastSchema = z.object({
  title: trimmed(160), body: trimmed(600),
  /** Empty = whole school. */
  classroomIds: z.array(uuid).max(500).default([])
});

// ---------------------------------------------------------------- Analytics
export const analyticsQuerySchema = z.object({
  from: isoDate, to: isoDate, classId: uuid.optional()
}).refine((v) => v.from <= v.to, { message: 'from must be <= to' })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 3 * 366 * 86_400_000, { message: 'Range is limited to three years' });

export type VoucherCreateInput = z.infer<typeof voucherCreateSchema>;
export type ResultsSaveInput = z.infer<typeof resultsSaveSchema>;
export type HomeworkInput = z.infer<typeof homeworkSchema>;
