import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { PERIOD_KINDS, buildPeriods, periodMinutes, validateConfig, type PeriodDef, type PeriodKind, type TimetableConfigShape } from '@sms/shared';
import { useGet } from '../../hooks/useApi';
import { put } from '../../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, ErrorState, Input, Modal, Select, Spinner } from '../../components/ui';
import { useSettingsWorkingDays } from './useSettingsWorkingDays';
import { useDayName, useL } from '../../timetable/common';
import { useGuardedAction, type ConfigDoc } from './api';

const DEFAULT_PERIODS = buildPeriods({ start: '08:00', count: 7, minutes: 40, breaks: [{ afterPeriod: 4, minutes: 30, kind: 'lunch', label: 'Lunch' }] });

/** School opening/closing, working days, bell schedule (per weekday if needed), breaks, special days and teacher limits. */
export default function SetupTab({ sessionId, readOnly }: { sessionId: string; readOnly: boolean }) {
  const L = useL(); const dayName = useDayName();
  const qc = useQueryClient();
  const q = useGet<ConfigDoc | null>(`/api/timetable/config?sessionId=${sessionId}`);
  const attendanceDays = useSettingsWorkingDays();
  const [v, setV] = useState<TimetableConfigShape | null>(null);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [builder, setBuilder] = useState<null | { target: 'default' | number }>(null);
  const [affected, setAffected] = useState<number | null>(null);
  const g = useGuardedAction(() => { void qc.invalidateQueries({ predicate: (x) => String(x.queryKey[0] ?? '').startsWith('/api/timetable') }); });

  useEffect(() => {
    if (q.isLoading) return;
    const d = q.data?.data;
    if (d) { setV({ workingDays: d.workingDays, dayStart: d.dayStart, dayEnd: d.dayEnd, periods: d.periods, dayOverrides: d.dayOverrides ?? [], specialDays: d.specialDays ?? [], defaultPeriodMinutes: d.defaultPeriodMinutes ?? 40, teacherMaxPerDay: d.teacherMaxPerDay ?? null, teacherMaxPerWeek: d.teacherMaxPerWeek ?? null, avoidConsecutiveSameSubject: d.avoidConsecutiveSameSubject ?? true }); setVersion(d.version); }
    else setV({ workingDays: attendanceDays ?? [1, 2, 3, 4, 5, 6], dayStart: '07:45', dayEnd: '14:00', periods: DEFAULT_PERIODS, dayOverrides: [], specialDays: [], defaultPeriodMinutes: 40, teacherMaxPerDay: null, teacherMaxPerWeek: null, avoidConsecutiveSameSubject: true });
  }, [q.isLoading, q.data, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => (v ? validateConfig(v) : []), [v]);
  if (q.isLoading || !v) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const set = (p: Partial<TimetableConfigShape>) => setV({ ...v, ...p });
  const save = () => g.exec(async () => {
    const r = await put<{ config: ConfigDoc; affectedLessons: number }>('/api/timetable/config', { sessionId, ...v, specialDays: v.specialDays.map((s) => ({ ...s, periods: s.closed ? null : s.periods ?? null })), version });
    setVersion(r.config.version); setAffected(r.affectedLessons);
  }, L('School timings saved.', 'اسکول اوقات محفوظ ہو گئے۔'));
  const teaching = (ps: PeriodDef[]) => ps.filter((p) => p.kind === 'teaching').length;
  const weekly = v.workingDays.reduce((a, d) => a + teaching(v.dayOverrides.find((o) => o.day === d)?.periods ?? v.periods), 0);

  return (
    <div className="space-y-4">
      {g.toast}{g.dialogs}
      {affected !== null && affected > 0 && <Alert kind="warning">{L(`${affected} draft lesson(s) are now on a break or removed period. Fix them on the Timetable tab before publishing.`, `${affected} مسودہ پیریڈ اب وقفے یا ختم شدہ پیریڈ میں ہیں۔ شائع کرنے سے پہلے درست کریں۔`)}</Alert>}
      {!q.data?.data && <Alert kind="info">{L('Timings are not saved for this session yet. Adjust the starting point below and save.', 'اس سیشن کے اوقات ابھی محفوظ نہیں۔ نیچے ترتیب دیں اور محفوظ کریں۔')}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={L('School day', 'اسکول کا دن')}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input type="time" label={L('Opens', 'آغاز')} value={v.dayStart} disabled={readOnly} onChange={(e) => set({ dayStart: e.target.value })} />
              <Input type="time" label={L('Closes', 'اختتام')} value={v.dayEnd} disabled={readOnly} onChange={(e) => set({ dayEnd: e.target.value })} />
            </div>
            <fieldset>
              <legend className="label">{L('Working days', 'کام کے دن')}</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-line px-2.5 py-1.5 text-sm">
                    <input type="checkbox" disabled={readOnly} checked={v.workingDays.includes(d)} onChange={(e) => set({ workingDays: e.target.checked ? [...v.workingDays, d].sort() : v.workingDays.filter((x) => x !== d), dayOverrides: e.target.checked ? v.dayOverrides : v.dayOverrides.filter((o) => o.day !== d) })} />{dayName(d, true)}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-sm text-ink-soft">{L('Teaching periods per week', 'ہفتہ وار تدریسی پیریڈ')}: <span className="num font-semibold text-ink">{weekly}</span></p>
          </div>
        </Card>
        <Card title={L('Teacher load & preferences', 'اساتذہ کا بوجھ اور ترجیحات')} className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input type="number" min={1} max={24} label={L('Max periods per day (default)', 'روزانہ زیادہ سے زیادہ پیریڈ')} value={v.teacherMaxPerDay ?? ''} disabled={readOnly} hint={L('Empty = no limit. Teachers can have their own limit.', 'خالی = کوئی حد نہیں')} onChange={(e) => set({ teacherMaxPerDay: e.target.value ? Number(e.target.value) : null })} />
            <Input type="number" min={1} max={100} label={L('Max periods per week (default)', 'ہفتہ وار زیادہ سے زیادہ پیریڈ')} value={v.teacherMaxPerWeek ?? ''} disabled={readOnly} onChange={(e) => set({ teacherMaxPerWeek: e.target.value ? Number(e.target.value) : null })} />
            <Input type="number" min={10} max={180} label={L('Usual period length (minutes)', 'عام پیریڈ کا دورانیہ (منٹ)')} value={v.defaultPeriodMinutes} disabled={readOnly} onChange={(e) => set({ defaultPeriodMinutes: Number(e.target.value) || 40 })} />
          </div>
          <div className="mt-4"><Checkbox label={L('Avoid the same subject in back-to-back periods (unless double lessons are allowed)', 'ایک ہی مضمون مسلسل پیریڈ میں نہ رکھیں')} checked={v.avoidConsecutiveSameSubject} disabled={readOnly} onChange={(c) => set({ avoidConsecutiveSameSubject: c })} /></div>
        </Card>
      </div>

      <PeriodsCard title={L('Bell schedule (all working days)', 'گھنٹی کا شیڈول (تمام دن)')} periods={v.periods} readOnly={readOnly} onChange={(periods) => set({ periods })} onBuild={() => setBuilder({ target: 'default' })} />

      <Card title={L('Different schedule on some weekdays', 'کچھ دنوں کا الگ شیڈول')}>
        <p className="mb-3 text-sm text-ink-soft">{L('For example a shorter Friday. Lessons keep their period name, so give matching periods the same key.', 'مثلاً مختصر جمعہ۔ پیریڈ کی کلید وہی رکھیں۔')}</p>
        <div className="flex flex-wrap gap-2">
          {v.workingDays.map((d) => {
            const on = v.dayOverrides.some((o) => o.day === d);
            return <Checkbox key={d} label={dayName(d)} checked={on} disabled={readOnly} onChange={(c) => set({ dayOverrides: c ? [...v.dayOverrides, { day: d, periods: v.periods.map((p) => ({ ...p })) }] : v.dayOverrides.filter((o) => o.day !== d) })} />;
          })}
        </div>
        <div className="mt-4 space-y-4">
          {v.dayOverrides.slice().sort((a, b) => a.day - b.day).map((o) => (
            <PeriodsCard key={o.day} title={dayName(o.day)} periods={o.periods} readOnly={readOnly} onBuild={() => setBuilder({ target: o.day })}
              onChange={(periods) => set({ dayOverrides: v.dayOverrides.map((x) => (x.day === o.day ? { ...x, periods } : x)) })} />
          ))}
        </div>
      </Card>

      <SpecialDaysCard value={v.specialDays} readOnly={readOnly} periods={v.periods} onChange={(specialDays) => set({ specialDays })} />

      {errors.length > 0 && <Alert kind="error" title={L('Fix these before saving', 'محفوظ کرنے سے پہلے درست کریں')}><ul className="list-disc ps-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
      {!readOnly && <div className="flex justify-end"><Button loading={g.busy} disabled={errors.length > 0} onClick={() => void save()}>{L('Save school timings', 'اوقات محفوظ کریں')}</Button></div>}
      <PeriodBuilder open={builder !== null} defaultMinutes={v.defaultPeriodMinutes} start={v.dayStart} onClose={() => setBuilder(null)}
        onBuild={(periods) => { if (builder?.target === 'default') set({ periods }); else if (builder) set({ dayOverrides: v.dayOverrides.map((x) => (x.day === builder.target ? { ...x, periods } : x)) }); setBuilder(null); }} />
    </div>
  );
}

function PeriodsCard({ title, periods, onChange, readOnly, onBuild }: { title: string; periods: PeriodDef[]; onChange: (p: PeriodDef[]) => void; readOnly: boolean; onBuild: () => void }) {
  const L = useL();
  const kindLabel: Record<PeriodKind, string> = { teaching: L('Teaching', 'تدریس'), break: L('Break', 'وقفہ'), lunch: L('Lunch', 'لنچ'), assembly: L('Assembly', 'اسمبلی') };
  const upd = (i: number, p: Partial<PeriodDef>) => onChange(periods.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...periods]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };
  const nextKey = (kind: PeriodKind) => { const pre = kind === 'teaching' ? 'p' : 'b'; let i = 1; while (periods.some((p) => p.key === `${pre}${i}`)) i++; return `${pre}${i}`; };
  const last = periods[periods.length - 1];
  return (
    <Card title={title} actions={!readOnly && <Button variant="secondary" onClick={onBuild}><Wand2 className="h-4 w-4" />{L('Build periods', 'پیریڈ بنائیں')}</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-start text-xs text-ink-soft"><th className="p-1 text-start">{L('Name', 'نام')}</th><th className="p-1 text-start">{L('Key', 'کلید')}</th><th className="p-1 text-start">{L('Starts', 'آغاز')}</th><th className="p-1 text-start">{L('Ends', 'اختتام')}</th><th className="p-1 text-start">{L('Type', 'قسم')}</th><th className="p-1 text-start">{L('Minutes', 'منٹ')}</th><th /></tr></thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={i} className={p.kind !== 'teaching' ? 'bg-amber-50/60' : ''}>
                <td className="p-1"><input className="input" aria-label={L('Name', 'نام')} value={p.label} disabled={readOnly} onChange={(e) => upd(i, { label: e.target.value })} /></td>
                <td className="p-1"><input className="input w-20" aria-label={L('Key', 'کلید')} dir="ltr" value={p.key} disabled={readOnly} onChange={(e) => upd(i, { key: e.target.value.replace(/[^a-z0-9_-]/gi, '').slice(0, 20) })} /></td>
                <td className="p-1"><input className="input" type="time" aria-label={L('Starts', 'آغاز')} value={p.start} disabled={readOnly} onChange={(e) => upd(i, { start: e.target.value })} /></td>
                <td className="p-1"><input className="input" type="time" aria-label={L('Ends', 'اختتام')} value={p.end} disabled={readOnly} onChange={(e) => upd(i, { end: e.target.value })} /></td>
                <td className="p-1"><select className="input" aria-label={L('Type', 'قسم')} value={p.kind} disabled={readOnly} onChange={(e) => upd(i, { kind: e.target.value as PeriodKind })}>{PERIOD_KINDS.map((k) => <option key={k} value={k}>{kindLabel[k]}</option>)}</select></td>
                <td className="num p-1 text-ink-soft">{Number.isFinite(periodMinutes(p)) ? periodMinutes(p) : '—'}</td>
                <td className="whitespace-nowrap p-1">
                  {!readOnly && <>
                    <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={L('Move up', 'اوپر')}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className="rounded p-1.5 text-ink-faint hover:bg-surface-muted disabled:opacity-30" disabled={i === periods.length - 1} onClick={() => move(i, 1)} aria-label={L('Move down', 'نیچے')}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={() => onChange(periods.filter((_, j) => j !== i))} aria-label={L('Remove', 'ہٹائیں')}><Trash2 className="h-4 w-4" /></button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(['teaching', 'break', 'lunch'] as const).map((k) => (
            <Button key={k} variant="secondary" onClick={() => {
              const start = last?.end ?? '08:00'; const [h, m] = start.split(':').map(Number); const mins = k === 'teaching' ? 40 : 20; const t = (h! * 60 + m! + mins);
              onChange([...periods, { key: nextKey(k), label: k === 'teaching' ? `Period ${periods.filter((p) => p.kind === 'teaching').length + 1}` : kindLabel[k], start, end: `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, kind: k }]);
            }}><Plus className="h-4 w-4" />{kindLabel[k]}</Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function PeriodBuilder({ open, onClose, onBuild, defaultMinutes, start }: { open: boolean; onClose: () => void; onBuild: (p: PeriodDef[]) => void; defaultMinutes: number; start: string }) {
  const L = useL();
  const [f, setF] = useState({ start, count: 7, minutes: defaultMinutes, breakAfter: 3, breakMinutes: 15, lunchAfter: 5, lunchMinutes: 30 });
  useEffect(() => { if (open) setF((x) => ({ ...x, start, minutes: defaultMinutes })); }, [open, start, defaultMinutes]);
  const preview = buildPeriods({ start: f.start, count: f.count, minutes: f.minutes, breaks: [
    ...(f.breakAfter > 0 ? [{ afterPeriod: f.breakAfter, minutes: f.breakMinutes, kind: 'break' as const, label: 'Break' }] : []),
    ...(f.lunchAfter > 0 ? [{ afterPeriod: f.lunchAfter, minutes: f.lunchMinutes, kind: 'lunch' as const, label: 'Lunch' }] : [])
  ] });
  const num = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value) || 0 });
  return (
    <Modal open={open} onClose={onClose} title={L('Build periods', 'پیریڈ بنائیں')} wide footer={<><Button variant="secondary" onClick={onClose}>{L('Cancel', 'منسوخ')}</Button><Button onClick={() => onBuild(preview)}>{L('Replace periods', 'پیریڈ تبدیل کریں')}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input type="time" label={L('First period starts', 'پہلا پیریڈ')} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <Input type="number" min={1} max={14} label={L('Number of periods', 'پیریڈ کی تعداد')} value={f.count} onChange={num('count')} />
        <Input type="number" min={10} max={180} label={L('Period length (min)', 'دورانیہ (منٹ)')} value={f.minutes} onChange={num('minutes')} />
        <Input type="number" min={0} max={14} label={L('Break after period (0 = none)', 'وقفہ کس پیریڈ کے بعد')} value={f.breakAfter} onChange={num('breakAfter')} />
        <Input type="number" min={5} max={90} label={L('Break length (min)', 'وقفے کا دورانیہ')} value={f.breakMinutes} onChange={num('breakMinutes')} />
        <span className="hidden sm:block" />
        <Input type="number" min={0} max={14} label={L('Lunch after period (0 = none)', 'لنچ کس پیریڈ کے بعد')} value={f.lunchAfter} onChange={num('lunchAfter')} />
        <Input type="number" min={5} max={120} label={L('Lunch length (min)', 'لنچ کا دورانیہ')} value={f.lunchMinutes} onChange={num('lunchMinutes')} />
      </div>
      <ol className="mt-4 grid gap-1 text-sm sm:grid-cols-2">{preview.map((p) => <li key={p.key} className={`rounded-lg px-2 py-1 ${p.kind === 'teaching' ? 'bg-surface-muted' : 'bg-amber-50 text-amber-900'}`}><span className="num">{p.start}–{p.end}</span> · {p.label}</li>)}</ol>
    </Modal>
  );
}

function SpecialDaysCard({ value, onChange, readOnly, periods }: { value: TimetableConfigShape['specialDays']; onChange: (v: TimetableConfigShape['specialDays']) => void; readOnly: boolean; periods: PeriodDef[] }) {
  const L = useL();
  const [d, setD] = useState({ date: '', label: '', closed: true });
  return (
    <Card title={L('Special days & extra holidays', 'خاص دن اور اضافی چھٹیاں')}>
      <p className="mb-3 text-sm text-ink-soft">{L('Holidays added under Classrooms → Holidays already close the school. Use this for sports days, exam days or a shortened schedule on one date.', 'کلاس رومز میں درج چھٹیاں خود شامل ہیں۔ یہاں کھیلوں کا دن یا مختصر شیڈول درج کریں۔')}</p>
      {value.length > 0 && (
        <ul className="mb-3 space-y-2">
          {value.slice().sort((a, b) => a.date.localeCompare(b.date)).map((s) => (
            <li key={s.date} className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-line px-3 py-2 text-sm">
              <span className="num font-medium">{s.date}</span><span>{s.label}</span>
              <span className="text-xs text-ink-faint">{s.closed ? L('School closed', 'اسکول بند') : s.periods?.length ? L(`${s.periods.length} periods (special)`, 'خاص شیڈول') : L('Normal periods', 'عام پیریڈ')}</span>
              {!readOnly && !s.closed && <Button variant="ghost" onClick={() => onChange(value.map((x) => (x.date === s.date ? { ...x, periods: x.periods?.length ? null : periods.slice(0, Math.max(1, periods.length - 2)).map((p) => ({ ...p })) } : x)))}>{s.periods?.length ? L('Use normal periods', 'عام پیریڈ') : L('Shorter day (drop last periods)', 'مختصر دن')}</Button>}
              {!readOnly && <button type="button" className="ms-auto rounded p-1.5 text-red-600 hover:bg-red-50" aria-label={L('Remove', 'ہٹائیں')} onClick={() => onChange(value.filter((x) => x.date !== s.date))}><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="grid items-end gap-3 sm:grid-cols-[10rem_1fr_auto_auto]">
          <Input type="date" label={L('Date', 'تاریخ')} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          <Input label={L('Name', 'نام')} value={d.label} maxLength={80} onChange={(e) => setD({ ...d, label: e.target.value })} />
          <Select label={L('Type', 'قسم')} value={d.closed ? 'closed' : 'open'} onChange={(e) => setD({ ...d, closed: e.target.value === 'closed' })} options={[{ value: 'closed', label: L('School closed', 'اسکول بند') }, { value: 'open', label: L('Special schedule', 'خاص شیڈول') }]} />
          <Button variant="secondary" disabled={!d.date || !d.label.trim() || value.some((x) => x.date === d.date)} onClick={() => { onChange([...value, { date: d.date, label: d.label.trim(), closed: d.closed, periods: null }]); setD({ date: '', label: '', closed: true }); }}><Plus className="h-4 w-4" />{L('Add', 'شامل کریں')}</Button>
        </div>
      )}
    </Card>
  );
}
