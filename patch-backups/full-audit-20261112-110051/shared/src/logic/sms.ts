/** SMS template rendering, phone normalisation and de-duplication keys. Dependency-free. */

export const TEMPLATE_VARIABLES = ['studentName', 'schoolName', 'status', 'date', 'className', 'guardianName'] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** Replaces {{var}} placeholders. Unknown placeholders are left visible so mistakes are noticed. */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v === undefined ? whole : v;
  });
}

export function unknownPlaceholders(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(m[1]!)) out.add(m[1]!);
  }
  return [...out];
}

/** GSM-7 vs UCS-2 (Urdu) segment counting, for usage reporting. */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; segments: number } {
  // eslint-disable-next-line no-control-regex
  const gsm = /^[\n\r\x20-\x7E£¥èéùìòÇØøÅå_ÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[\]~|]*$/.test(text);
  if (gsm) return { encoding: 'GSM-7', segments: text.length <= 160 ? 1 : Math.ceil(text.length / 153) };
  const len = [...text].length;
  return { encoding: 'UCS-2', segments: len <= 70 ? 1 : Math.ceil(len / 67) };
}

/**
 * Normalise to E.164. Default country code applies to local formats such as 03001234567 (PK).
 * Returns null when the number cannot be a valid E.164 number.
 */
export function normalizePhone(raw: string, defaultCountryCode = '92'): string | null {
  let s = raw.replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (s.startsWith('0')) s = '+' + defaultCountryCode + s.slice(1);
    else if (s.startsWith(defaultCountryCode)) s = '+' + s;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** One alert per student, per date, per event, per recipient. */
export function smsDedupeKey(studentId: string, date: string, event: string, phone: string): string {
  return `${studentId}:${date}:${event}:${phone}`;
}
