import type { FeeVoucherStatus } from '../constants.js';

/**
 * Money is stored as integer MINOR units (paisa / cents) everywhere, so sums never suffer from
 * floating-point rounding. These helpers are the only place that converts to and from display units.
 */
export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new RangeError('Amount must be a finite number');
  return Math.round(major * 100);
}

export function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

export function formatMoney(minor: number, currency = 'PKR', locale = 'en-PK'): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(fromMinor(minor));
  } catch {
    return `${currency} ${fromMinor(minor).toFixed(2)}`;
  }
}

export interface FeeLine { label: string; amountMinor: number }

export function voucherTotal(items: readonly FeeLine[], lateFeeMinor = 0, discountMinor = 0): number {
  const sum = items.reduce((a, i) => a + i.amountMinor, 0) + lateFeeMinor - discountMinor;
  return Math.max(0, sum);
}

/** Voucher state derived from the verified amount paid. A cancelled voucher stays cancelled. */
export function feeStatus(totalMinor: number, paidMinor: number, cancelled = false): FeeVoucherStatus {
  if (cancelled) return 'cancelled';
  if (paidMinor <= 0) return totalMinor === 0 ? 'paid' : 'unpaid';
  if (paidMinor >= totalMinor) return 'paid';
  return 'partial';
}

export function balanceMinor(totalMinor: number, paidMinor: number): number {
  return Math.max(0, totalMinor - paidMinor);
}

/**
 * Validates a payment amount the school or a parent is ABOUT to make. Partial payments are accepted
 * only when the voucher allows them; overpayment is refused. (An online payment the provider has
 * already captured is always recorded — money was taken — and an overpayment is flagged for refund.)
 */
export function checkPaymentAmount(amountMinor: number, totalMinor: number, paidMinor: number, allowPartial: boolean): string | null {
  const balance = balanceMinor(totalMinor, paidMinor);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 'Amount must be greater than zero';
  if (balance === 0) return 'This voucher is already fully paid';
  if (amountMinor > balance) return 'Amount is more than the outstanding balance';
  if (!allowPartial && amountMinor !== balance) return 'This voucher must be paid in full';
  return null;
}

/** Due-reminder window: unpaid/partial vouchers due within `daysBefore` days, or already overdue. */
export function isDueForReminder(dueDate: string, today: string, daysBefore: number): boolean {
  const due = Date.parse(dueDate + 'T00:00:00Z');
  const now = Date.parse(today + 'T00:00:00Z');
  return due - now <= daysBefore * 86_400_000;
}
