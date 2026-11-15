import { useGet } from '../hooks/useApi';

export interface ClassroomRow {
  _id: string; name: string; classId: string; sectionId: string; sessionId: string; room?: string; capacity?: number; archived: boolean;
  className?: string; sectionName?: string; studentCount: number; teachers: { id: string; assignmentId: string; name?: string; isHomeroom: boolean }[];
}
export interface ClassRow { _id: string; name: string; order: number; archived: boolean; sections: { _id: string; name: string; archived: boolean }[] }
export interface SessionRow { _id: string; name: string; startDate: string; endDate: string; isDefault: boolean; archived: boolean }

export const useClassrooms = () => useGet<ClassroomRow[]>('/api/academic/classrooms');
export const useClasses = () => useGet<ClassRow[]>('/api/academic/classes');
export const useSessions = () => useGet<SessionRow[]>('/api/academic/sessions');

export const classroomOptions = (rooms: ClassroomRow[] | undefined) => (rooms ?? []).map((r) => ({ value: r._id, label: r.name }));

export function dateRangePreset(kind: 'today' | 'week' | 'month'): { from: string; to: string } {
  const now = new Date(); const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (kind === 'today') return { from: iso(now), to: iso(now) };
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: iso(d), to: iso(now) }; }
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1, 12)), to: iso(now) };
}
