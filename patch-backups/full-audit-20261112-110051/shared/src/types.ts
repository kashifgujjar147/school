import type { AttendanceStatus, PackageTier, Role, AppMode, Language } from './constants.js';
import type { Permission } from './logic/permissions.js';

export interface ApiOk<T> { ok: true; data: T; meta?: { page: number; pageSize: number; total: number } }
export interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown } }
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
}

export interface PublicConfig {
  schoolName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  defaultLanguage: Language;
  timeZone: string;
  dateFormat: string;
  package: PackageTier;
  mode: AppMode;
  websiteEnabled: boolean;
  version: string;
}

export interface AttendanceRow { studentId: string; status: AttendanceStatus; remark?: string | null; arrivalTime?: string | null }

export interface ServiceStatus { name: string; state: 'ok' | 'degraded' | 'down' | 'not_configured' | 'disabled'; detail?: string; checkedAt: string }
