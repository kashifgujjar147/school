import { Schema, model, type InferSchemaType } from 'mongoose';
import { ROLES, USER_STATUSES, STUDENT_STATUSES, LANGUAGES, PERMISSIONS } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

// ---------------------------------------------------------------- School settings (singleton)
const policySchema = new Schema({
  workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  cutoffTime: { type: String, default: null },
  lateThresholdTime: { type: String, default: '08:15' },
  allowBackdatedDays: { type: Number, default: 2 },
  lateCountsAsPresent: { type: Boolean, default: true },
  excludeLeaveFromTotal: { type: Boolean, default: true },
  maxLeaveDaysPerTerm: { type: Number, default: null }
}, { _id: false });

const smsAutomationSchema = new Schema({
  enabled: { type: Boolean, default: false },
  events: { type: [String], default: ['absent'] },
  sendAfterSubmission: { type: Boolean, default: true },
  quietHoursStart: { type: String, default: null },
  quietHoursEnd: { type: String, default: null },
  // v1.2: delivery channels. Settings saved before v1.2 have no value and default to SMS only.
  channels: { type: [String], enum: ['sms', 'whatsapp'], default: ['sms'] }
}, { _id: false });

const feeSettingsSchema = new Schema({
  currency: { type: String, default: 'PKR' },
  reminderDaysBefore: { type: Number, default: 3, min: 0, max: 60 },
  remindersEnabled: { type: Boolean, default: false },
  voucherFooter: String
}, { _id: false });

const websiteSchema = new Schema({
  enabled: { type: Boolean, default: false },
  about: String, heroTitle: String, heroSubtitle: String,
  showContact: { type: Boolean, default: true }, showAnnouncements: { type: Boolean, default: true }
}, { _id: false });

const backupScheduleSchema = new Schema({
  enabled: { type: Boolean, default: true },
  hour: { type: Number, default: 22, min: 0, max: 23 },
  keepLast: { type: Number, default: 14, min: 1, max: 365 }
}, { _id: false });

const schoolSettingsSchema = new Schema({
  _id: { type: String, default: 'school' },
  installId: { type: String, required: true, immutable: true },
  name: { type: String, required: true, maxlength: 160 },
  shortName: String, description: String, address: String, phone: String, email: String,
  logoPath: String, faviconPath: String,
  primaryColor: { type: String, default: '#1c1f5e' },
  accentColor: { type: String, default: '#29abe2' },
  reportHeader: String, reportFooter: String, academicIdentity: String,
  defaultLanguage: { type: String, enum: LANGUAGES, default: 'en' },
  timeZone: { type: String, default: 'Asia/Karachi' },
  dateFormat: { type: String, default: 'DD/MM/YYYY' },
  defaultCountryCode: { type: String, default: '92' },
  defaultSessionId: String,
  policy: { type: policySchema, default: () => ({}) },
  smsAutomation: { type: smsAutomationSchema, default: () => ({}) },
  website: { type: websiteSchema, default: () => ({}) },
  backupSchedule: { type: backupScheduleSchema, default: () => ({}) },
  fees: { type: feeSettingsSchema, default: () => ({}) },
  studentCustomFields: { type: [{ key: String, label: String, _id: false }], default: [] },
  schemaVersion: { type: Number, default: 1 },
  /** Set once the first administrator has been created through the web setup (/setup). */
  setupCompletedAt: { type: Date, default: null },
  ...syncedDef
}, baseOptions);
syncedFields(schoolSettingsSchema);
export const SchoolSettings = model('SchoolSettings', schoolSettingsSchema, 'schoolsettings');

/** Secrets the admin enters in the dashboard. Encrypted at rest; never returned by the API; never synced. */
const secretSettingsSchema = new Schema({
  _id: { type: String, required: true },
  ciphertext: { type: String, required: true },
  iv: String, tag: String,
  updatedBy: String
}, baseOptions);
export const SecretSettings = model('SecretSettings', secretSettingsSchema, 'secretsettings');

// ---------------------------------------------------------------- Users
const userSchema = new Schema({
  _id: uuidId,
  username: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9._-]{3,40}$/ },
  fullName: { type: String, required: true, maxlength: 120 },
  email: String, phone: String,
  role: { type: String, enum: ROLES, required: true },
  status: { type: String, enum: USER_STATUSES, default: 'active' },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: Date,
  mustChangePassword: { type: Boolean, default: false },
  extraPermissions: { type: [String], enum: PERMISSIONS, default: [] },
  revokedPermissions: { type: [String], enum: PERMISSIONS, default: [] },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: Date,
  lastLoginIp: String,
  /** role=parent only: the guardian record whose linked children this account may see. */
  guardianId: { type: String, default: null },
  /** role=student only: the student record whose class timetable this account may see. */
  studentId: { type: String, default: null },
  /** Account was created through public self-registration (Create account). */
  selfRegistered: { type: Boolean, default: false },
  /** Who approved a self-registered account, and when. */
  approvedBy: { type: String, default: null },
  approvedAt: { type: Date, default: null },
  ...syncedDef
}, baseOptions);
syncedFields(userSchema);
userSchema.index({ studentId: 1 }, { unique: true, partialFilterExpression: { studentId: { $type: 'string' } } });
userSchema.index({ guardianId: 1 }, { unique: true, partialFilterExpression: { guardianId: { $type: 'string' } } });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });
// Email lookups (sign-in by email, duplicate checks at registration).
userSchema.index({ email: 1 });
export const User = model('User', userSchema, 'users');
export type UserDoc = InferSchemaType<typeof userSchema>;

const sessionSchema = new Schema({
  _id: { type: String, required: true }, // sha256(token) — the raw token lives only in the httpOnly cookie
  userId: { type: String, required: true, index: true },
  csrfToken: { type: String, required: true },
  ip: String, userAgent: String,
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  revokedReason: String
}, baseOptions);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });
export const Session = model('Session', sessionSchema, 'sessions');

const loginHistorySchema = new Schema({
  _id: uuidId,
  userId: String, username: String,
  success: Boolean, reason: String, ip: String, userAgent: String,
  at: { type: Date, default: Date.now }
}, { versionKey: false });
loginHistorySchema.index({ at: -1 });
loginHistorySchema.index({ userId: 1, at: -1 });
loginHistorySchema.index({ at: 1 }, { expireAfterSeconds: 400 * 86400 });
export const LoginHistory = model('LoginHistory', loginHistorySchema, 'loginhistory');

const passwordResetSchema = new Schema({
  _id: { type: String, required: true }, // sha256(token)
  userId: { type: String, required: true },
  createdBy: String, // admin who issued it (null when self-requested)
  expiresAt: { type: Date, required: true },
  usedAt: Date
}, baseOptions);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });
export const PasswordReset = model('PasswordReset', passwordResetSchema, 'passwordresets');

const resetRequestSchema = new Schema({
  _id: uuidId, userId: String, username: String, ip: String,
  status: { type: String, enum: ['open', 'handled', 'dismissed'], default: 'open' }, handledBy: String
}, baseOptions);
export const PasswordResetRequest = model('PasswordResetRequest', resetRequestSchema, 'passwordresetrequests');

// ---------------------------------------------------------------- Academic structure
const academicSessionSchema = new Schema({
  _id: uuidId, name: { type: String, required: true }, startDate: { type: String, required: true }, endDate: { type: String, required: true },
  isDefault: { type: Boolean, default: false }, archived: { type: Boolean, default: false },
  ...syncedDef
}, baseOptions);
syncedFields(academicSessionSchema);
academicSessionSchema.index({ name: 1 }, { unique: true });
export const AcademicSession = model('AcademicSession', academicSessionSchema, 'academicsessions');

const classSchema = new Schema({ _id: uuidId, name: { type: String, required: true }, order: { type: Number, default: 0 }, archived: { type: Boolean, default: false }, ...syncedDef }, baseOptions);
syncedFields(classSchema);
classSchema.index({ name: 1 }, { unique: true });
export const SchoolClass = model('SchoolClass', classSchema, 'classes');

const sectionSchema = new Schema({ _id: uuidId, classId: { type: String, required: true }, name: { type: String, required: true }, archived: { type: Boolean, default: false }, ...syncedDef }, baseOptions);
syncedFields(sectionSchema);
sectionSchema.index({ classId: 1, name: 1 }, { unique: true });
export const Section = model('Section', sectionSchema, 'sections');

const classroomSchema = new Schema({
  _id: uuidId,
  classId: { type: String, required: true }, sectionId: { type: String, required: true }, sessionId: { type: String, required: true },
  name: { type: String, required: true }, room: String, capacity: Number,
  archived: { type: Boolean, default: false },
  ...syncedDef
}, baseOptions);
syncedFields(classroomSchema);
classroomSchema.index({ sessionId: 1, classId: 1, sectionId: 1 }, { unique: true });
export const Classroom = model('Classroom', classroomSchema, 'classrooms');

/** Assignment rows are never deleted: ending an assignment sets endedAt, preserving history. */
const assignmentSchema = new Schema({
  _id: uuidId,
  teacherId: { type: String, required: true }, classroomId: { type: String, required: true },
  isHomeroom: { type: Boolean, default: false },
  startedAt: { type: Date, default: Date.now }, endedAt: { type: Date, default: null },
  assignedBy: String, endedBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(assignmentSchema);
assignmentSchema.index({ teacherId: 1, classroomId: 1, endedAt: 1 });
assignmentSchema.index({ classroomId: 1, endedAt: 1 });
assignmentSchema.index({ teacherId: 1, classroomId: 1 }, { unique: true, partialFilterExpression: { endedAt: null } });
export const TeacherAssignment = model('TeacherAssignment', assignmentSchema, 'teacherassignments');

const holidaySchema = new Schema({ _id: uuidId, date: { type: String, required: true }, endDate: String, name: { type: String, required: true }, ...syncedDef }, baseOptions);
syncedFields(holidaySchema);
holidaySchema.index({ date: 1 });
export const Holiday = model('Holiday', holidaySchema, 'holidays');

// ---------------------------------------------------------------- Students
const studentSchema = new Schema({
  _id: uuidId,
  admissionNumber: { type: String, required: true, trim: true },
  admissionNumberLower: { type: String, required: true },
  fullName: { type: String, required: true, maxlength: 160 },
  nameNormalized: { type: String, required: true },
  dateOfBirth: String,
  gender: { type: String, enum: ['male', 'female', 'other', 'unspecified', null] },
  photoPath: String,
  classroomId: { type: String, required: true },
  classId: { type: String, required: true },
  sectionId: { type: String, required: true },
  sessionId: { type: String, required: true },
  admissionDate: String,
  status: { type: String, enum: STUDENT_STATUSES, default: 'active' },
  emergencyContactName: String, emergencyContactPhone: String,
  address: String, notes: String,
  primaryGuardianPhone: String, // denormalised for duplicate detection & search
  customFields: { type: Map, of: String, default: {} },
  /**
   * ID-card QR verification token: 192 random bits, never derived from the student's id or admission
   * number, so it cannot be guessed or enumerated. Rotating it invalidates previously printed cards.
   */
  idCardToken: { type: String, default: null },
  idCardIssuedAt: { type: Date, default: null },
  ...syncedDef
}, baseOptions);
syncedFields(studentSchema);
studentSchema.index({ idCardToken: 1 }, { unique: true, partialFilterExpression: { idCardToken: { $type: 'string' } } });
studentSchema.index({ admissionDate: 1 });
studentSchema.index({ admissionNumberLower: 1 }, { unique: true });
studentSchema.index({ classroomId: 1, status: 1, fullName: 1 });
studentSchema.index({ nameNormalized: 1 });
studentSchema.index({ status: 1 });
export const Student = model('Student', studentSchema, 'students');

const studentHistorySchema = new Schema({
  _id: uuidId, studentId: { type: String, required: true },
  kind: { type: String, enum: ['created', 'transfer', 'promotion', 'section_change', 'status_change', 'archived', 'restored'], required: true },
  from: Schema.Types.Mixed, to: Schema.Types.Mixed, reason: String, by: String, at: { type: Date, default: Date.now },
  ...syncedDef
}, { versionKey: false });
syncedFields(studentHistorySchema);
studentHistorySchema.index({ studentId: 1, at: -1 });
export const StudentHistory = model('StudentHistory', studentHistorySchema, 'studenthistory');

const guardianSchema = new Schema({
  _id: uuidId, fullName: { type: String, required: true }, relation: String,
  phone: { type: String, required: true }, altPhone: String, email: String,
  smsOptIn: { type: Boolean, default: true }, language: { type: String, enum: LANGUAGES, default: 'en' },
  ...syncedDef
}, baseOptions);
syncedFields(guardianSchema);
guardianSchema.index({ phone: 1 });
export const Guardian = model('Guardian', guardianSchema, 'guardians');

const studentGuardianSchema = new Schema({
  _id: uuidId, studentId: { type: String, required: true }, guardianId: { type: String, required: true },
  isPrimary: { type: Boolean, default: false }, receivesAlerts: { type: Boolean, default: true },
  ...syncedDef
}, baseOptions);
syncedFields(studentGuardianSchema);
studentGuardianSchema.index({ studentId: 1, guardianId: 1 }, { unique: true });
studentGuardianSchema.index({ guardianId: 1 });
export const StudentGuardian = model('StudentGuardian', studentGuardianSchema, 'studentguardians');

const announcementSchema = new Schema({
  _id: uuidId, title: { type: String, required: true }, body: { type: String, required: true },
  publishedAt: { type: Date, default: null }, pinned: { type: Boolean, default: false }, createdBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(announcementSchema);
announcementSchema.index({ publishedAt: -1 });
export const Announcement = model('Announcement', announcementSchema, 'announcements');
