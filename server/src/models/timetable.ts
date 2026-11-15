import { Schema, model } from 'mongoose';
import { PERIOD_KINDS, ROOM_KINDS } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

/**
 * v1.3 timetable & scheduling. Every collection here is synchronised (versioned writes) and scoped to
 * an academic session. Classes, sections, classrooms, teachers and sessions are the existing records:
 * nothing is duplicated. Subjects and rooms are new because the system had no records for them
 * (subjects were free text on results / homework).
 */

// ---------------------------------------------------------------- Subjects
const subjectSchema = new Schema({
  _id: uuidId,
  name: { type: String, required: true, maxlength: 80 },
  nameLower: { type: String, required: true },
  code: { type: String, default: null, maxlength: 16 },
  color: { type: String, default: null },
  archived: { type: Boolean, default: false },
  ...syncedDef
}, baseOptions);
syncedFields(subjectSchema);
subjectSchema.index({ nameLower: 1 }, { unique: true });
export const Subject = model('Subject', subjectSchema, 'subjects');

// ---------------------------------------------------------------- Rooms & labs
const roomSchema = new Schema({
  _id: uuidId,
  name: { type: String, required: true, maxlength: 60 },
  nameLower: { type: String, required: true },
  kind: { type: String, enum: ROOM_KINDS, default: 'classroom' },
  capacity: { type: Number, default: null },
  /** "day:periodKey" slots when the room cannot be booked (maintenance, shared use). */
  unavailable: { type: [String], default: [] },
  archived: { type: Boolean, default: false },
  ...syncedDef
}, baseOptions);
syncedFields(roomSchema);
roomSchema.index({ nameLower: 1 }, { unique: true });
export const Room = model('Room', roomSchema, 'rooms');

// ---------------------------------------------------------------- Bell schedule (one per session)
const periodSchema = new Schema({
  key: { type: String, required: true }, label: { type: String, required: true },
  start: { type: String, required: true }, end: { type: String, required: true },
  kind: { type: String, enum: PERIOD_KINDS, required: true }
}, { _id: false });
const timetableConfigSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  dayStart: { type: String, required: true },
  dayEnd: { type: String, required: true },
  periods: { type: [periodSchema], default: [] },
  dayOverrides: { type: [new Schema({ day: Number, periods: [periodSchema] }, { _id: false })], default: [] },
  specialDays: { type: [new Schema({ date: String, label: String, closed: Boolean, periods: { type: [periodSchema], default: undefined } }, { _id: false })], default: [] },
  defaultPeriodMinutes: { type: Number, default: 40 },
  teacherMaxPerDay: { type: Number, default: null },
  teacherMaxPerWeek: { type: Number, default: null },
  avoidConsecutiveSameSubject: { type: Boolean, default: true },
  updatedBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(timetableConfigSchema);
timetableConfigSchema.index({ sessionId: 1 }, { unique: true });
export const TimetableConfig = model('TimetableConfig', timetableConfigSchema, 'timetableconfigs');

// ---------------------------------------------------------------- Weekly subject requirements per classroom
const requirementSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  classroomId: { type: String, required: true },
  subjectId: { type: String, required: true },
  /** null = the generator picks a qualified teacher. */
  teacherId: { type: String, default: null },
  /** null = no special room (the class's own room). */
  roomId: { type: String, default: null },
  periodsPerWeek: { type: Number, required: true, min: 0, max: 40 },
  maxPerDay: { type: Number, default: 2, min: 1, max: 12 },
  allowDouble: { type: Boolean, default: false },
  ...syncedDef
}, baseOptions);
syncedFields(requirementSchema);
requirementSchema.index({ classroomId: 1, subjectId: 1 }, { unique: true });
requirementSchema.index({ sessionId: 1 });
export const SubjectRequirement = model('SubjectRequirement', requirementSchema, 'subjectrequirements');

// ---------------------------------------------------------------- Teacher scheduling profile (per session)
const teacherProfileSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  teacherId: { type: String, required: true },
  subjectIds: { type: [String], default: [] },
  maxPerDay: { type: Number, default: null },
  maxPerWeek: { type: Number, default: null },
  unavailable: { type: [String], default: [] },
  ...syncedDef
}, baseOptions);
syncedFields(teacherProfileSchema);
teacherProfileSchema.index({ sessionId: 1, teacherId: 1 }, { unique: true });
export const TeacherProfile = model('TeacherProfile', teacherProfileSchema, 'teacherprofiles');

// ---------------------------------------------------------------- Lessons (draft and published kept apart)
/**
 * One lesson = one classroom in one period of one weekday. The unique indexes make double-booking
 * impossible at the database level, even under concurrent edits:
 *   - a classroom has at most one lesson per period
 *   - a teacher teaches at most one lesson per period
 *   - a room hosts at most one lesson per period
 * Draft and published lessons are separate documents (state), so editing the draft never changes
 * what teachers, students and parents see until the timetable is published.
 */
const entrySchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  state: { type: String, enum: ['draft', 'published'], required: true },
  classroomId: { type: String, required: true },
  day: { type: Number, required: true, min: 0, max: 6 },
  periodKey: { type: String, required: true },
  subjectId: { type: String, required: true },
  teacherId: { type: String, default: null },
  roomId: { type: String, default: null },
  /** Locked lessons are kept when the timetable is generated again. */
  locked: { type: Boolean, default: false },
  source: { type: String, enum: ['auto', 'manual'], default: 'manual' },
  ...syncedDef
}, baseOptions);
syncedFields(entrySchema);
entrySchema.index({ sessionId: 1, state: 1, classroomId: 1, day: 1, periodKey: 1 }, { unique: true });
entrySchema.index({ sessionId: 1, state: 1, teacherId: 1, day: 1, periodKey: 1 }, { unique: true, partialFilterExpression: { teacherId: { $type: 'string' } } });
entrySchema.index({ sessionId: 1, state: 1, roomId: 1, day: 1, periodKey: 1 }, { unique: true, partialFilterExpression: { roomId: { $type: 'string' } } });
export const TimetableEntry = model('TimetableEntry', entrySchema, 'timetableentries');

/**
 * Per-session timetable state. Its `version` is the concurrency token for the whole draft: every draft
 * change must quote the version it was based on, so two administrators can never silently overwrite
 * each other's edits (the second one gets 409 and reloads).
 */
const metaSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  status: { type: String, enum: ['empty', 'draft', 'published'], default: 'empty' },
  /** True when the draft differs from what is published. */
  draftDirty: { type: Boolean, default: false },
  draftUpdatedAt: { type: Date, default: null }, draftUpdatedBy: String,
  publishedAt: { type: Date, default: null }, publishedBy: String, publishCount: { type: Number, default: 0 },
  lastGeneration: { type: Schema.Types.Mixed, default: null },
  ...syncedDef
}, baseOptions);
syncedFields(metaSchema);
metaSchema.index({ sessionId: 1 }, { unique: true });
export const TimetableMeta = model('TimetableMeta', metaSchema, 'timetablemeta');

// ---------------------------------------------------------------- Substitutions (temporary; never touch the timetable)
const substitutionSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  date: { type: String, required: true },
  day: { type: Number, required: true },
  periodKey: { type: String, required: true },
  /** The published lesson being covered. */
  entryId: { type: String, required: true },
  classroomId: { type: String, required: true },
  subjectId: { type: String, required: true },
  originalTeacherId: { type: String, default: null },
  substituteTeacherId: { type: String, required: true },
  roomId: { type: String, default: null },
  reason: { type: String, default: null, maxlength: 200 },
  status: { type: String, enum: ['active', 'cancelled'], default: 'active' },
  createdBy: String, cancelledBy: String, cancelledAt: { type: Date, default: null },
  ...syncedDef
}, baseOptions);
syncedFields(substitutionSchema);
// One active cover per lesson per date, and a substitute can cover only one lesson per period.
substitutionSchema.index({ date: 1, entryId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
substitutionSchema.index({ date: 1, periodKey: 1, substituteTeacherId: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
substitutionSchema.index({ sessionId: 1, date: -1 });
substitutionSchema.index({ originalTeacherId: 1, date: -1 });
export const Substitution = model('Substitution', substitutionSchema, 'substitutions');

// ---------------------------------------------------------------- In-app timetable notices
/**
 * Shown in the teacher, student and parent portals. Audience is explicit (teacher ids / classroom ids),
 * so every reader is filtered server-side. External SMS / WhatsApp go through the notification queue,
 * which reports real provider status separately.
 */
const noticeSchema = new Schema({
  _id: uuidId,
  sessionId: { type: String, required: true },
  kind: { type: String, enum: ['published', 'changed', 'substitution', 'substitution_cancelled'], required: true },
  title: { type: String, required: true, maxlength: 160 },
  body: { type: String, required: true, maxlength: 2000 },
  /** Everyone in the school (first publication). */
  everyone: { type: Boolean, default: false },
  teacherIds: { type: [String], default: [] },
  classroomIds: { type: [String], default: [] },
  date: { type: String, default: null },
  refId: { type: String, default: null },
  createdBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(noticeSchema);
noticeSchema.index({ teacherIds: 1, createdAt: -1 });
noticeSchema.index({ classroomIds: 1, createdAt: -1 });
noticeSchema.index({ everyone: 1, createdAt: -1 });
export const TimetableNotice = model('TimetableNotice', noticeSchema, 'timetablenotices');
