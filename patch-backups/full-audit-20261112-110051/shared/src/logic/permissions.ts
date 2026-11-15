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
  'website.manage'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  principal: ALL,
  admin: ALL.filter((p) => p !== 'backups.restore'),
  teacher: [
    'dashboard.view', 'classrooms.view', 'students.view', 'attendance.mark',
    'attendance.view_own', 'corrections.request', 'guardians.view'
  ],
  staff: ['dashboard.view', 'students.view', 'classrooms.view', 'attendance.view_all', 'reports.view']
};

/** Permissions that only exist in the Standard package. */
export const STANDARD_ONLY: Permission[] = ['guardians.view', 'guardians.manage', 'sms.manage', 'sms.view'];

export function effectivePermissions(
  role: Role,
  pkg: PackageTier,
  extra: Permission[] = [],
  revoked: Permission[] = []
): Permission[] {
  const set = new Set<Permission>([...ROLE_PERMISSIONS[role], ...extra]);
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
    'dashboard', 'attendance_reports', 'permissions', 'online', 'offline', 'lan', 'backups'
  ],
  standard: [] // filled below
};
PACKAGE_FEATURES.standard = [
  ...PACKAGE_FEATURES.starter,
  'guardians', 'sms_alerts', 'sms_templates', 'sms_provider', 'notification_history',
  'delivery_reports', 'retry_management', 'notification_automation'
];

export function packageHasFeature(pkg: PackageTier, feature: string): boolean {
  return PACKAGE_FEATURES[pkg].includes(feature);
}
