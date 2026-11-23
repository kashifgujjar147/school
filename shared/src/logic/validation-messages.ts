import { z, type ZodError, type ZodErrorMap, type ZodIssue } from 'zod';

/**
 * Plain-language validation messages for non-technical staff: every message says what is wrong and,
 * for format problems, shows an example of the correct format. Used by the API (every 400 names the
 * field and the problem) and by the dashboard forms (same zod instance).
 */

/** Human names for field keys used across the forms. Unknown keys are turned into words ("dueDate" → "Due date"). */
const LABELS: Record<string, string> = {
  admissionNumber: 'Admission no.', fullName: 'Full name', dateOfBirth: 'Date of birth', admissionDate: 'Admission date',
  classroomId: 'Classroom', classId: 'Class', sectionId: 'Section', sessionId: 'Academic session', studentId: 'Student',
  emergencyContactName: 'Emergency contact', emergencyContactPhone: 'Emergency phone', parentName: 'Parent name',
  whatsappNumber: 'Parent WhatsApp number', phone: 'Phone', altPhone: 'Other phone', email: 'Email', username: 'Username',
  password: 'Password', newPassword: 'New password', currentPassword: 'Current password', role: 'Role',
  title: 'Title', period: 'Month', dueDate: 'Due date', issueDate: 'Issue date', items: 'Fee items', label: 'Description',
  amountMinor: 'Amount', lateFeeMinor: 'Late fee', discountMinor: 'Discount', paidAt: 'Payment date', method: 'Payment method',
  reference: 'Reference', notes: 'Notes', reason: 'Reason', subject: 'Subject', maxMarks: 'Maximum marks', marksObtained: 'Marks',
  startDate: 'Start date', endDate: 'End date', assignedDate: 'Assigned date', date: 'Date', from: 'From', to: 'To',
  name: 'Name', relation: 'Relation', address: 'Address', currency: 'Currency', slug: 'Page address', url: 'Web address',
  primaryColor: 'Main colour', accentColor: 'Accent colour', defaultCountryCode: 'Country code', arrivalTime: 'Arrival time',
  remark: 'Remark', description: 'Description', body: 'Message', whatsappTemplate: 'WhatsApp message', voucherFooter: 'Voucher footer',
  reminderDaysBefore: 'Reminder days before due date', order: 'Order', code: 'Code', term: 'Term'
};

export function fieldLabel(path: readonly (string | number)[] | string): string {
  const parts = typeof path === 'string' ? path.split('.') : path.map(String);
  const key = [...parts].reverse().find((p) => !/^\d+$/.test(p)) ?? '';
  const row = parts.find((p) => /^\d+$/.test(p));
  const base = LABELS[key] ?? (key.replace(/Id$/, '').replace(/Minor$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) || 'This field');
  return row !== undefined ? `${base} (line ${Number(row) + 1})` : base;
}

/** Correct-format examples by field key, used when a value has the wrong shape. */
const EXAMPLES: Record<string, string> = {
  username: 'use 3–40 small letters, numbers, dot, dash or underscore, e.g. ali.khan',
  currency: 'use the 3-letter currency code, e.g. PKR',
  defaultCountryCode: 'use digits only, e.g. 92',
  phone: 'e.g. 0300 1234567 or +92 300 1234567', phones: 'e.g. 0300 1234567 or +92 300 1234567', admissionsPhone: 'e.g. 0300 1234567',
  slug: 'use small letters, numbers and dashes, e.g. about-us', anchor: 'use small letters, numbers and dashes, e.g. fees',
  primary: 'use a colour code, e.g. #1c1f5e', secondary: 'use a colour code, e.g. #0d1033', accent: 'use a colour code, e.g. #29abe2',
  primaryColor: 'use a colour code, e.g. #1c1f5e', accentColor: 'use a colour code, e.g. #29abe2',
  templateName: 'small letters, numbers and _ only, e.g. school_alert', templateLanguage: 'e.g. en or en_US', apiVersion: 'e.g. v21.0',
  phoneNumberId: 'digits only, e.g. 123456789012345', group: 'small letters, numbers, spaces and dashes', category: 'small letters, numbers, spaces and dashes'
};

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

export const friendlyErrorMap: ZodErrorMap = (issue, ctx) => {
  const key = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  const example = key ? EXAMPLES[key] : undefined;
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'This field is required.' };
      if (issue.expected === 'number') return { message: 'Enter a number, e.g. 1500.' };
      if (issue.expected === 'date') return { message: 'Enter a date, e.g. 2026-12-31.' };
      if (issue.expected === 'boolean') return { message: 'Choose yes or no.' };
      return { message: `Wrong kind of value: expected ${issue.expected}.` };
    case 'too_small':
      if (issue.type === 'string') {
        if (isEmpty(ctx.data)) return { message: 'This field is required.' };
        const n = typeof ctx.data === 'string' ? ctx.data.length : 0;
        return { message: `Too short: enter at least ${issue.minimum} characters (you entered ${n}).` };
      }
      if (issue.type === 'array') return { message: Number(issue.minimum) <= 1 ? 'Add at least one.' : `Add at least ${issue.minimum}.` };
      if (issue.type === 'number') return { message: issue.inclusive ? `Must be ${issue.minimum} or more.` : `Must be more than ${issue.minimum}.` };
      return { message: `Too small (minimum ${issue.minimum}).` };
    case 'too_big':
      if (issue.type === 'string') {
        const n = typeof ctx.data === 'string' ? ctx.data.length : 0;
        return { message: `Too long: at most ${issue.maximum} characters (you entered ${n}). Please shorten it.` };
      }
      if (issue.type === 'array') return { message: `Too many: at most ${issue.maximum}.` };
      if (issue.type === 'number') return { message: issue.inclusive ? `Must be ${issue.maximum} or less.` : `Must be less than ${issue.maximum}.` };
      return { message: `Too large (maximum ${issue.maximum}).` };
    case 'invalid_string':
      if (issue.validation === 'email') return { message: 'Enter a valid email address, e.g. name@example.com' };
      if (issue.validation === 'url') return { message: 'Enter a full web address, e.g. https://www.example.com' };
      if (issue.validation === 'uuid') return { message: 'Choose an option from the list.' };
      if (issue.validation === 'datetime') return { message: 'Enter a date and time, e.g. 2026-12-31 09:30' };
      return { message: example ? `Wrong format: ${example}.` : 'Wrong format. Please check what you typed.' };
    case 'invalid_enum_value':
      return { message: `Choose one of: ${issue.options.join(', ')}.` };
    case 'invalid_date':
      return { message: 'Enter a real date, e.g. 2026-12-31.' };
    case 'not_multiple_of':
      return { message: `Must be a multiple of ${issue.multipleOf}.` };
    case 'invalid_union':
      return { message: example ? `Wrong format: ${example}.` : 'This value is not valid. Please check what you typed.' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(friendlyErrorMap);

export interface FieldProblem { field: string; label: string; message: string }

/** One entry per field (first problem only), in form order. */
export function fieldProblems(error: ZodError | { issues: ZodIssue[] }): FieldProblem[] {
  const seen = new Set<string>();
  const out: FieldProblem[] = [];
  for (const i of error.issues) {
    const field = i.path.join('.');
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, label: i.path.length ? fieldLabel(i.path) : 'Form', message: i.message });
  }
  return out;
}

/** One problem: "Please correct this: Due date: …"; several: a heading and one "• Field: problem" line each. */
export function describeProblems(problems: FieldProblem[]): string {
  if (!problems.length) return 'Some information is missing or not valid. Please check the form.';
  if (problems.length === 1) return `Please correct this: ${problems[0]!.label}: ${problems[0]!.message}`;
  return [`Please correct these ${problems.length}:`, ...problems.map((p) => `• ${p.label}: ${p.message}`)].join('\n');
}
