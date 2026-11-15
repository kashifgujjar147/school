import { Schema, model } from 'mongoose';
import { ATTENDANCE_STATUSES, CORRECTION_STATUSES } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

/** One sheet per classroom per date. The unique index is the duplicate-submission guard. */
const sheetSchema = new Schema({
  _id: uuidId,
  classroomId: { type: String, required: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  submittedBy: { type: String, required: true },
  submittedAt: { type: Date, required: true },
  clientOpId: { type: String, required: true },
  source: { type: String, enum: ['online', 'offline_browser', 'local_server'], default: 'online' },
  counts: { present: Number, absent: Number, late: Number, leave: Number, total: Number },
  ...syncedDef
}, baseOptions);
syncedFields(sheetSchema);
// Unique among non-deleted sheets: a soft-deleted duplicate (after conflict resolution) does not block.
sheetSchema.index({ classroomId: 1, date: 1 }, { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } });
sheetSchema.index({ date: 1 });
sheetSchema.index({ clientOpId: 1 }, { unique: true });
export const AttendanceSheet = model('AttendanceSheet', sheetSchema, 'attendancesheets');

/**
 * One record per student per classroom per date. Finalised on submission: teachers cannot edit.
 * Corrections go through AttendanceCorrection and keep originalStatus forever.
 */
const recordSchema = new Schema({
  _id: uuidId,
  sheetId: { type: String, required: true },
  classroomId: { type: String, required: true },
  studentId: { type: String, required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  originalStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  corrected: { type: Boolean, default: false },
  remark: String, arrivalTime: String,
  markedBy: { type: String, required: true },
  ...syncedDef
}, baseOptions);
syncedFields(recordSchema);
recordSchema.index({ classroomId: 1, studentId: 1, date: 1 }, { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } });
recordSchema.index({ studentId: 1, date: -1 });
recordSchema.index({ date: 1, status: 1 });
recordSchema.index({ sheetId: 1 });
export const AttendanceRecord = model('AttendanceRecord', recordSchema, 'attendancerecords');

const correctionSchema = new Schema({
  _id: uuidId,
  attendanceId: { type: String, required: true },
  studentId: { type: String, required: true },
  classroomId: { type: String, required: true },
  date: { type: String, required: true },
  oldStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  newStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  reason: { type: String, required: true },
  requestedBy: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  status: { type: String, enum: CORRECTION_STATUSES, default: 'pending' },
  reviewedBy: String, reviewedAt: Date, reviewNote: String,
  clientOpId: String,
  ...syncedDef
}, baseOptions);
syncedFields(correctionSchema);
correctionSchema.index({ status: 1, requestedAt: -1 });
correctionSchema.index({ requestedBy: 1, requestedAt: -1 });
correctionSchema.index({ attendanceId: 1, status: 1 });
correctionSchema.index({ clientOpId: 1 }, { unique: true, partialFilterExpression: { clientOpId: { $type: 'string' } } });
export const AttendanceCorrection = model('AttendanceCorrection', correctionSchema, 'attendancecorrections');

/** Append-only. */
const auditSchema = new Schema({
  _id: uuidId,
  recordId: String, sheetId: String, studentId: String, classroomId: String, date: String,
  action: { type: String, enum: ['submitted', 'correction_requested', 'correction_approved', 'correction_rejected'], required: true },
  from: String, to: String, correctionId: String, by: String, reason: String,
  at: { type: Date, default: Date.now },
  ...syncedDef
}, { versionKey: false });
syncedFields(auditSchema);
auditSchema.index({ studentId: 1, at: -1 });
auditSchema.index({ recordId: 1, at: -1 });
export const AttendanceAudit = model('AttendanceAudit', auditSchema, 'attendanceaudit');
