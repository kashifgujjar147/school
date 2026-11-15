import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Coffee, Lock, Printer } from 'lucide-react';
import { WEEKDAY_NAMES, WEEKDAY_NAMES_UR, periodsForDay, type DatePlan, type PeriodDef, type TimetableConfigShape } from '@sms/shared';
import { useLang } from '../i18n';
import { Badge, Button, Card, EmptyState } from '../components/ui';

/** Inline English / Urdu copy (same convention as the website editor). */
export function useL() {
  const lang = useLang((s) => s.lang);
  return (en: string, ur?: string) => (lang === 'ur' && ur ? ur : en);
}
export function useDayName() {
  const lang = useLang((s) => s.lang);
  return (d: number, short = false) => {
    const n = (lang === 'ur' ? WEEKDAY_NAMES_UR : WEEKDAY_NAMES)[d] ?? String(d);
    return short && lang !== 'ur' ? n.slice(0, 3) : n;
  };
}

const PALETTE = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#dc2626', '#4f46e5', '#0d9488', '#ca8a04', '#9333ea'];
/** Stable colour for a subject: its own colour, or one derived from its name. */
export function subjectColor(name: string, own?: string | null) {
  if (own) return own;
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export interface GridLesson {
  id: string; day: number; periodKey: string; title: string; lines: string[]; color?: string | null;
  tone?: 'error' | 'warning' | null; toneText?: string; locked?: boolean; badge?: string | null; muted?: boolean;
}

/** Rows of the grid: every period of the default schedule plus any extra keys used by weekday schedules, in time order. */
function gridRows(config: TimetableConfigShape, days: number[]): PeriodDef[] {
  const rows = new Map<string, PeriodDef>();
  for (const p of config.periods) rows.set(p.key, p);
  for (const d of days) for (const p of periodsForDay(config, d)) if (!rows.has(p.key)) rows.set(p.key, p);
  return [...rows.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface WeekGridProps {
  config: TimetableConfigShape;
  lessons: GridLesson[];
  days?: number[];
  today?: number | null;
  /** Plans by weekday (holidays / special days of the shown week) for read-only portals. */
  plans?: DatePlan[];
  highlight?: string;
  onCell?: (day: number, periodKey: string, lesson: GridLesson | null) => void;
  onDrop?: (lessonId: string, day: number, periodKey: string) => void;
  emptyLabel?: string;
  freeLabel?: string;
}

/** Weekly timetable: periods down the side, working days across. Breaks are shown as distinct rows / cells. */
export function WeekGrid({ config, lessons, days, today, plans, highlight, onCell, onDrop, emptyLabel, freeLabel }: WeekGridProps) {
  const dayName = useDayName();
  const showDays = (days ?? config.workingDays).slice().sort((a, b) => a - b);
  const rows = useMemo(() => gridRows(config, showDays), [config, showDays.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCell = useMemo(() => { const m = new Map<string, GridLesson[]>(); for (const l of lessons) { const k = `${l.day}|${l.periodKey}`; m.set(k, [...(m.get(k) ?? []), l]); } return m; }, [lessons]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const q = highlight?.trim().toLowerCase() ?? '';
  return (
    <div className="print-area overflow-x-auto rounded-xl border border-surface-line bg-white">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-muted text-xs text-ink-soft">
            <th scope="col" className="w-28 border-b border-e border-surface-line px-2 py-2 text-start font-medium">&nbsp;</th>
            {showDays.map((d) => {
              const plan = plans?.find((p) => p.day === d);
              return (
                <th key={d} scope="col" className={clsx('border-b border-surface-line px-2 py-2 text-start font-semibold', d === today && 'bg-brand-soft text-brand')}>
                  {dayName(d)}
                  {plan && <span className="block text-[11px] font-normal text-ink-faint">{plan.date}{plan.label ? ` · ${plan.label}` : ''}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const allBreak = showDays.every((d) => { const p = periodsForDay(config, d).find((x) => x.key === row.key); return !p || p.kind !== 'teaching'; }) && row.kind !== 'teaching';
            if (allBreak) {
              return (
                <tr key={row.key} className="bg-amber-50/70">
                  <th scope="row" className="border-b border-e border-surface-line px-2 py-1.5 text-start text-xs font-medium text-amber-900"><span className="num">{row.start}–{row.end}</span></th>
                  <td colSpan={showDays.length} className="border-b border-surface-line px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-amber-900"><Coffee className="me-1.5 inline h-3.5 w-3.5" aria-hidden />{row.label}</td>
                </tr>
              );
            }
            return (
              <tr key={row.key}>
                <th scope="row" className="border-b border-e border-surface-line px-2 py-2 text-start align-top">
                  <span className="block text-xs font-semibold">{row.label}</span>
                  <span className="num block text-[11px] text-ink-faint">{row.start}–{row.end}</span>
                </th>
                {showDays.map((d) => {
                  const p = periodsForDay(config, d).find((x) => x.key === row.key);
                  const plan = plans?.find((x) => x.day === d);
                  const k = `${d}|${row.key}`;
                  if (plan?.closed) return <td key={d} className="border-b border-surface-line bg-surface-muted/60 px-2 py-2 text-center text-[11px] text-ink-faint">{plan.label ?? '—'}</td>;
                  if (!p) return <td key={d} className="border-b border-surface-line bg-surface-muted/40" aria-label="No period" />;
                  if (p.kind !== 'teaching') return <td key={d} className="border-b border-surface-line bg-amber-50/70 px-2 py-2 text-[11px] font-medium text-amber-900"><Coffee className="me-1 inline h-3 w-3" aria-hidden />{p.label}</td>;
                  const cell = byCell.get(k) ?? [];
                  const timeDiffers = p.start !== row.start || p.end !== row.end;
                  const droppable = Boolean(onDrop);
                  return (
                    <td key={d}
                      className={clsx('h-16 border-b border-surface-line p-1 align-top', d === today && 'bg-brand-soft/40', dragOver === k && 'bg-sky-100 ring-2 ring-inset ring-sky-400')}
                      onDragOver={droppable ? (e) => { e.preventDefault(); setDragOver(k); } : undefined}
                      onDragLeave={droppable ? () => setDragOver(null) : undefined}
                      onDrop={droppable ? (e: DragEvent) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/lesson'); if (id) onDrop!(id, d, row.key); } : undefined}>
                      {timeDiffers && <span className="num mb-0.5 block text-[10px] text-ink-faint">{p.start}–{p.end}</span>}
                      {cell.length === 0 ? (
                        onCell ? <button type="button" onClick={() => onCell(d, row.key, null)} className="no-print flex h-full min-h-[3.25rem] w-full items-center justify-center rounded-lg border border-dashed border-transparent text-xs text-ink-faint hover:border-surface-line hover:bg-surface-muted" aria-label={`${dayName(d)} ${row.label}: ${emptyLabel ?? 'add'}`}>+</button>
                          : <span className="block px-1 py-2 text-[11px] text-ink-faint">{freeLabel ?? ''}</span>
                      ) : cell.map((l) => {
                        const match = q && [l.title, ...l.lines].some((x) => x.toLowerCase().includes(q));
                        const Tag = onCell ? 'button' : 'div';
                        return (
                          <Tag key={l.id} {...(onCell ? { type: 'button' as const, onClick: () => onCell(d, row.key, l) } : {})}
                            draggable={droppable && !l.locked}
                            onDragStart={droppable ? (e: DragEvent) => { e.dataTransfer.setData('text/lesson', l.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                            title={l.toneText}
                            className={clsx('mb-0.5 block w-full rounded-lg border-s-4 bg-white px-2 py-1 text-start shadow-sm ring-1 ring-surface-line transition',
                              onCell && 'hover:ring-brand', droppable && !l.locked && 'cursor-grab active:cursor-grabbing',
                              l.tone === 'error' && '!ring-2 !ring-red-500', l.tone === 'warning' && '!ring-2 !ring-amber-400',
                              match && 'outline outline-2 outline-offset-1 outline-sky-500', l.muted && 'opacity-60')}
                            style={{ borderInlineStartColor: l.color ?? '#94a3b8' }}>
                            <span className="flex items-start justify-between gap-1">
                              <span className="block truncate text-xs font-semibold">{l.title}</span>
                              <span className="flex shrink-0 items-center gap-0.5">
                                {l.locked && <Lock className="h-3 w-3 text-ink-faint" aria-label="Locked" />}
                                {l.tone && <AlertTriangle className={clsx('h-3 w-3', l.tone === 'error' ? 'text-red-600' : 'text-amber-600')} aria-label={l.tone === 'error' ? 'Conflict' : 'Warning'} />}
                              </span>
                            </span>
                            {l.lines.filter(Boolean).map((x, i) => <span key={i} className="block truncate text-[11px] text-ink-soft">{x}</span>)}
                            {l.badge && <span className="mt-0.5 inline-block rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-800">{l.badge}</span>}
                          </Tag>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One day as a list (phones, "today" views). */
export function DayList({ periods, lessons, closedLabel, freeLabel, emptyLabel }: { periods: PeriodDef[]; lessons: GridLesson[]; closedLabel?: string | null; freeLabel: string; emptyLabel?: string }) {
  if (closedLabel !== undefined && closedLabel !== null) return <EmptyState>{closedLabel}</EmptyState>;
  if (!periods.length) return <EmptyState>{emptyLabel}</EmptyState>;
  return (
    <ol className="space-y-2">
      {periods.map((p) => {
        const here = lessons.filter((l) => l.periodKey === p.key);
        if (p.kind !== 'teaching') return <li key={p.key} className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="num w-24 shrink-0 text-xs">{p.start}–{p.end}</span><Coffee className="h-4 w-4" aria-hidden />{p.label}</li>;
        return (
          <li key={p.key} className="flex gap-3 rounded-xl border border-surface-line bg-white px-3 py-2">
            <span className="w-24 shrink-0"><span className="block text-xs font-semibold">{p.label}</span><span className="num block text-[11px] text-ink-faint">{p.start}–{p.end}</span></span>
            <span className="min-w-0 flex-1">
              {here.length === 0 ? <span className="text-sm text-ink-faint">{freeLabel}</span> : here.map((l) => (
                <span key={l.id} className={clsx('block border-s-4 ps-2', l.muted && 'opacity-60')} style={{ borderInlineStartColor: l.color ?? '#94a3b8' }}>
                  <span className="block text-sm font-semibold">{l.title} {l.badge && <Badge color="violet">{l.badge}</Badge>}</span>
                  {l.lines.filter(Boolean).map((x, i) => <span key={i} className="block text-xs text-ink-soft">{x}</span>)}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface Notice { _id: string; kind: string; title: string; body: string; date?: string | null; createdAt: string }
export function NoticeList({ notices, title, empty }: { notices: Notice[]; title: ReactNode; empty: string }) {
  return (
    <Card title={title}>
      {notices.length === 0 ? <p className="text-sm text-ink-faint">{empty}</p> : (
        <ul className="space-y-3">
          {notices.map((n) => (
            <li key={n._id}>
              <p className="text-sm font-medium">{n.title}</p>
              <p className="mt-0.5 line-clamp-4 whitespace-pre-line text-sm text-ink-soft">{n.body}</p>
              <p className="mt-0.5 text-xs text-ink-faint">{new Date(n.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PrintButton({ label }: { label: string }) {
  return <Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer className="h-4 w-4" />{label}</Button>;
}

/** Week / Day toggle; defaults to Day on small screens. */
export function useViewMode() {
  const [mode, setMode] = useState<'week' | 'day'>(() => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches ? 'day' : 'week'));
  return [mode, setMode] as const;
}
export function ViewToggle({ mode, onChange, week, day }: { mode: 'week' | 'day'; onChange: (m: 'week' | 'day') => void; week: string; day: string }) {
  return (
    <div className="no-print inline-flex rounded-lg border border-surface-line bg-white p-0.5 text-sm" role="group">
      {(['week', 'day'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)} className={clsx('rounded-md px-3 py-1.5 font-medium', mode === m ? 'bg-brand text-white' : 'text-ink-soft hover:bg-surface-muted')}>{m === 'week' ? week : day}</button>
      ))}
    </div>
  );
}

/** Today in the browser as YYYY-MM-DD (portals pass the server's date where it matters). */
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
