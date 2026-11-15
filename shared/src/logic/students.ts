/** Duplicate-student detection used by registration and CSV/Excel import. */

export interface StudentIdentity {
  admissionNumber?: string | null;
  fullName: string;
  dateOfBirth?: string | null; // YYYY-MM-DD
  guardianPhone?: string | null;
}

export function normalizeName(n: string): string {
  return n.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export type DuplicateMatch = { level: 'exact'; field: 'admissionNumber' } | { level: 'likely'; reason: string } | null;

export function matchDuplicate(candidate: StudentIdentity, existing: StudentIdentity): DuplicateMatch {
  if (candidate.admissionNumber && existing.admissionNumber &&
      candidate.admissionNumber.trim().toLowerCase() === existing.admissionNumber.trim().toLowerCase()) {
    return { level: 'exact', field: 'admissionNumber' };
  }
  const sameName = normalizeName(candidate.fullName) === normalizeName(existing.fullName);
  if (sameName && candidate.dateOfBirth && candidate.dateOfBirth === existing.dateOfBirth) {
    return { level: 'likely', reason: 'same name and date of birth' };
  }
  if (sameName && candidate.guardianPhone && candidate.guardianPhone === existing.guardianPhone) {
    return { level: 'likely', reason: 'same name and guardian phone' };
  }
  return null;
}
