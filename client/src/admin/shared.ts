import { useGet } from '../hooks/useApi';
import { shiftIso, todayIso } from '../teacher/common';

export interface ClassroomRow {
  _id: string; name: string; classId: string; sectionId: string; sessionId: string; room?: string; capacity?: number; archived: boolean;
  className?: string; sectionName?: string; studentCount: number; teachers: { id: string; assignmentId: string; name?: string; isHomeroom: boolean }[];
}
export interface ClassRow { _id: string; name: string; order: number; archived: boolean; sections: { _id: string; name: string; archived: boolean }[] }
export interface SessionRow { _id: string; name: string; startDate: string; endDate: string; isDefault: boolean; archived: boolean }

export const useClassrooms = () => useGet<ClassroomRow[]>('/api/academic/classrooms');
export const useClasses = () => useGet<ClassRow[]>('/api/academic/classes');
export const useSessions = () => useGet<SessionRow[]>('/api/academic/sessions');

export interface CustomFieldDef { key: string; label: string }
/** Custom student field definitions (Settings → Academic). Empty when the user cannot read settings. */
export function useCustomFields(enabled: boolean): CustomFieldDef[] {
  const q = useGet<{ studentCustomFields?: CustomFieldDef[] }>(enabled ? '/api/settings' : null);
  return q.data?.data.studentCustomFields ?? [];
}

export const classroomOptions = (rooms: ClassroomRow[] | undefined) => (rooms ?? []).map((r) => ({ value: r._id, label: r.name }));

/**
 * Date-range presets in the SCHOOL's calendar. Using the browser's UTC date would give "yesterday"
 * for a UTC+5 school before 05:00, so everything is derived from todayIso(timeZone).
 */
export function dateRangePreset(kind: 'today' | 'week' | 'month', timeZone?: string): { from: string; to: string } {
  const today = todayIso(timeZone);
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'week') { const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); return { from: shiftIso(today, -((dow + 6) % 7)), to: today }; }
  return { from: `${today.slice(0, 8)}01`, to: today };
}
