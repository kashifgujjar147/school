import type { AttendanceStatus } from '../constants.js';

export interface StatusCounts { present: number; absent: number; late: number; leave: number; total: number }

export function countStatuses(statuses: AttendanceStatus[]): StatusCounts {
  const c: StatusCounts = { present: 0, absent: 0, late: 0, leave: 0, total: statuses.length };
  for (const s of statuses) c[s]++;
  return c;
}

/**
 * Attendance percentage. By default late counts as attended and leave is excluded from the
 * denominator (configurable per school via attendance policy).
 */
export function attendancePercent(
  c: Omit<StatusCounts, 'total'>,
  policy: { lateCountsAsPresent: boolean; excludeLeaveFromTotal: boolean } = {
    lateCountsAsPresent: true,
    excludeLeaveFromTotal: true
  }
): number | null {
  const attended = c.present + (policy.lateCountsAsPresent ? c.late : 0);
  const denom = c.present + c.absent + c.late + (policy.excludeLeaveFromTotal ? 0 : c.leave);
  if (denom === 0) return null;
  return Math.round((attended / denom) * 1000) / 10;
}

/** YYYY-MM-DD in the school's IANA time zone. */
export function schoolDate(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA yields YYYY-MM-DD
}

/** Minutes after midnight in the school time zone. */
export function schoolMinutes(d: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

export function parseHHMM(s: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) throw new Error(`Invalid time ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export type DayCheck = { ok: true } | { ok: false; reason: 'not_working_day' | 'holiday' | 'future_date' | 'after_cutoff' };

/**
 * Whether attendance may be submitted for `date` (YYYY-MM-DD) at `now`.
 * workingDays uses 0=Sunday..6=Saturday.
 */
export function canSubmitForDate(args: {
  date: string;
  now: Date;
  timeZone: string;
  workingDays: number[];
  holidays: string[];
  cutoffTime?: string | null; // HH:MM, applies to same-day submission only
  allowBackdatedDays: number;
}): DayCheck {
  const today = schoolDate(args.now, args.timeZone);
  if (args.date > today) return { ok: false, reason: 'future_date' };
  const dow = new Date(args.date + 'T12:00:00Z').getUTCDay();
  if (!args.workingDays.includes(dow)) return { ok: false, reason: 'not_working_day' };
  if (args.holidays.includes(args.date)) return { ok: false, reason: 'holiday' };
  if (args.date === today && args.cutoffTime) {
    if (schoolMinutes(args.now, args.timeZone) > parseHHMM(args.cutoffTime)) return { ok: false, reason: 'after_cutoff' };
  }
  if (args.date < today) {
    const diffDays = Math.round((Date.parse(today) - Date.parse(args.date)) / 86_400_000);
    if (diffDays > args.allowBackdatedDays) return { ok: false, reason: 'after_cutoff' };
  }
  return { ok: true };
}

/** Lists the working dates in [from, to] inclusive, excluding holidays. */
export function workingDatesBetween(from: string, to: string, workingDays: number[], holidays: string[]): string[] {
  const out: string[] = [];
  const hol = new Set(holidays);
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (workingDays.includes(d.getUTCDay()) && !hol.has(iso)) out.push(iso);
  }
  return out;
}
