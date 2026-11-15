import { Schema, model } from 'mongoose';
import { FEE_VOUCHER_STATUSES, PAYMENT_INTENT_STATUSES, PAYMENT_METHODS, PAYMENT_PROVIDERS, FEEDBACK_CATEGORIES } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

/**
 * v1.2 collections: fees & payments, exams & results, homework, teacher feedback.
 * All amounts are integer MINOR units (paisa / cents).
 */

// ---------------------------------------------------------------- Fee vouchers (synchronised)
const feeLineSchema = new Schema({ label: { type: String, required: true, maxlength: 80 }, amountMinor: { type: Number, required: true, min: 0 } }, { _id: false });

const voucherSchema = new Schema({
  _id: uuidId,
  voucherNumber: { type: String, required: true },
  studentId: { type: String, required: true },
  // Placement when the voucher was issued (kept even if the student later moves).
  classroomId: { type: String, required: true },
  classId: { type: String, required: true },
  sessionId: { type: String, required: true },
  title: { type: String, required: true, maxlength: 120 },
  period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  issueDate: { type: String, required: true },
  dueDate: { type: String, required: true },
  items: { type: [feeLineSchema], required: true },
  lateFeeMinor: { type: Number, default: 0, min: 0 },
  discountMinor: { type: Number, default: 0, min: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  /** Sum of VERIFIED payments only. Never set from a client value. */
  paidMinor: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: FEE_VOUCHER_STATUSES, default: 'unpaid' },
  allowPartial: { type: Boolean, default: false },
  currency: { type: String, required: true },
  notes: String,
  createdBy: String,
  cancelledAt: { type: Date, default: null }, cancelledBy: String, cancelReason: String,
  ...syncedDef
}, baseOptions);
syncedFields(voucherSchema);
voucherSchema.index({ voucherNumber: 1 }, { unique: true });
voucherSchema.index({ studentId: 1, dueDate: -1 });
voucherSchema.index({ status: 1, dueDate: 1 });
voucherSchema.index({ classroomId: 1, period: 1 });
voucherSchema.index({ period: 1, status: 1 });
export const FeeVoucher = model('FeeVoucher', voucherSchema, 'feevouchers');

// ---------------------------------------------------------------- Payments (synchronised, append-only)
const paymentSchema = new Schema({
  _id: uuidId,
  receiptNumber: { type: String, required: true },
  voucherId: { type: String, required: true },
  studentId: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  /** Portion of this payment above the voucher balance at the time it was applied (needs a refund). */
  overpaidMinor: { type: Number, default: 0, min: 0 },
  currency: { type: String, required: true },
  method: { type: String, enum: PAYMENT_METHODS, required: true },
  status: { type: String, enum: ['succeeded'], default: 'succeeded' },
  provider: { type: String, default: null },
  /** Provider's payment reference (e.g. Stripe PaymentIntent id). Unique: one provider payment is applied once. */
  transactionRef: { type: String, default: null },
  intentId: { type: String, default: null },
  reference: String, // manual: bank slip / cheque number
  note: String,
  paidAt: { type: Date, required: true },
  receivedBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(paymentSchema);
paymentSchema.index({ receiptNumber: 1 }, { unique: true });
paymentSchema.index({ voucherId: 1, paidAt: 1 });
paymentSchema.index({ studentId: 1, paidAt: -1 });
paymentSchema.index({ paidAt: -1 });
paymentSchema.index({ provider: 1, transactionRef: 1 }, { unique: true, partialFilterExpression: { transactionRef: { $type: 'string' } } });
paymentSchema.index({ intentId: 1 }, { unique: true, partialFilterExpression: { intentId: { $type: 'string' } } });
export const FeePayment = model('FeePayment', paymentSchema, 'feepayments');

// ---------------------------------------------------------------- Online payment attempts (node-local)
/**
 * Not synchronised: an online payment is started and verified on the internet-facing server that
 * the provider calls back. The resulting FeePayment and voucher update ARE synchronised.
 */
const intentEventSchema = new Schema({ at: { type: Date, default: Date.now }, type: String, detail: String }, { _id: false });
const intentSchema = new Schema({
  _id: uuidId,
  voucherId: { type: String, required: true },
  studentId: { type: String, required: true },
  userId: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true },
  provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
  status: { type: String, enum: PAYMENT_INTENT_STATUSES, default: 'created' },
  providerSessionId: { type: String, default: null },
  providerPaymentRef: { type: String, default: null },
  checkoutUrl: String,
  expiresAt: { type: Date, required: true },
  paymentId: { type: String, default: null },
  verifiedAt: Date,
  lastError: String,
  lockedUntil: { type: Date, default: null },
  events: { type: [intentEventSchema], default: [] }
}, baseOptions);
intentSchema.index({ providerSessionId: 1 }, { unique: true, partialFilterExpression: { providerSessionId: { $type: 'string' } } });
intentSchema.index({ voucherId: 1, status: 1 });
intentSchema.index({ userId: 1, createdAt: -1 });
export const PaymentIntent = model('PaymentIntent', intentSchema, 'paymentintents');

/** Every provider callback, keyed by provider + event id: a replayed callback is recognised and ignored. */
const paymentEventSchema = new Schema({
  _id: { type: String, required: true },
  provider: String, type: String, intentId: String, outcome: String,
  receivedAt: { type: Date, default: Date.now }
}, { versionKey: false });
paymentEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 400 * 86400 });
export const PaymentEvent = model('PaymentEvent', paymentEventSchema, 'paymentevents');

// ---------------------------------------------------------------- Exams & results (synchronised)
const examSchema = new Schema({
  _id: uuidId,
  name: { type: String, required: true, maxlength: 120 },
  term: String,
  sessionId: { type: String, required: true },
  startDate: { type: String, required: true },
  endDate: String,
  /** Parents see results only after publication. */
  published: { type: Boolean, default: false },
  publishedAt: { type: Date, default: null }, publishedBy: String,
  createdBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(examSchema);
examSchema.index({ sessionId: 1, startDate: -1 });
examSchema.index({ published: 1, publishedAt: -1 });
export const Exam = model('Exam', examSchema, 'exams');

const resultSchema = new Schema({
  _id: uuidId,
  examId: { type: String, required: true },
  studentId: { type: String, required: true },
  classroomId: { type: String, required: true },
  subject: { type: String, required: true, maxlength: 80 },
  subjectKey: { type: String, required: true },
  maxMarks: { type: Number, required: true, min: 0 },
  marksObtained: { type: Number, default: null, min: 0 },
  absent: { type: Boolean, default: false },
  remarks: String,
  enteredBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(resultSchema);
resultSchema.index({ examId: 1, studentId: 1, subjectKey: 1 }, { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } });
resultSchema.index({ examId: 1, classroomId: 1 });
resultSchema.index({ studentId: 1, examId: 1 });
export const ExamResult = model('ExamResult', resultSchema, 'examresults');

// ---------------------------------------------------------------- Homework (synchronised)
const homeworkSchema = new Schema({
  _id: uuidId,
  classroomId: { type: String, required: true },
  subject: { type: String, required: true, maxlength: 80 },
  title: { type: String, required: true, maxlength: 160 },
  description: String,
  assignedDate: { type: String, required: true },
  dueDate: { type: String, required: true },
  createdBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(homeworkSchema);
homeworkSchema.index({ classroomId: 1, dueDate: -1 });
homeworkSchema.index({ dueDate: -1 });
export const Homework = model('Homework', homeworkSchema, 'homework');

// ---------------------------------------------------------------- Teacher feedback (synchronised)
const feedbackSchema = new Schema({
  _id: uuidId,
  studentId: { type: String, required: true },
  classroomId: { type: String, required: true },
  authorId: { type: String, required: true },
  category: { type: String, enum: FEEDBACK_CATEGORIES, default: 'general' },
  body: { type: String, required: true, maxlength: 2000 },
  visibleToParents: { type: Boolean, default: true },
  ...syncedDef
}, baseOptions);
syncedFields(feedbackSchema);
feedbackSchema.index({ studentId: 1, createdAt: -1 });
export const StudentFeedback = model('StudentFeedback', feedbackSchema, 'studentfeedback');
