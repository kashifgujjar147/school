import { z } from 'zod';
import { PERIOD_KINDS } from '../logic/timetable.js';
import { hexColor, hhmm, isoDate, passwordSchema, uuid } from './index.js';

/** Timetable & scheduling request validation (API is authoritative; forms reuse it). */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const day = z.number().int().min(0).max(6);
const periodKey = z.string().trim().regex(/^[a-z0-9_-]{1,20}$/i, 'Period keys use letters, numbers, - and _');
/** "day:periodKey" slots, e.g. "1:p3" = Monday, period p3. */
const slot = z.string().regex(/^[0-6]:[a-z0-9_-]{1,20}$/i);

export const periodDefSchema = z.object({
  key: periodKey, label: trimmed(40), start: hhmm, end: hhmm, kind: z.enum(PERIOD_KINDS)
});
const periodsSchema = z.array(periodDefSchema).max(24);

export const timetableConfigSchema = z.object({
  sessionId: uuid,
  workingDays: z.array(day).max(7).transform((d) => [...new Set(d)].sort()),
  dayStart: hhmm, dayEnd: hhmm,
  periods: periodsSchema.min(1),
  dayOverrides: z.array(z.object({ day, periods: periodsSchema.min(1) })).max(7).default([]),
  specialDays: z.array(z.object({ date: isoDate, label: trimmed(80), closed: z.boolean(), periods: periodsSchema.nullable().optional() })).max(366).default([]),
  defaultPeriodMinutes: z.number().int().min(10).max(180).default(40),
  teacherMaxPerDay: z.number().int().min(1).max(24).nullable().default(null),
  teacherMaxPerWeek: z.number().int().min(1).max(100).nullable().default(null),
  avoidConsecutiveSameSubject: z.boolean().default(true),
  /** Optimistic concurrency: the version the editor loaded (omit only when creating). */
  version: z.number().int().min(1).optional()
});
export type TimetableConfigInput = z.infer<typeof timetableConfigSchema>;

export const subjectSchema = z.object({
  name: trimmed(80), code: z.string().trim().max(16).optional().nullable(), color: hexColor.optional().nullable()
});
export const subjectUpdateSchema = subjectSchema.partial().extend({ archived: z.boolean().optional() });

export const ROOM_KINDS = ['classroom', 'lab', 'hall', 'library', 'ground', 'other'] as const;
export const roomSchema = z.object({
  name: trimmed(60), kind: z.enum(ROOM_KINDS).default('classroom'), capacity: z.number().int().min(1).max(5000).nullable().optional(),
  unavailable: z.array(slot).max(200).default([])
});
export const roomUpdateSchema = roomSchema.partial().extend({ archived: z.boolean().optional() });

export const requirementItemSchema = z.object({
  subjectId: uuid, teacherId: uuid.nullable().default(null), roomId: uuid.nullable().default(null),
  periodsPerWeek: z.number().int().min(0).max(40), maxPerDay: z.number().int().min(1).max(12).default(2), allowDouble: z.boolean().default(false)
});
export const requirementsPutSchema = z.object({
  sessionId: uuid,
  items: z.array(requirementItemSchema).max(40)
    .refine((a) => new Set(a.map((x) => x.subjectId)).size === a.length, 'Each subject can appear only once per class')
});

export const teacherProfileSchema = z.object({
  sessionId: uuid,
  subjectIds: z.array(uuid).max(40).default([]),
  maxPerDay: z.number().int().min(1).max(24).nullable().default(null),
  maxPerWeek: z.number().int().min(1).max(100).nullable().default(null),
  unavailable: z.array(slot).max(200).default([])
});

export const generateSchema = z.object({
  sessionId: uuid,
  classroomIds: z.array(uuid).min(1).max(200),
  days: z.array(day).max(7).optional(),
  teacherIds: z.array(uuid).max(500).optional(),
  /** Keep lessons marked "locked" in the draft; everything else in the chosen classes is replaced. */
  keepLocked: z.boolean().default(true),
  /** Write an incomplete result to the draft anyway (the report still says it is incomplete). */
  acceptPartial: z.boolean().default(false),
  seed: z.number().int().min(1).max(2_147_483_647).optional(),
  version: z.number().int().min(1)
});

const entryFields = {
  classroomId: uuid, day, periodKey, subjectId: uuid, teacherId: uuid.nullable(), roomId: uuid.nullable().default(null), locked: z.boolean().default(false)
};
export const entryCreateSchema = z.object({
  sessionId: uuid, ...entryFields,
  /** Number of consecutive teaching periods (double / triple lessons). */
  span: z.number().int().min(1).max(4).default(1),
  confirmWarnings: z.boolean().default(false), version: z.number().int().min(1)
});
export const entryUpdateSchema = z.object({
  day: day.optional(), periodKey: periodKey.optional(), subjectId: uuid.optional(), teacherId: uuid.nullable().optional(),
  roomId: uuid.nullable().optional(), locked: z.boolean().optional(),
  confirmWarnings: z.boolean().default(false), version: z.number().int().min(1)
});
export const entrySwapSchema = z.object({ sessionId: uuid, a: uuid, b: uuid, confirmWarnings: z.boolean().default(false), version: z.number().int().min(1) });
export const draftActionSchema = z.object({ sessionId: uuid, version: z.number().int().min(1), classroomIds: z.array(uuid).max(200).optional(), keepLocked: z.boolean().default(true) });
export const publishSchema = z.object({ sessionId: uuid, version: z.number().int().min(1), confirmWarnings: z.boolean().default(false), note: z.string().trim().max(300).optional() });

export const substitutionCreateSchema = z.object({
  date: isoDate, entryId: uuid, substituteTeacherId: uuid, reason: z.string().trim().max(200).optional().nullable(),
  /** Optional temporary room change for this lesson only. */
  roomId: uuid.nullable().optional()
});

export const studentAccountSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  password: passwordSchema.optional()
});
