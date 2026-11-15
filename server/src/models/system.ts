import { Schema, model } from 'mongoose';
import { SMS_JOB_STATUSES, SYNC_OP_STATUSES, NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS, LANGUAGES } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

// ---------------------------------------------------------------- Notifications (Standard)
const templateSchema = new Schema({
  _id: uuidId,
  event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
  language: { type: String, enum: LANGUAGES, required: true },
  body: { type: String, required: true, maxlength: 600 },
  active: { type: Boolean, default: true },
  ...syncedDef
}, baseOptions);
syncedFields(templateSchema);
templateSchema.index({ event: 1, language: 1 }, { unique: true });
export const NotificationTemplate = model('NotificationTemplate', templateSchema, 'notificationtemplates');

const attemptSchema = new Schema({ at: Date, ok: Boolean, error: String, providerStatus: String }, { _id: false });

const jobSchema = new Schema({
  _id: uuidId,
  dedupeKey: { type: String, required: true },
  event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
  /** v1.2. Jobs created before have no channel and are SMS. */
  channel: { type: String, enum: NOTIFICATION_CHANNELS, default: 'sms' },
  /** Related record for non-attendance events (voucher, payment, exam, homework, announcement). */
  refId: String,
  studentId: String, guardianId: String, attendanceId: String, date: String,
  to: { type: String, required: true },
  body: { type: String, required: true },
  segments: Number, encoding: String,
  status: { type: String, enum: SMS_JOB_STATUSES, default: 'pending' },
  attempts: { type: Number, default: 0 },
  attemptLog: { type: [attemptSchema], default: [] }, // capped at 10 entries by the worker
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: { type: Date, default: null },
  provider: String, providerMessageId: String,
  sentAt: Date, deliveredAt: Date, lastError: String,
  createdBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(jobSchema);
jobSchema.index({ dedupeKey: 1 }, { unique: true });
jobSchema.index({ status: 1, nextAttemptAt: 1 });
jobSchema.index({ providerMessageId: 1 }, { sparse: true });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ guardianId: 1, createdAt: -1 });
jobSchema.index({ event: 1, createdAt: -1 });
export const NotificationJob = model('NotificationJob', jobSchema, 'notificationjobs');

const notificationLogSchema = new Schema({
  _id: uuidId, jobId: String, type: { type: String, enum: ['queued', 'sent', 'failed', 'receipt', 'dead', 'cancelled', 'blocked_config', 'retry'] },
  detail: String, at: { type: Date, default: Date.now }
}, { versionKey: false });
notificationLogSchema.index({ jobId: 1, at: -1 });
notificationLogSchema.index({ at: -1 });
export const NotificationLog = model('NotificationLog', notificationLogSchema, 'notificationlogs');

// ---------------------------------------------------------------- Audit / idempotency / backups
const auditLogSchema = new Schema({
  _id: uuidId, actorId: String, actorName: String, action: { type: String, required: true },
  entity: String, entityId: String, detail: Schema.Types.Mixed, ip: String, node: String,
  at: { type: Date, default: Date.now }
}, { versionKey: false });
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ entity: 1, entityId: 1, at: -1 });
auditLogSchema.index({ actorId: 1, at: -1 });
export const AuditLog = model('AuditLog', auditLogSchema, 'auditlogs');

const idempotencySchema = new Schema({
  _id: { type: String, required: true }, // `${userId}:${key}`
  route: String, status: Number, body: Schema.Types.Mixed, createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
idempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 45 * 86400 });
export const IdempotencyKey = model('IdempotencyKey', idempotencySchema, 'idempotencykeys');

const backupSchema = new Schema({
  _id: uuidId, fileName: String, sizeBytes: Number, sha256: String,
  kind: { type: String, enum: ['manual', 'scheduled', 'pre_update', 'pre_restore'] },
  status: { type: String, enum: ['running', 'completed', 'failed', 'verified', 'verify_failed'], default: 'running' },
  collections: [{ name: String, count: Number, _id: false }],
  error: String, createdBy: String, verifiedAt: Date, appVersion: String, installId: String
}, baseOptions);
backupSchema.index({ createdAt: -1 });
export const BackupRecord = model('BackupRecord', backupSchema, 'backups');

// ---------------------------------------------------------------- Synchronisation (hybrid)
/** Outbox: every local change to a synchronised collection. */
const syncOpSchema = new Schema({
  _id: { type: String, required: true }, // opId (UUID) — idempotency key
  collectionName: { type: String, required: true },
  docId: { type: String, required: true },
  kind: { type: String, enum: ['upsert', 'delete'], required: true },
  baseVersion: { type: Number, required: true },
  newVersion: { type: Number, required: true },
  snapshot: Schema.Types.Mixed,
  nodeId: { type: String, required: true },
  status: { type: String, enum: SYNC_OP_STATUSES, default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastError: String, syncedAt: Date
}, baseOptions);
syncOpSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
syncOpSchema.index({ collectionName: 1, docId: 1, status: 1 });
syncOpSchema.index({ nodeId: 1, createdAt: 1 });
// Synced ops are kept 180 days as a pull log; pending/failed ops (syncedAt unset) never expire.
syncOpSchema.index({ syncedAt: 1 }, { expireAfterSeconds: 180 * 86400 });
export const SyncOperation = model('SyncOperation', syncOpSchema, 'syncoperations');

/** Inbox: ops from other nodes that were applied here. */
const syncAppliedSchema = new Schema({ _id: { type: String, required: true }, appliedAt: { type: Date, default: Date.now } }, { versionKey: false });
syncAppliedSchema.index({ appliedAt: 1 }, { expireAfterSeconds: 180 * 86400 });
export const SyncApplied = model('SyncApplied', syncAppliedSchema, 'syncapplied');

const syncConflictSchema = new Schema({
  _id: uuidId, opId: String, direction: { type: String, enum: ['push', 'pull'] },
  collectionName: String, docId: String, reason: String,
  localVersion: Schema.Types.Mixed, remoteVersion: Schema.Types.Mixed,
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  resolution: String, resolvedBy: String, resolvedAt: Date, note: String
}, baseOptions);
syncConflictSchema.index({ status: 1, createdAt: -1 });
export const SyncConflict = model('SyncConflict', syncConflictSchema, 'syncconflicts');

const checkpointSchema = new Schema({
  _id: { type: String, required: true }, // e.g. "pull:<remote>"
  lastSeenOpObjectId: String, lastSuccessAt: Date, lastAttemptAt: Date, lastError: String,
  pushedTotal: { type: Number, default: 0 }, pulledTotal: { type: Number, default: 0 }
}, baseOptions);
export const SyncCheckpoint = model('SyncCheckpoint', checkpointSchema, 'synccheckpoints');

// Mark that these system schemas are intentionally not "synced" except the ones using syncedFields above.
export const SYNCED_MODELS = [
  'schoolsettings', 'users', 'academicsessions', 'classes', 'sections', 'classrooms', 'teacherassignments',
  'holidays', 'students', 'studenthistory', 'guardians', 'studentguardians', 'announcements',
  'attendancesheets', 'attendancerecords', 'attendancecorrections', 'attendanceaudit',
  'notificationtemplates',
  // v1.2: fees, exams, homework, feedback. (paymentintents / paymentevents stay on the node the
  // payment provider calls back; the resulting payments and voucher updates are synchronised.)
  'feevouchers', 'feepayments', 'exams', 'examresults', 'homework', 'studentfeedback',
  // Website CMS (v1.1): content, media records and inquiries follow the same versioned sync.
  'websiteconfig', 'websitepages', 'websiteitems', 'websitemedia', 'websiterevisions', 'websiteinquiries',
  // v1.3: timetable & scheduling
  'subjects', 'rooms', 'timetableconfigs', 'subjectrequirements', 'teacherprofiles', 'timetableentries', 'timetablemeta',
  'substitutions', 'timetablenotices'
] as const;
// notificationjobs are deliberately NOT synchronised: a job is queued and sent only by the node where the
// attendance event happened, so the same alert can never be sent by two nodes.
