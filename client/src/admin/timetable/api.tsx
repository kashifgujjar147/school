import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { teachingPeriodsForDay, type Conflict, type TimetableConfigShape } from '@sms/shared';
import { ApiError } from '../../services/api';
import { Alert, Button, Modal, errorMessage } from '../../components/ui';
import { useDayName, useL } from '../../timetable/common';

export interface ConfigDoc extends TimetableConfigShape { _id: string; sessionId: string; version: number }
export interface Entry { _id: string; classroomId: string; day: number; periodKey: string; subjectId: string; teacherId: string | null; roomId: string | null; locked: boolean; source?: string }
export interface ClassroomRow { _id: string; name: string; classId: string; sectionId: string; room: string | null; className: string; classOrder: number; sectionName: string }
export interface SubjectRow { _id: string; name: string; code?: string | null; color?: string | null; archived: boolean; version: number }
export interface RoomRow { _id: string; name: string; kind: string; capacity?: number | null; unavailable: string[]; archived: boolean; version: number }
export interface Profile { _id: string; teacherId: string; subjectIds: string[]; maxPerDay: number | null; maxPerWeek: number | null; unavailable: string[] }
export interface Requirement { id: string; classroomId: string; subjectId: string; teacherId: string | null; roomId: string | null; periodsPerWeek: number; maxPerDay: number; allowDouble?: boolean }
export interface Generation {
  at: string; by: string; seed: number; status: 'complete' | 'incomplete'; classroomIds: string[];
  stats: { required: number; placed: number; iterations: number; softPenalty: number; ms: number };
  unplaced: { requirementId: string; classroomId: string; subjectId: string; teacherId: string | null; missing: number; reasons: string[]; suggestion: string }[];
  diagnostics: { code: string; message: string; suggestion: string }[];
}
export interface Board {
  meta: { version: number; status: 'empty' | 'draft' | 'published'; draftDirty: boolean; publishedAt: string | null; publishedBy: string | null; publishCount: number; draftUpdatedAt: string | null; lastGeneration: Generation | null };
  state: 'draft' | 'published';
  config: ConfigDoc | null;
  entries: Entry[];
  conflicts: Conflict[];
  classrooms: ClassroomRow[];
  teachers: { _id: string; fullName: string; role: string }[];
  profiles: Profile[];
  rooms: RoomRow[];
  subjects: SubjectRow[];
  requirements: Requirement[];
}

/**
 * Runs a draft change with the server's safety rules made visible:
 *  - 422 TIMETABLE_WARNINGS → show what the change would cause and resend only after confirmation
 *  - 409 TIMETABLE_CONFLICT → show the hard conflicts (nothing is saved)
 *  - 409 CONFLICT (stale version) → someone else changed the timetable: reload
 */
export function useGuardedAction(reload: () => void) {
  const L = useL();
  const [pending, setPending] = useState<{ conflicts: Conflict[]; resend: () => Promise<void> } | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; conflicts: Conflict[]; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  async function exec(fn: (confirm: boolean) => Promise<unknown>, success?: string): Promise<boolean> {
    setBusy(true); setToast(null);
    try {
      await fn(false);
      if (success) setToast({ kind: 'success', text: success });
      reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'TIMETABLE_WARNINGS') {
        const conflicts = ((e.details as { conflicts?: Conflict[] })?.conflicts) ?? [];
        setPending({ conflicts, resend: async () => { await fn(true); if (success) setToast({ kind: 'success', text: success }); reload(); } });
      } else if (e instanceof ApiError && e.code === 'TIMETABLE_CONFLICT') {
        setBlocked({ title: L('This change is not allowed', 'یہ تبدیلی ممکن نہیں'), conflicts: ((e.details as { conflicts?: Conflict[] })?.conflicts) ?? [], message: e.message });
      } else if (e instanceof ApiError && e.status === 409 && e.code === 'CONFLICT') {
        setToast({ kind: 'info', text: L('Someone else changed the timetable. It has been reloaded — please try again.', 'کسی اور نے ٹائم ٹیبل تبدیل کیا ہے۔ دوبارہ لوڈ کر دیا گیا — دوبارہ کوشش کریں۔') });
        reload();
      } else {
        setToast({ kind: 'error', text: errorMessage(e, L('Something went wrong', 'کچھ غلط ہو گیا')) });
      }
      return false;
    } finally { setBusy(false); }
  }

  const dialogs = (
    <>
      <Modal open={pending !== null} onClose={() => setPending(null)} title={L('Please confirm', 'تصدیق کریں')}
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>{L('Cancel', 'منسوخ')}</Button>
          <Button loading={busy} onClick={async () => { const p = pending!; setBusy(true); try { await p.resend(); setPending(null); } catch (e) { setPending(null); setToast({ kind: 'error', text: errorMessage(e, 'Error') }); } finally { setBusy(false); } }}>{L('Save anyway', 'پھر بھی محفوظ کریں')}</Button></>}>
        <p className="mb-3 text-sm text-ink-soft">{L('This change is allowed but causes the following:', 'یہ تبدیلی ممکن ہے لیکن اس سے یہ ہو گا:')}</p>
        <ConflictList conflicts={pending?.conflicts ?? []} />
      </Modal>
      <Modal open={blocked !== null} onClose={() => setBlocked(null)} title={blocked?.title ?? ''} footer={<Button onClick={() => setBlocked(null)}>{L('OK', 'ٹھیک ہے')}</Button>}>
        {blocked?.message && <p className="mb-3 text-sm text-ink-soft">{L('Nothing was saved.', 'کچھ محفوظ نہیں ہوا۔')}</p>}
        <ConflictList conflicts={blocked?.conflicts ?? []} />
      </Modal>
    </>
  );
  const toastEl = toast ? <Alert kind={toast.kind}>{toast.text}</Alert> : null;
  return { exec, dialogs, toast: toastEl, busy, setToast };
}

export function ConflictList({ conflicts, onPick }: { conflicts: Conflict[]; onPick?: (c: Conflict) => void }) {
  if (!conflicts.length) return null;
  return (
    <ul className="space-y-1.5">
      {conflicts.map((c) => (
        <li key={c.key}>
          <button type="button" disabled={!onPick} onClick={() => onPick?.(c)} className={clsx('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start text-sm', c.severity === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900', onPick && 'hover:ring-1 hover:ring-current')}>
            <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', c.severity === 'error' ? 'bg-red-500' : 'bg-amber-500')} aria-hidden />
            <span>{c.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Click-to-toggle grid of teaching slots ("day:periodKey"), used for teacher / room unavailability. */
export function SlotPicker({ config, value, onChange, label }: { config: TimetableConfigShape; value: string[]; onChange: (v: string[]) => void; label: ReactNode }) {
  const dayName = useDayName(); const L = useL();
  const days = [...config.workingDays].sort();
  const keys = [...new Map(days.flatMap((d) => teachingPeriodsForDay(config, d)).map((p) => [p.key, p])).values()].sort((a, b) => a.start.localeCompare(b.start));
  const set = new Set(value);
  const toggle = (k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); onChange([...n]); };
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <p className="mb-2 text-xs text-ink-faint">{L('Click periods to mark them unavailable (red).', 'غیر دستیاب پیریڈ پر کلک کریں (سرخ)۔')}</p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead><tr><th className="p-1" />{keys.map((p) => <th key={p.key} className="p-1 font-medium text-ink-soft">{p.label}</th>)}</tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <th className="p-1 pe-2 text-start font-medium">{dayName(d, true)}</th>
                {keys.map((p) => {
                  const exists = teachingPeriodsForDay(config, d).some((x) => x.key === p.key);
                  const k = `${d}:${p.key}`; const on = set.has(k);
                  return <td key={p.key} className="p-0.5">{exists ? <button type="button" aria-pressed={on} aria-label={`${dayName(d)} ${p.label}`} onClick={() => toggle(k)} className={clsx('h-7 w-9 rounded border text-[10px]', on ? 'border-red-400 bg-red-500 text-white' : 'border-surface-line bg-white hover:bg-surface-muted')}>{on ? '✕' : ''}</button> : <span className="block h-7 w-9 rounded bg-surface-muted" />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}
