import { normalizePhone, whatsappRecipient } from '@sms/shared';
import { AuditLog, Guardian, Student, StudentGuardian } from '../models/index.js';
import { $in } from '../utils/query.js';

export interface ParentContact { parentName: string; phone: string | null; whatsapp: string | null }

/**
 * The parent to message for each student: the primary guardian, then any guardian who receives
 * alerts, then the phone saved on the student record (primary guardian phone / emergency contact).
 * `whatsapp` is the international number without "+" for a wa.me link, or null when unusable.
 */
export async function parentContacts(studentIds: string[], countryCode = '92'): Promise<Map<string, ParentContact>> {
  const [students, links] = await Promise.all([
    Student.find({ _id: $in(studentIds) }).select('primaryGuardianPhone emergencyContactName emergencyContactPhone').lean(),
    StudentGuardian.find({ studentId: $in(studentIds), deletedAt: null }).lean()
  ]);
  const guardians = await Guardian.find({ _id: $in([...new Set(links.map((l) => l.guardianId))]), deletedAt: null }).select('fullName phone').lean();
  const out = new Map<string, ParentContact>();
  for (const s of students) {
    const mine = links.filter((l) => l.studentId === s._id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(b.receivesAlerts) - Number(a.receivesAlerts));
    const g = mine.map((l) => guardians.find((x) => x._id === l.guardianId)).find((x) => x?.phone);
    const phone = g?.phone ?? s.primaryGuardianPhone ?? s.emergencyContactPhone ?? null;
    const e164 = phone ? normalizePhone(phone, countryCode) : null;
    out.set(s._id, { parentName: g?.fullName ?? s.emergencyContactName ?? '', phone, whatsapp: e164 ? whatsappRecipient(e164) : null });
  }
  return out;
}

/** When a free WhatsApp message (`action`) was last opened for each student, optionally for one date. */
export async function lastWhatsappSent(action: string, studentIds: string[], date?: string): Promise<Map<string, Date>> {
  const match: Record<string, unknown> = { action, entity: 'student', entityId: $in(studentIds) };
  if (date) match['detail.date'] = date;
  const rows = await AuditLog.aggregate<{ _id: string; at: Date }>([{ $match: match }, { $group: { _id: '$entityId', at: { $max: '$at' } } }]);
  return new Map(rows.map((r) => [r._id, r.at]));
}
