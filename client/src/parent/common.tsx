import { formatMoney } from '@sms/shared';
import { useLang } from '../i18n';

/** Money is always handled in integer minor units; this only formats for display. */
export function useMoney() {
  const lang = useLang((s) => s.lang);
  return (minor: number | null | undefined, currency = 'PKR') => (minor === null || minor === undefined ? '—' : formatMoney(minor, currency.toUpperCase(), lang === 'ur' ? 'ur-PK-u-nu-latn' : 'en-PK'));
}

export interface ChildSummary {
  _id: string; fullName: string; admissionNumber: string; photoPath?: string; status: string; classroomId: string;
  classroomName: string; className: string; sectionName: string; sessionName: string;
}

export interface ResultExam {
  examId: string; name: string; term: string | null; startDate: string; publishedAt: string;
  rows: { subject: string; maxMarks: number; marksObtained: number | null; absent: boolean; remarks: string | null }[];
  summary: { max: number; obtained: number; percent: number | null; grade: string; passed: boolean; failedSubjects: number };
}

export interface Voucher {
  _id: string; voucherNumber: string; title: string; period: string; issueDate: string; dueDate: string;
  items: { label: string; amountMinor: number }[]; lateFeeMinor: number; discountMinor: number; totalMinor: number; paidMinor: number;
  balanceMinor: number; status: string; allowPartial: boolean; currency: string; overdue?: boolean; notes?: string;
}

export interface Payment { _id: string; receiptNumber: string; voucherId: string; amountMinor: number; overpaidMinor?: number; currency: string; method: string; provider?: string | null; paidAt: string }

export function Avatar({ name, photo, size = 'h-12 w-12' }: { name: string; photo?: string | null; size?: string }) {
  if (photo) return <img src={photo} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return <div className={`${size} flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand`} aria-hidden>{initials}</div>;
}
