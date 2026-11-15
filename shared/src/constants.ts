// Shared constants used by server and client. Dependency-free.

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * 'unassigned' is the role of a self-registered account that an administrator has not reviewed yet.
 * It carries no permissions and can never sign in (its status stays 'pending' until approved).
 */
export const ROLES = ['principal', 'admin', 'teacher', 'staff', 'parent', 'student', 'unassigned'] as const;
export type Role = (typeof ROLES)[number];
/** Roles managed on the Users page. Parent accounts are created from a guardian record instead. */
export const STAFF_ROLES = ['principal', 'admin', 'teacher', 'staff'] as const satisfies readonly Role[];

export const PACKAGES = ['starter', 'standard'] as const;
export type PackageTier = (typeof PACKAGES)[number];

export const APP_MODES = ['cloud', 'local', 'hybrid'] as const;
/**
 * cloud  – server talks to the school's MongoDB Atlas database only.
 * local  – server talks to a local MongoDB Community database only (single computer / LAN). No internet needed.
 * hybrid – server runs on the local database AND synchronises with Atlas when internet is available.
 */
export type AppMode = (typeof APP_MODES)[number];

export const STUDENT_STATUSES = ['active', 'archived', 'transferred', 'graduated', 'suspended'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** 'pending' = self-registered, waiting for an administrator to assign a role (cannot sign in). */
export const USER_STATUSES = ['active', 'inactive', 'suspended', 'pending'] as const;
/** Statuses an administrator may set directly. 'pending' is only ever set by self-registration. */
export const MANAGEABLE_USER_STATUSES = ['active', 'inactive', 'suspended'] as const satisfies readonly (typeof USER_STATUSES)[number][];
/** Roles a pending (self-registered) account can be approved into. */
export const APPROVABLE_ROLES = ['principal', 'admin', 'teacher', 'staff', 'parent', 'student'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/** SMS job lifecycle. `delivered` is ONLY set from a provider delivery receipt. */
export const SMS_JOB_STATUSES = [
  'pending',        // created, waiting for worker / connectivity
  'processing',     // worker claimed it
  'sent',           // provider accepted the message (NOT delivered)
  'delivered',      // provider delivery receipt confirmed delivery
  'undelivered',    // provider receipt says not delivered
  'failed',         // attempt failed; will retry until maxAttempts
  'dead',           // exceeded retries
  'blocked_config', // provider not configured / no credentials
  'cancelled'
] as const;
export type SmsJobStatus = (typeof SMS_JOB_STATUSES)[number];

export const SYNC_OP_STATUSES = ['pending', 'synced', 'failed', 'conflict', 'dead'] as const;
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number];

export const ATTENDANCE_EVENTS = ['absent', 'late', 'leave'] as const;
export const NOTIFICATION_EVENTS = [...ATTENDANCE_EVENTS, 'fee_due', 'fee_paid', 'result', 'homework', 'announcement', 'timetable'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Delivery channels. Every job records its channel; jobs created before v1.2 have none and are SMS. */
export const NOTIFICATION_CHANNELS = ['sms', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// ---------------------------------------------------------------- Fees & payments
/** Voucher state is DERIVED from verified payments only (see feeStatus in logic/fees.ts). */
export const FEE_VOUCHER_STATUSES = ['unpaid', 'partial', 'paid', 'cancelled'] as const;
export type FeeVoucherStatus = (typeof FEE_VOUCHER_STATUSES)[number];
export const MANUAL_PAYMENT_METHODS = ['cash', 'bank_transfer', 'cheque'] as const;
export const PAYMENT_METHODS = [...MANUAL_PAYMENT_METHODS, 'online'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/**
 * Online payment attempt lifecycle. `succeeded` is set ONLY after the provider's signed callback has
 * been verified AND the payment was re-confirmed with the provider's API.
 */
export const PAYMENT_INTENT_STATUSES = ['created', 'pending', 'processing', 'succeeded', 'failed', 'expired', 'amount_mismatch'] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];
export const PAYMENT_PROVIDERS = ['none', 'stripe'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
export const SYNC_MAX_ATTEMPTS = 8;
export const SMS_MAX_ATTEMPTS = 5;
