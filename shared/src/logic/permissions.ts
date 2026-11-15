import type { PackageTier, Role } from '../constants.js';

/** Every permission the API checks. Server is the authority; client uses this only to hide UI. */
export const PERMISSIONS = [
  'dashboard.view',
  'settings.view', 'settings.manage',
  'academic.manage',
  'users.view', 'users.manage',
  'students.view', 'students.manage', 'students.delete', 'students.import',
  'classrooms.view', 'classrooms.manage',
  'assignments.manage',
  'attendance.mark', 'attendance.view_all', 'attendance.view_own',
  'corrections.request', 'corrections.review',
  'reports.view',
  'guardians.view', 'guardians.manage',
  'sms.manage', 'sms.view',
  'security.view',
  'audit.view',
  'backups.manage', 'backups.restore',
  'system.view',
  'sync.view', 'sync.manage',
  'website.manage', 'website.publish',
  // v1.2
  'fees.view', 'fees.manage', 'payments.configure',
  'exams.view', 'exams.manage', 'results.enter',
  'homework.view', 'homework.manage',
  'feedback.write',
  'idcards.manage',
  'analytics.view',
  'parent.portal',
  // v1.3: timetable & scheduling
  'timetable.view', 'timetable.manage', 'timetable.publish', 'substitutes.manage',
  'student.portal'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Staff-side permissions. Portal permissions belong to parent / student accounts only and are never granted to staff. */
const ALL = PERMISSIONS.filter((p) => p !== 'parent.portal' && p !== 'student.portal') as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  principal: ALL,
  admin: ALL.filter((p) => p !== 'backups.restore'),
  teacher: [
    'dashboard.view', 'classrooms.view', 'students.view', 'attendance.mark',
    'attendance.view_own', 'corrections.request', 'guardians.view',
    // Scoped to the teacher's assigned classrooms by the API.
    'exams.view', 'results.enter', 'homework.view', 'homework.manage', 'feedback.write'
  ],
  staff: ['dashboard.view', 'students.view', 'classrooms.view', 'attendance.view_all', 'reports.view', 'fees.view', 'exams.view', 'homework.view', 'timetable.view'],
  // A parent account sees only the children linked to its guardian record (enforced per request).
  parent: ['parent.portal'],
  // A student account sees only its own class timetable and notices (enforced per request).
  student: ['student.portal'],
  // Self-registered account awaiting review: no access to anything.
  unassigned: []
};

/** Permissions that only exist in the Standard package. */
export const STANDARD_ONLY: Permission[] = ['guardians.view', 'guardians.manage', 'sms.manage', 'sms.view', 'parent.portal'];

/** Permissions that may never be added to a staff account (extraPermissions) or to a parent. */
export const PARENT_ONLY: Permission[] = ['parent.portal', 'student.portal'];
/** Roles that sign in to a portal (not the staff dashboard). */
export const PORTAL_ROLES = ['parent', 'student'] as const;

export function effectivePermissions(
  role: Role,
  pkg: PackageTier,
  extra: Permission[] = [],
  revoked: Permission[] = []
): Permission[] {
  // Parents never receive extra staff permissions, and staff never receive parent-only ones.
  const allowedExtra = role === 'parent' || role === 'student' || role === 'unassigned' ? [] : extra.filter((p) => !PARENT_ONLY.includes(p));
  const set = new Set<Permission>([...(ROLE_PERMISSIONS[role] ?? []), ...allowedExtra]);
  for (const r of revoked) set.delete(r);
  if (pkg !== 'standard') for (const p of STANDARD_ONLY) set.delete(p);
  return [...set].sort();
}

export function hasPermission(perms: readonly string[], needed: Permission): boolean {
  return perms.includes(needed);
}

export const PACKAGE_FEATURES: Record<PackageTier, string[]> = {
  starter: [
    'students', 'classrooms', 'teachers', 'teacher_portal', 'assignments', 'attendance',
    'dashboard', 'attendance_reports', 'permissions', 'online', 'offline', 'lan', 'backups',
    'fees', 'online_payments', 'exams', 'homework', 'id_cards', 'analytics',
    'timetable', 'student_portal'
  ],
  standard: [] // filled below
};
PACKAGE_FEATURES.standard = [
  ...PACKAGE_FEATURES.starter,
  'guardians', 'sms_alerts', 'sms_templates', 'sms_provider', 'notification_history',
  'delivery_reports', 'retry_management', 'notification_automation',
  'parent_portal', 'whatsapp'
];

export function packageHasFeature(pkg: PackageTier, feature: string): boolean {
  return PACKAGE_FEATURES[pkg].includes(feature);
}
