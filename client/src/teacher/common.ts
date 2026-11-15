import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, type OutboxItem } from '../offline/db';
import { useAuth } from '../store/auth';

/** Today's date in the school's time zone (falls back to device time zone offline). */
export function todayIso(timeZone?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Calendar arithmetic on a YYYY-MM-DD date (done at UTC noon, so no time zone can shift the day). */
export function shiftIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Live view of this user's outbox (updates as items are queued/sent). */
export function useMyOutbox(): OutboxItem[] {
  const userId = useAuth((s) => s.user?.id);
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (!userId) return;
    const sub = liveQuery(() => db.outbox.where('userId').equals(userId).reverse().sortBy('createdAt')).subscribe({ next: setItems, error: () => setItems([]) });
    return () => sub.unsubscribe();
  }, [userId]);
  return items;
}

export interface ClassroomLite { _id: string; name: string; className?: string; sectionName?: string; studentCount: number; room?: string }
export interface RosterStudent { _id: string; fullName: string; admissionNumber: string; photoPath?: string }
export interface Roster {
  classroom: { _id: string; name: string };
  date: string;
  students: RosterStudent[];
  sheet: { _id: string; submittedAt: string; counts: Record<string, number> } | null;
  records: { _id: string; studentId: string; status: string; originalStatus: string; corrected: boolean; remark?: string }[];
  canSubmit: boolean;
  blockedReason: string | null;
  policy: { lateThresholdTime: string | null; cutoffTime: string | null };
}
