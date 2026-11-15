import { z } from 'zod';
import { ATTENDANCE_STATUSES, ROLES, STUDENT_STATUSES, USER_STATUSES, LANGUAGES, NOTIFICATION_EVENTS } from '../constants.js';
import { PERMISSIONS } from '../logic/permissions.js';

/** Request validation shared by API (authoritative) and forms (UX). */

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const passwordSchema = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a number');

export const loginSchema = z.object({ username: trimmed(80).toLowerCase(), password: z.string().min(1).max(128) });

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export const resetRequestSchema = z.object({ username: trimmed(80).toLowerCase() });
export const resetConfirmSchema = z.object({ token: z.string().min(32).max(200), newPassword: passwordSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.string().regex(/^-?[a-zA-Z.]{1,40}$/).optional()
});

export const userCreateSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  fullName: trimmed(120),
  email: z.string().email().optional().nullable(),
  phone: optText(30),
  role: z.enum(ROLES),
  password: passwordSchema,
  extraPermissions: z.array(z.enum(PERMISSIONS)).default([]),
  revokedPermissions: z.array(z.enum(PERMISSIONS)).default([])
});
export const userUpdateSchema = userCreateSchema.omit({ password: true, username: true }).partial().extend({
  status: z.enum(USER_STATUSES).optional()
});

export const schoolSettingsSchema = z.object({
  name: trimmed(160),
  shortName: optText(40),
  description: optText(2000),
  address: optText(400),
  phone: optText(40),
  email: z.string().email().optional().nullable().or(z.literal('')),
  primaryColor: hexColor,
  accentColor: hexColor,
  reportHeader: optText(300),
  reportFooter: optText(300),
  academicIdentity: optText(200),
  defaultLanguage: z.enum(LANGUAGES),
  timeZone: z.string().min(3).max(60),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  defaultCountryCode: z.string().regex(/^\d{1,4}$/)
}).partial();

export const attendancePolicySchema = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1),
  cutoffTime: hhmm.nullable(),
  lateThresholdTime: hhmm.nullable(),
  allowBackdatedDays: z.number().int().min(0).max(31),
  lateCountsAsPresent: z.boolean(),
  excludeLeaveFromTotal: z.boolean(),
  maxLeaveDaysPerTerm: z.number().int().min(0).max(365).nullable()
}).partial();

export const academicSessionSchema = z.object({
  name: trimmed(60), startDate: isoDate, endDate: isoDate, isDefault: z.boolean().default(false)
}).refine((v) => v.startDate < v.endDate, { message: 'startDate must be before endDate' });

export const classSchema = z.object({ name: trimmed(60), order: z.number().int().min(0).default(0) });
export const sectionSchema = z.object({ classId: uuid, name: trimmed(30) });
export const classroomSchema = z.object({
  classId: uuid, sectionId: uuid, sessionId: uuid, name: trimmed(80), room: optText(40), capacity: z.number().int().min(1).max(500).optional().nullable()
});
export const holidaySchema = z.object({ date: isoDate, endDate: isoDate.optional().nullable(), name: trimmed(120) });

export const assignmentSchema = z.object({ teacherId: uuid, classroomId: uuid, isHomeroom: z.boolean().default(false) });

export const studentSchema = z.object({
  admissionNumber: trimmed(40),
  fullName: trimmed(160),
  dateOfBirth: isoDate.optional().nullable(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).optional().nullable(),
  classroomId: uuid,
  admissionDate: isoDate.optional().nullable(),
  emergencyContactName: optText(120),
  emergencyContactPhone: optText(30),
  address: optText(400),
  notes: optText(2000),
  customFields: z.record(z.string().max(60), z.string().max(500)).optional(),
  confirmDuplicate: z.boolean().optional()
});
export const studentUpdateSchema = studentSchema.partial().omit({ classroomId: true }).extend({
  status: z.enum(STUDENT_STATUSES).optional()
});
export const transferSchema = z.object({ classroomId: uuid, reason: trimmed(300), kind: z.enum(['transfer', 'promotion', 'section_change']) });
export const bulkPromoteSchema = z.object({ fromClassroomId: uuid, toClassroomId: uuid, studentIds: z.array(uuid).min(1).max(1000), reason: trimmed(300) });

export const guardianSchema = z.object({
  fullName: trimmed(120), relation: trimmed(40), phone: z.string().min(7).max(25),
  altPhone: optText(25), email: z.string().email().optional().nullable().or(z.literal('')),
  smsOptIn: z.boolean().default(true), language: z.enum(LANGUAGES).default('en')
});
export const linkGuardianSchema = z.object({ guardianId: uuid, isPrimary: z.boolean().default(false), receivesAlerts: z.boolean().default(true) });

export const attendanceEntrySchema = z.object({
  studentId: uuid, status: z.enum(ATTENDANCE_STATUSES), remark: optText(200), arrivalTime: hhmm.optional().nullable()
});
export const attendanceSubmitSchema = z.object({
  classroomId: uuid,
  date: isoDate,
  entries: z.array(attendanceEntrySchema).min(1).max(1000),
  clientOpId: uuid,           // idempotency key generated on the device
  clientCreatedAt: z.string().datetime().optional()
});
export const correctionRequestSchema = z.object({
  attendanceId: uuid, studentId: uuid, newStatus: z.enum(ATTENDANCE_STATUSES), reason: trimmed(500), clientOpId: uuid.optional()
});
export const correctionReviewSchema = z.object({ decision: z.enum(['approved', 'rejected']), reviewNote: optText(500) });

export const smsTemplateSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS), language: z.enum(LANGUAGES), body: trimmed(600), active: z.boolean().default(true)
});
export const smsAutomationSchema = z.object({
  enabled: z.boolean(), events: z.array(z.enum(NOTIFICATION_EVENTS)), sendAfterSubmission: z.boolean(),
  quietHoursStart: hhmm.nullable(), quietHoursEnd: hhmm.nullable()
}).partial();

export const reportQuerySchema = z.object({
  from: isoDate, to: isoDate,
  classroomId: uuid.optional(), classId: uuid.optional(), sectionId: uuid.optional(), studentId: uuid.optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json')
}).refine((v) => v.from <= v.to, { message: 'from must be <= to' });

export const websiteSettingsSchema = z.object({
  enabled: z.boolean(), about: optText(5000), heroTitle: optText(160), heroSubtitle: optText(300),
  showContact: z.boolean(), showAnnouncements: z.boolean()
}).partial();
export const announcementSchema = z.object({ title: trimmed(160), body: trimmed(5000), publishedAt: z.string().datetime().optional().nullable(), pinned: z.boolean().default(false) });

export const restoreSchema = z.object({ backupId: uuid, confirmPhrase: z.literal('RESTORE'), password: z.string().min(1) });

export const conflictResolveSchema = z.object({ resolution: z.enum(['keep_local', 'keep_remote', 'merged']), merged: z.record(z.unknown()).optional(), note: optText(500) });

export type LoginInput = z.infer<typeof loginSchema>;
export type StudentInput = z.infer<typeof studentSchema>;
export type AttendanceSubmitInput = z.infer<typeof attendanceSubmitSchema>;
export type SchoolSettingsInput = z.infer<typeof schoolSettingsSchema>;
