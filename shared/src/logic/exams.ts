/** Grading used on result sheets and report cards. Pure and dependency-free. */

export const PASS_PERCENT = 40;

export const GRADE_BANDS: readonly { min: number; grade: string }[] = [
  { min: 90, grade: 'A+' }, { min: 80, grade: 'A' }, { min: 70, grade: 'B' }, { min: 60, grade: 'C' },
  { min: 50, grade: 'D' }, { min: 40, grade: 'E' }, { min: 0, grade: 'F' }
];

export function percentOf(obtained: number, max: number): number | null {
  if (!(max > 0)) return null;
  return Math.round((obtained / max) * 1000) / 10;
}

export function gradeFor(percent: number | null): string {
  if (percent === null) return '—';
  return GRADE_BANDS.find((b) => percent >= b.min)?.grade ?? 'F';
}

export interface SubjectMark { subject: string; maxMarks: number; marksObtained: number | null; absent?: boolean }

/** Totals for a report card. Absent subjects count as zero marks (they stay part of the total). */
export function summariseMarks(rows: readonly SubjectMark[]) {
  const max = rows.reduce((a, r) => a + r.maxMarks, 0);
  const obtained = rows.reduce((a, r) => a + (r.absent ? 0 : r.marksObtained ?? 0), 0);
  const percent = percentOf(obtained, max);
  const failedSubjects = rows.filter((r) => (percentOf(r.absent ? 0 : r.marksObtained ?? 0, r.maxMarks) ?? 0) < PASS_PERCENT).length;
  return { max, obtained, percent, grade: gradeFor(percent), passed: rows.length > 0 && failedSubjects === 0, failedSubjects };
}
