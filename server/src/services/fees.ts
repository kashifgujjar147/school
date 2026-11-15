import { randomBytes } from 'node:crypto';
import { balanceMinor, checkPaymentAmount, feeStatus, formatMoney, schoolDate, type PaymentMethod } from '@sms/shared';
import { withTransaction } from '../config/db.js';
import { FeePayment, FeeVoucher, Student } from '../models/index.js';
import { AppError, badRequest, conflict, notFound } from '../utils/http.js';
import { createVersioned, updateVersioned } from './repo.js';
import { getSettings } from './settings.js';
import { enqueueStudentEvent } from './notifications.js';
import { logger } from '../utils/logger.js';
import { $cmp, $in } from '../utils/query.js';

/** Unambiguous upper-case alphabet (no 0/O, 1/I). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return s;
}

/**
 * Voucher / receipt numbers are random rather than sequential, so two offline nodes can issue
 * numbers at the same time without colliding (the unique index is the final guard).
 */
export const newVoucherNumber = (period: string) => `FV-${period.replace('-', '')}-${randomCode(6)}`;
export const newReceiptNumber = (when: Date) => `RC-${when.toISOString().slice(2, 10).replace(/-/g, '')}-${randomCode(6)}`;

export interface ApplyPaymentInput {
  voucherId: string;
  amountMinor: number;
  method: PaymentMethod;
  paidAt: Date;
  /** Manual payments are checked against the balance and partial rules; captured online payments are always recorded. */
  enforceRules: boolean;
  provider?: string | null;
  transactionRef?: string | null;
  intentId?: string | null;
  reference?: string | null;
  note?: string | null;
  receivedBy?: string | null;
}

/**
 * Records a VERIFIED payment and updates the voucher in one transaction (when the database supports
 * transactions). Duplicate processing is impossible: an online payment's provider reference and
 * intent id are unique in feepayments, and the voucher update uses optimistic versioning.
 */
export async function applyPayment(input: ApplyPaymentInput) {
  const payment = await withTransaction(async (session) => {
    const v = await FeeVoucher.findOne({ _id: input.voucherId, deletedAt: null }).session(session ?? null).lean();
    if (!v) throw notFound('Voucher not found');
    if (input.enforceRules) {
      if (v.status === 'cancelled') throw conflict('This voucher has been cancelled');
      const err = checkPaymentAmount(input.amountMinor, v.totalMinor, v.paidMinor, v.allowPartial);
      if (err) throw badRequest(err);
    }
    const overpaidMinor = Math.max(0, input.amountMinor - balanceMinor(v.totalMinor, v.paidMinor));
    const doc = await createVersioned(FeePayment, {
      receiptNumber: newReceiptNumber(input.paidAt), voucherId: v._id, studentId: v.studentId,
      amountMinor: input.amountMinor, overpaidMinor, currency: v.currency, method: input.method, status: 'succeeded',
      provider: input.provider ?? null, transactionRef: input.transactionRef ?? null, intentId: input.intentId ?? null,
      reference: input.reference ?? undefined, note: input.note ?? undefined, paidAt: input.paidAt, receivedBy: input.receivedBy ?? undefined
    }, { session });
    // Re-read inside the loop: in a transaction a concurrent write aborts and retries the whole
    // function; without one, a version conflict is retried here so the paid total is never lost.
    for (let attempt = 0; ; attempt++) {
      const cur = await FeeVoucher.findById(v._id).session(session ?? null).lean();
      const paid = cur!.paidMinor + input.amountMinor;
      try {
        await updateVersioned(FeeVoucher, v._id, { paidMinor: paid, status: feeStatus(cur!.totalMinor, paid, cur!.status === 'cancelled') }, { session }, cur!.version);
        break;
      } catch (e) {
        if (session || !(e instanceof AppError) || e.status !== 409 || attempt >= 4) throw e;
      }
    }
    return doc.toObject();
  });
  void notifyPaymentReceived(payment._id).catch((err) => logger.error({ err }, 'fee_paid notification failed'));
  return payment;
}

export async function notifyPaymentReceived(paymentId: string) {
  const p = await FeePayment.findById(paymentId).lean();
  if (!p) return;
  const s = await getSettings();
  await enqueueStudentEvent({
    event: 'fee_paid', studentIds: [p.studentId], key: `pay:${p._id}`, refId: p._id,
    vars: () => ({ amount: formatMoney(p.amountMinor, p.currency), receiptNumber: p.receiptNumber, date: schoolDate(p.paidAt, s.timeZone) })
  });
}

/** Queues due/overdue reminders (once per voucher before the due date, once after it). */
export async function queueFeeReminders(opts: { force?: boolean; actorId?: string } = {}) {
  const s = await getSettings();
  if (!opts.force && !s.fees?.remindersEnabled) return { queued: 0, vouchers: 0, reason: 'reminders_disabled' };
  const today = schoolDate(new Date(), s.timeZone);
  const horizon = new Date(Date.parse(today + 'T00:00:00Z') + (s.fees?.reminderDaysBefore ?? 3) * 86_400_000).toISOString().slice(0, 10);
  const vouchers = await FeeVoucher.find({ deletedAt: null, status: $in(['unpaid', 'partial']), dueDate: $cmp({ lte: horizon }) })
    .select('studentId voucherNumber totalMinor paidMinor currency dueDate').limit(5000).lean();
  let queued = 0;
  for (const v of vouchers) {
    const phase = v.dueDate < today ? 'overdue' : 'due';
    const r = await enqueueStudentEvent({
      event: 'fee_due', studentIds: [v.studentId], key: `fee:${v._id}:${phase}`, refId: v._id, actorId: opts.actorId,
      vars: () => ({ amount: formatMoney(balanceMinor(v.totalMinor, v.paidMinor), v.currency), voucherNumber: v.voucherNumber, dueDate: v.dueDate })
    });
    queued += r.queued;
    if (r.reason === 'event_disabled' || r.reason === 'starter_package') return { queued, vouchers: vouchers.length, reason: r.reason };
  }
  return { queued, vouchers: vouchers.length, reason: null };
}

/** Student placement used when issuing vouchers. */
export async function studentPlacement(studentId: string) {
  const st = await Student.findOne({ _id: studentId, deletedAt: null }).lean();
  if (!st) throw notFound('Student not found');
  return st;
}
