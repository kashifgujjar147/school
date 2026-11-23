/**
 * Free WhatsApp messages to parents when a child is absent or late (click-to-chat, no API; see
 * whatsappLink in fees.ts). The school edits the wording; these are the defaults.
 */
export const ATTENDANCE_WHATSAPP_FIELDS = ['parent', 'student', 'class', 'date', 'time', 'school'] as const;
export type AttendanceWhatsappValues = Record<(typeof ATTENDANCE_WHATSAPP_FIELDS)[number], string>;
export type AlertStatus = 'absent' | 'late';

export const DEFAULT_ATTENDANCE_WHATSAPP: Record<AlertStatus, string> = {
  absent: [
    'Assalam-o-Alaikum {parent},',
    '',
    '{student} ({class}) is absent from school today, {date}.',
    'If your child is unwell or on leave, please inform the school office. Thank you.',
    '',
    'محترم والدین، {student} ({class}) آج {date} کو اسکول سے غیر حاضر ہے۔ براہِ کرم وجہ سے اسکول آفس کو آگاہ کریں۔ شکریہ',
    '{school}'
  ].join('\n'),
  late: [
    'Assalam-o-Alaikum {parent},',
    '',
    '{student} ({class}) arrived late to school today, {date}, at {time}.',
    'Please help your child reach school on time. Thank you.',
    '',
    'محترم والدین، {student} ({class}) آج {date} کو {time} بجے اسکول دیر سے پہنچا۔ براہِ کرم وقت کی پابندی کروائیں۔ شکریہ',
    '{school}'
  ].join('\n')
};

/** Fills {placeholders}; falls back to the default message when the school has not written one. */
export function renderAttendanceWhatsapp(status: AlertStatus, template: string | null | undefined, values: AttendanceWhatsappValues): string {
  const tpl = template && template.trim() ? template : DEFAULT_ATTENDANCE_WHATSAPP[status];
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => ((ATTENDANCE_WHATSAPP_FIELDS as readonly string[]).includes(k) ? values[k as keyof AttendanceWhatsappValues] : m));
}
