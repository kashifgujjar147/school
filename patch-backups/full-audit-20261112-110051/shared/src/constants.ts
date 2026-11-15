// Shared constants used by server and client. Dependency-free.

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ROLES = ['principal', 'admin', 'teacher', 'staff'] as const;
export type Role = (typeof ROLES)[number];

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

export const USER_STATUSES = ['active', 'inactive', 'suspended'] as const;
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

export const NOTIFICATION_EVENTS = ['absent', 'late', 'leave'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
export const SYNC_MAX_ATTEMPTS = 8;
export const SMS_MAX_ATTEMPTS = 5;
