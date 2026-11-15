/**
 * Timetable domain logic, shared by the API (authoritative) and the dashboard (instant feedback).
 * Dependency-free and deterministic: the same input and seed always produce the same timetable.
 *
 *  - Bell schedule helpers: periods per weekday, special days, period builder.
 *  - validateTimetable(): every hard conflict (double bookings, breaks, non-working days) and every
 *    soft problem (availability, load limits, weekly requirements) in a set of entries.
 *  - generateTimetable(): a constraint-based generator (iterative forward search with conflict-directed
 *    "kick-out" repair, the approach used by course timetabling solvers). Hard constraints are never
 *    violated; soft preferences shape the choice between valid slots. Anything that cannot be placed is
 *    reported with reasons and suggestions instead of being silently dropped.
 */

export const PERIOD_KINDS = ['teaching', 'break', 'lunch', 'assembly'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_NAMES_UR = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'] as const;

export interface PeriodDef { key: string; label: string; start: string; end: string; kind: PeriodKind }
export interface DaySchedule { day: number; periods: PeriodDef[] }
export interface SpecialDay { date: string; label: string; closed: boolean; periods?: PeriodDef[] | null }

export interface TimetableConfigShape {
  workingDays: number[];
  dayStart: string;
  dayEnd: string;
  periods: PeriodDef[];
  dayOverrides: DaySchedule[];
  specialDays: SpecialDay[];
  defaultPeriodMinutes: number;
  teacherMaxPerDay: number | null;
  teacherMaxPerWeek: number | null;
  avoidConsecutiveSameSubject: boolean;
}

export interface TEntry {
  id: string; classroomId: string; day: number; periodKey: string;
  subjectId: string; teacherId: string | null; roomId: string | null; locked?: boolean;
}
export interface TTeacher { id: string; unavailable: string[]; maxPerDay: number | null; maxPerWeek: number | null; subjectIds: string[] }
export interface TRoom { id: string; unavailable: string[] }
export interface TRequirement {
  id: string; classroomId: string; subjectId: string; teacherId: string | null; roomId: string | null;
  periodsPerWeek: number; maxPerDay: number; allowDouble?: boolean;
}

export const slotKey = (day: number, periodKey: string) => `${day}:${periodKey}`;

// ---------------------------------------------------------------- Time & bell schedule
export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
export function fromMinutes(n: number): string {
  const h = Math.floor(n / 60); const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export const periodMinutes = (p: { start: string; end: string }) => toMinutes(p.end) - toMinutes(p.start);

/** Periods of a weekday (0 = Sunday): the weekday override if any, else the default schedule; none on non-working days. */
export function periodsForDay(cfg: Pick<TimetableConfigShape, 'workingDays' | 'periods' | 'dayOverrides'>, day: number): PeriodDef[] {
  if (!cfg.workingDays.includes(day)) return [];
  return cfg.dayOverrides.find((o) => o.day === day)?.periods ?? cfg.periods;
}
export const teachingPeriodsForDay = (cfg: Pick<TimetableConfigShape, 'workingDays' | 'periods' | 'dayOverrides'>, day: number) =>
  periodsForDay(cfg, day).filter((p) => p.kind === 'teaching');

/** Every teaching slot of the week, in day order then period order. */
export function teachingSlots(cfg: Pick<TimetableConfigShape, 'workingDays' | 'periods' | 'dayOverrides'>, days?: number[]): { day: number; periodKey: string }[] {
  const out: { day: number; periodKey: string }[] = [];
  for (const day of [...cfg.workingDays].sort((a, b) => a - b)) {
    if (days && !days.includes(day)) continue;
    for (const p of teachingPeriodsForDay(cfg, day)) out.push({ day, periodKey: p.key });
  }
  return out;
}

/** Weekday (0 = Sunday) of an ISO date, independent of the machine's time zone. */
export const weekdayOf = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).getUTCDay();

export interface DatePlan { date: string; day: number; closed: boolean; label: string | null; periods: PeriodDef[] }
/**
 * What actually happens on a calendar date: closed for holidays / non-working days / closed special days;
 * a special day with its own bell schedule replaces the weekday's periods (lessons keep their period key).
 */
export function planForDate(cfg: TimetableConfigShape, isoDate: string, holidays: { date: string; endDate?: string | null; name: string }[] = []): DatePlan {
  const day = weekdayOf(isoDate);
  const holiday = holidays.find((h) => isoDate >= h.date && isoDate <= (h.endDate || h.date));
  if (holiday) return { date: isoDate, day, closed: true, label: holiday.name, periods: [] };
  const special = cfg.specialDays.find((s) => s.date === isoDate);
  if (special?.closed) return { date: isoDate, day, closed: true, label: special.label, periods: [] };
  if (!cfg.workingDays.includes(day)) return { date: isoDate, day, closed: true, label: null, periods: [] };
  if (special) return { date: isoDate, day, closed: false, label: special.label, periods: special.periods?.length ? special.periods : periodsForDay(cfg, day) };
  return { date: isoDate, day, closed: false, label: null, periods: periodsForDay(cfg, day) };
}

/** Builds a bell schedule from opening time, period count / length and breaks (a starting point the admin can edit). */
export function buildPeriods(opts: { start: string; count: number; minutes: number; breaks: { afterPeriod: number; minutes: number; kind: Exclude<PeriodKind, 'teaching'>; label: string }[] }): PeriodDef[] {
  const out: PeriodDef[] = [];
  let t = toMinutes(opts.start);
  let b = 0;
  for (let i = 1; i <= opts.count; i++) {
    out.push({ key: `p${i}`, label: `Period ${i}`, start: fromMinutes(t), end: fromMinutes(t + opts.minutes), kind: 'teaching' });
    t += opts.minutes;
    for (const br of opts.breaks.filter((x) => x.afterPeriod === i)) {
      b++;
      out.push({ key: `b${b}`, label: br.label, start: fromMinutes(t), end: fromMinutes(t + br.minutes), kind: br.kind });
      t += br.minutes;
    }
  }
  return out;
}

/** Problems that make a bell schedule unusable. Empty array = valid. */
export function validatePeriods(periods: PeriodDef[], dayStart: string, dayEnd: string, where = 'Default schedule'): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const open = toMinutes(dayStart); const close = toMinutes(dayEnd);
  if (!(open < close)) errors.push('School opening time must be before closing time.');
  let prevEnd = -1;
  for (const p of periods) {
    if (keys.has(p.key)) errors.push(`${where}: period key "${p.key}" is used twice.`);
    keys.add(p.key);
    const a = toMinutes(p.start); const z = toMinutes(p.end);
    if (!(a < z)) errors.push(`${where}: "${p.label}" must end after it starts.`);
    if (a < open || z > close) errors.push(`${where}: "${p.label}" (${p.start}–${p.end}) is outside school hours (${dayStart}–${dayEnd}).`);
    if (a < prevEnd) errors.push(`${where}: "${p.label}" overlaps the period before it. List periods in time order without overlaps.`);
    prevEnd = Math.max(prevEnd, z);
  }
  if (periods.length && !periods.some((p) => p.kind === 'teaching')) errors.push(`${where}: there is no teaching period.`);
  return errors;
}

export function validateConfig(cfg: TimetableConfigShape): string[] {
  const errors: string[] = [];
  if (!cfg.workingDays.length) errors.push('Choose at least one working day.');
  if (!cfg.periods.length) errors.push('Add at least one period.');
  errors.push(...validatePeriods(cfg.periods, cfg.dayStart, cfg.dayEnd));
  for (const o of cfg.dayOverrides) {
    if (!cfg.workingDays.includes(o.day)) errors.push(`${WEEKDAY_NAMES[o.day]} has its own schedule but is not a working day.`);
    errors.push(...validatePeriods(o.periods, cfg.dayStart, cfg.dayEnd, WEEKDAY_NAMES[o.day] ?? `Day ${o.day}`).filter((e) => !e.startsWith('School opening')));
  }
  const seen = new Set<string>();
  for (const s of cfg.specialDays) {
    if (seen.has(s.date)) errors.push(`Special day ${s.date} is listed twice.`);
    seen.add(s.date);
    if (!s.closed && s.periods?.length) errors.push(...validatePeriods(s.periods, cfg.dayStart, cfg.dayEnd, `Special day ${s.date}`).filter((e) => !e.startsWith('School opening')));
  }
  return [...new Set(errors)];
}

// ---------------------------------------------------------------- Validation
export type ConflictCode =
  | 'class_clash' | 'teacher_clash' | 'room_clash' | 'not_working_day' | 'not_teaching_period'
  | 'teacher_unavailable' | 'room_unavailable' | 'teacher_day_limit' | 'teacher_week_limit' | 'subject_day_limit'
  | 'requirement_short' | 'requirement_excess' | 'teacher_not_qualified' | 'consecutive_same_subject';

export const HARD_CONFLICTS: ConflictCode[] = ['class_clash', 'teacher_clash', 'room_clash', 'not_working_day', 'not_teaching_period'];

export interface Conflict {
  key: string; code: ConflictCode; severity: 'error' | 'warning'; message: string; entryIds: string[];
  classroomId?: string; teacherId?: string; roomId?: string; subjectId?: string; day?: number; periodKey?: string;
}

export interface Namer {
  classroom: (id: string) => string; teacher: (id: string) => string; room: (id: string) => string; subject: (id: string) => string;
  period: (day: number, key: string) => string;
}
const idNamer: Namer = { classroom: (x) => x, teacher: (x) => x, room: (x) => x, subject: (x) => x, period: (d, k) => `${WEEKDAY_NAMES[d] ?? d} ${k}` };

export interface ValidateInput {
  config: TimetableConfigShape; entries: TEntry[]; teachers: TTeacher[]; rooms: TRoom[]; requirements: TRequirement[];
  /** Only report requirement shortfalls for these classrooms (e.g. the ones that have requirements configured). */
  names?: Partial<Namer>;
}

/** Every conflict in a set of entries. Hard ones (severity error) can never be saved or published. */
export function validateTimetable(input: ValidateInput): Conflict[] {
  const n: Namer = { ...idNamer, ...input.names };
  const { config, entries } = input;
  const out: Conflict[] = [];
  const push = (c: Omit<Conflict, 'severity'>) => out.push({ ...c, severity: HARD_CONFLICTS.includes(c.code) ? 'error' : 'warning' });
  const teachers = new Map(input.teachers.map((t) => [t.id, t]));
  const rooms = new Map(input.rooms.map((r) => [r.id, r]));

  const groupBy = (f: (e: TEntry) => string | null) => {
    const m = new Map<string, TEntry[]>();
    for (const e of entries) { const k = f(e); if (k === null) continue; const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); }
    return m;
  };
  for (const [k, list] of groupBy((e) => `${e.classroomId}|${e.day}|${e.periodKey}`)) if (list.length > 1) {
    const e = list[0]!;
    push({ key: `class_clash|${k}`, code: 'class_clash', entryIds: list.map((x) => x.id), classroomId: e.classroomId, day: e.day, periodKey: e.periodKey,
      message: `${n.classroom(e.classroomId)} has ${list.length} lessons in ${n.period(e.day, e.periodKey)}.` });
  }
  for (const [k, list] of groupBy((e) => (e.teacherId ? `${e.teacherId}|${e.day}|${e.periodKey}` : null))) if (list.length > 1) {
    const e = list[0]!;
    push({ key: `teacher_clash|${k}`, code: 'teacher_clash', entryIds: list.map((x) => x.id), teacherId: e.teacherId!, day: e.day, periodKey: e.periodKey,
      message: `${n.teacher(e.teacherId!)} is double-booked in ${n.period(e.day, e.periodKey)} (${list.map((x) => n.classroom(x.classroomId)).join(', ')}).` });
  }
  for (const [k, list] of groupBy((e) => (e.roomId ? `${e.roomId}|${e.day}|${e.periodKey}` : null))) if (list.length > 1) {
    const e = list[0]!;
    push({ key: `room_clash|${k}`, code: 'room_clash', entryIds: list.map((x) => x.id), roomId: e.roomId!, day: e.day, periodKey: e.periodKey,
      message: `${n.room(e.roomId!)} is booked twice in ${n.period(e.day, e.periodKey)} (${list.map((x) => n.classroom(x.classroomId)).join(', ')}).` });
  }

  for (const e of entries) {
    const periods = periodsForDay(config, e.day);
    const p = periods.find((x) => x.key === e.periodKey);
    if (!config.workingDays.includes(e.day)) {
      push({ key: `not_working_day|${e.id}`, code: 'not_working_day', entryIds: [e.id], classroomId: e.classroomId, day: e.day, periodKey: e.periodKey,
        message: `${n.classroom(e.classroomId)}: ${n.subject(e.subjectId)} is on ${WEEKDAY_NAMES[e.day] ?? e.day}, which is not a working day.` });
    } else if (!p || p.kind !== 'teaching') {
      push({ key: `not_teaching_period|${e.id}`, code: 'not_teaching_period', entryIds: [e.id], classroomId: e.classroomId, day: e.day, periodKey: e.periodKey,
        message: `${n.classroom(e.classroomId)}: ${n.subject(e.subjectId)} is placed in ${p ? `${p.label} (${p.kind})` : `a period that no longer exists on ${WEEKDAY_NAMES[e.day]}`}, not a teaching period.` });
    }
    const t = e.teacherId ? teachers.get(e.teacherId) : undefined;
    if (t?.unavailable.includes(slotKey(e.day, e.periodKey))) {
      push({ key: `teacher_unavailable|${e.id}`, code: 'teacher_unavailable', entryIds: [e.id], teacherId: t.id, day: e.day, periodKey: e.periodKey,
        message: `${n.teacher(t.id)} is marked unavailable in ${n.period(e.day, e.periodKey)}.` });
    }
    if (t && t.subjectIds.length && !t.subjectIds.includes(e.subjectId)) {
      push({ key: `teacher_not_qualified|${e.id}`, code: 'teacher_not_qualified', entryIds: [e.id], teacherId: t.id, subjectId: e.subjectId,
        message: `${n.teacher(t.id)} is not listed as teaching ${n.subject(e.subjectId)}.` });
    }
    const r = e.roomId ? rooms.get(e.roomId) : undefined;
    if (r?.unavailable.includes(slotKey(e.day, e.periodKey))) {
      push({ key: `room_unavailable|${e.id}`, code: 'room_unavailable', entryIds: [e.id], roomId: r.id, day: e.day, periodKey: e.periodKey,
        message: `${n.room(r.id)} is not available in ${n.period(e.day, e.periodKey)}.` });
    }
  }

  // Teacher load limits.
  for (const t of input.teachers) {
    const mine = entries.filter((e) => e.teacherId === t.id);
    const perDay = t.maxPerDay ?? config.teacherMaxPerDay;
    const perWeek = t.maxPerWeek ?? config.teacherMaxPerWeek;
    if (perWeek !== null && mine.length > perWeek) {
      push({ key: `teacher_week_limit|${t.id}`, code: 'teacher_week_limit', entryIds: mine.map((e) => e.id), teacherId: t.id,
        message: `${n.teacher(t.id)} teaches ${mine.length} periods a week; the limit is ${perWeek}.` });
    }
    if (perDay !== null) for (const day of config.workingDays) {
      const d = mine.filter((e) => e.day === day);
      if (d.length > perDay) push({ key: `teacher_day_limit|${t.id}|${day}`, code: 'teacher_day_limit', entryIds: d.map((e) => e.id), teacherId: t.id, day,
        message: `${n.teacher(t.id)} teaches ${d.length} periods on ${WEEKDAY_NAMES[day]}; the limit is ${perDay}.` });
    }
  }

  // Weekly requirements and per-day subject limits.
  for (const req of input.requirements) {
    const mine = entries.filter((e) => e.classroomId === req.classroomId && e.subjectId === req.subjectId);
    if (mine.length < req.periodsPerWeek) push({ key: `requirement_short|${req.classroomId}|${req.subjectId}`, code: 'requirement_short', entryIds: mine.map((e) => e.id), classroomId: req.classroomId, subjectId: req.subjectId,
      message: `${n.classroom(req.classroomId)}: ${n.subject(req.subjectId)} has ${mine.length} of ${req.periodsPerWeek} weekly periods.` });
    if (mine.length > req.periodsPerWeek) push({ key: `requirement_excess|${req.classroomId}|${req.subjectId}`, code: 'requirement_excess', entryIds: mine.map((e) => e.id), classroomId: req.classroomId, subjectId: req.subjectId,
      message: `${n.classroom(req.classroomId)}: ${n.subject(req.subjectId)} has ${mine.length} weekly periods; ${req.periodsPerWeek} are required.` });
    for (const day of config.workingDays) {
      const d = mine.filter((e) => e.day === day);
      if (d.length > req.maxPerDay) push({ key: `subject_day_limit|${req.classroomId}|${req.subjectId}|${day}`, code: 'subject_day_limit', entryIds: d.map((e) => e.id), classroomId: req.classroomId, subjectId: req.subjectId, day,
        message: `${n.classroom(req.classroomId)}: ${n.subject(req.subjectId)} appears ${d.length} times on ${WEEKDAY_NAMES[day]}; at most ${req.maxPerDay} allowed.` });
    }
  }

  // Same subject in back-to-back periods (soft).
  if (config.avoidConsecutiveSameSubject) {
    const doubles = new Set(input.requirements.filter((r) => r.allowDouble).map((r) => `${r.classroomId}|${r.subjectId}`));
    const at = new Map(entries.map((e) => [`${e.classroomId}|${e.day}|${e.periodKey}`, e]));
    for (const e of entries) {
      if (doubles.has(`${e.classroomId}|${e.subjectId}`)) continue;
      const teach = teachingPeriodsForDay(config, e.day);
      const i = teach.findIndex((p) => p.key === e.periodKey);
      const next = i >= 0 ? teach[i + 1] : undefined;
      // Only truly adjacent periods count: a break in between separates them.
      const all = periodsForDay(config, e.day);
      if (!next || all.findIndex((p) => p.key === next.key) !== all.findIndex((p) => p.key === e.periodKey) + 1) continue;
      const o = at.get(`${e.classroomId}|${e.day}|${next.key}`);
      if (o && o.subjectId === e.subjectId) push({ key: `consecutive_same_subject|${e.id}|${o.id}`, code: 'consecutive_same_subject', entryIds: [e.id, o.id], classroomId: e.classroomId, subjectId: e.subjectId, day: e.day,
        message: `${n.classroom(e.classroomId)}: ${n.subject(e.subjectId)} runs in two consecutive periods on ${WEEKDAY_NAMES[e.day]}.` });
    }
  }
  return out;
}

/** Conflicts present in `after` but not in `before` (what a single change would introduce). */
export function introducedConflicts(before: Conflict[], after: Conflict[]): Conflict[] {
  const old = new Set(before.map((c) => c.key));
  return after.filter((c) => !old.has(c.key));
}

// ---------------------------------------------------------------- Generator
export interface GenerateInput {
  config: TimetableConfigShape;
  /** Classrooms to (re)schedule. */
  classroomIds: string[];
  /** Requirements of those classrooms. */
  requirements: TRequirement[];
  teachers: TTeacher[];
  rooms: TRoom[];
  /** Entries that must stay where they are: locked lessons and every lesson of classrooms not being generated. */
  fixed: TEntry[];
  /** Restrict generation to these working days. */
  days?: number[];
  /** Teachers the admin allows the generator to use (default: all). Requirements with a fixed teacher outside this list are reported. */
  teacherIds?: string[];
  seed?: number;
  maxIterations?: number;
  timeLimitMs?: number;
  names?: Partial<Namer>;
}
export interface GeneratedEntry { classroomId: string; day: number; periodKey: string; subjectId: string; teacherId: string | null; roomId: string | null; requirementId: string }
export interface Diagnostic { code: string; message: string; suggestion: string; classroomId?: string; teacherId?: string; roomId?: string; subjectId?: string; requirementId?: string }
export interface Unplaced { requirementId: string; classroomId: string; subjectId: string; teacherId: string | null; missing: number; reasons: string[]; suggestion: string }
export interface GenerateResult {
  status: 'complete' | 'incomplete';
  entries: GeneratedEntry[];
  unplaced: Unplaced[];
  diagnostics: Diagnostic[];
  stats: { required: number; placed: number; iterations: number; softPenalty: number; ms: number };
}

/** Small seeded PRNG (mulberry32) so a generation can be reproduced exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Unit { idx: number; req: TRequirement; teacherId: string | null; roomId: string | null }

export function generateTimetable(input: GenerateInput): GenerateResult {
  const started = Date.now();
  const n: Namer = { ...idNamer, ...input.names };
  const cfg = input.config;
  const random = rng(input.seed ?? 1);
  const diagnostics: Diagnostic[] = [];
  const allowedTeachers = input.teacherIds ? new Set(input.teacherIds) : null;
  const teachers = new Map(input.teachers.map((t) => [t.id, t]));
  const rooms = new Map(input.rooms.map((r) => [r.id, r]));
  const days = (input.days?.length ? input.days.filter((d) => cfg.workingDays.includes(d)) : cfg.workingDays).slice().sort((a, b) => a - b);
  const slots = teachingSlots(cfg, days);
  const slotIndex = new Map(slots.map((s, i) => [slotKey(s.day, s.periodKey), i]));
  // Adjacent teaching periods (no break in between), for the "no back-to-back repeats" preference.
  const neighbours: number[][] = slots.map(() => []);
  for (const day of days) {
    const all = periodsForDay(cfg, day);
    for (let i = 0; i + 1 < all.length; i++) {
      const a = slotIndex.get(slotKey(day, all[i]!.key)); const b = slotIndex.get(slotKey(day, all[i + 1]!.key));
      if (a !== undefined && b !== undefined && all[i]!.kind === 'teaching' && all[i + 1]!.kind === 'teaching') { neighbours[a]!.push(b); neighbours[b]!.push(a); }
    }
  }
  const teacherLimit = (id: string) => ({ day: teachers.get(id)?.maxPerDay ?? cfg.teacherMaxPerDay, week: teachers.get(id)?.maxPerWeek ?? cfg.teacherMaxPerWeek });

  // ---- occupancy from fixed entries (immovable)
  const fixedClass = new Set<string>(); const fixedTeacher = new Set<string>(); const fixedRoom = new Set<string>();
  const fixedTeacherDay = new Map<string, number>(); const fixedTeacherWeek = new Map<string, number>(); const fixedSubjectDay = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string, d = 1) => m.set(k, (m.get(k) ?? 0) + d);
  for (const e of input.fixed) {
    fixedClass.add(`${e.classroomId}|${e.day}|${e.periodKey}`);
    if (e.teacherId) { fixedTeacher.add(`${e.teacherId}|${e.day}|${e.periodKey}`); inc(fixedTeacherDay, `${e.teacherId}|${e.day}`); inc(fixedTeacherWeek, e.teacherId); }
    if (e.roomId) fixedRoom.add(`${e.roomId}|${e.day}|${e.periodKey}`);
    inc(fixedSubjectDay, `${e.classroomId}|${e.subjectId}|${e.day}`);
  }

  // ---- resolve teachers and build lesson units
  const reqs = input.requirements.filter((r) => input.classroomIds.includes(r.classroomId) && r.periodsPerWeek > 0);
  const plannedLoad = new Map<string, number>(fixedTeacherWeek);
  const units: Unit[] = [];
  const unitsByReq = new Map<string, Unit[]>();
  const preUnplaced: Unplaced[] = [];
  // Requirements with a named teacher first, so automatic choices see the real load.
  for (const req of [...reqs].sort((a, b) => Number(Boolean(b.teacherId)) - Number(Boolean(a.teacherId)) || b.periodsPerWeek - a.periodsPerWeek)) {
    const already = input.fixed.filter((e) => e.classroomId === req.classroomId && e.subjectId === req.subjectId);
    const missing = req.periodsPerWeek - already.length;
    if (missing <= 0) continue;
    let teacherId = req.teacherId;
    if (teacherId && (!teachers.has(teacherId) || (allowedTeachers && !allowedTeachers.has(teacherId)))) {
      const why = !teachers.has(teacherId) ? 'is not an active teacher' : 'was excluded from this generation';
      diagnostics.push({ code: 'teacher_excluded', requirementId: req.id, teacherId, classroomId: req.classroomId, subjectId: req.subjectId,
        message: `${n.classroom(req.classroomId)}: ${n.subject(req.subjectId)} must be taught by ${n.teacher(teacherId)}, who ${why}.`,
        suggestion: 'Include this teacher in the generation, or change the teacher for this subject.' });
      preUnplaced.push({ requirementId: req.id, classroomId: req.classroomId, subjectId: req.subjectId, teacherId, missing, reasons: [`Teacher ${why}.`], suggestion: 'Include this teacher, or assign another teacher to the subject.' });
      continue;
    }
    if (!teacherId) {
      // Use the teacher already teaching this subject to this class (locked lessons), else the least-loaded qualified teacher.
      const existing = already.find((e) => e.teacherId)?.teacherId ?? null;
      const candidates = [...teachers.values()].filter((t) => t.subjectIds.includes(req.subjectId) && (!allowedTeachers || allowedTeachers.has(t.id)));
      const pick = existing && candidates.some((c) => c.id === existing) ? existing
        : candidates
          .map((t) => {
            const load = plannedLoad.get(t.id) ?? 0;
            // Real capacity: the weekly limit, and the periods the teacher is actually available.
            const avail = slots.filter((s) => !t.unavailable.includes(slotKey(s.day, s.periodKey))).length;
            return { t, load, free: Math.min(teacherLimit(t.id).week ?? Infinity, avail) - load };
          })
          .filter((x) => x.free >= missing)
          // Most spare capacity first; with equal capacity, the lighter current load; then a stable order.
          .sort((a, b) => b.free - a.free || a.load - b.load || a.t.id.localeCompare(b.t.id))[0]?.t.id ?? null;
      if (!pick) {
        const msg = candidates.length ? 'every qualified teacher is already at their weekly limit' : 'no teacher is set up to teach this subject';
        diagnostics.push({ code: 'no_teacher', requirementId: req.id, classroomId: req.classroomId, subjectId: req.subjectId,
          message: `${n.classroom(req.classroomId)}: no teacher for ${n.subject(req.subjectId)} — ${msg}.`,
          suggestion: candidates.length ? 'Raise a teacher\'s weekly limit or add another qualified teacher.' : 'Assign a teacher to this subject requirement, or tick the subject in a teacher\'s profile.' });
        preUnplaced.push({ requirementId: req.id, classroomId: req.classroomId, subjectId: req.subjectId, teacherId: null, missing, reasons: [msg[0]!.toUpperCase() + msg.slice(1) + '.'],
          suggestion: candidates.length ? "Raise a qualified teacher's weekly limit or add another teacher for this subject." : 'Assign a teacher to this subject.' });
        continue;
      }
      teacherId = pick;
    }
    inc(plannedLoad, teacherId, missing);
    const list: Unit[] = [];
    for (let i = 0; i < missing; i++) { const u = { idx: units.length, req, teacherId, roomId: req.roomId }; units.push(u); list.push(u); }
    unitsByReq.set(req.id, list);
  }

  // ---- feasibility pre-checks (explain WHY before searching)
  const classDemand = new Map<string, number>();
  for (const u of units) inc(classDemand, u.req.classroomId);
  for (const [cid, demand] of classDemand) {
    const free = slots.filter((s) => !fixedClass.has(`${cid}|${s.day}|${s.periodKey}`)).length;
    if (demand > free) diagnostics.push({ code: 'class_overloaded', classroomId: cid,
      message: `${n.classroom(cid)} needs ${demand} more periods but only ${free} teaching periods are free in the week.`,
      suggestion: `Reduce weekly periods by ${demand - free}, add teaching periods, or add a working day.` });
  }
  const teacherDemand = new Map<string, number>();
  for (const u of units) if (u.teacherId) inc(teacherDemand, u.teacherId);
  for (const [tid, demand] of teacherDemand) {
    const t = teachers.get(tid)!;
    const lim = teacherLimit(tid);
    const free = slots.filter((s) => !t.unavailable.includes(slotKey(s.day, s.periodKey)) && !fixedTeacher.has(`${tid}|${s.day}|${s.periodKey}`)).length;
    const weekLeft = lim.week === null ? Infinity : lim.week - (fixedTeacherWeek.get(tid) ?? 0);
    const dayCap = lim.day === null ? Infinity : days.reduce((a, d) => a + Math.max(0, lim.day! - (fixedTeacherDay.get(`${tid}|${d}`) ?? 0)), 0);
    const cap = Math.min(free, weekLeft, dayCap);
    if (demand > cap) {
      const why = cap === weekLeft ? `the weekly limit of ${lim.week}` : cap === dayCap ? `the daily limit of ${lim.day}` : `${free} available periods`;
      diagnostics.push({ code: 'teacher_overloaded', teacherId: tid,
        message: `${n.teacher(tid)} would need ${demand} more periods, more than ${why} allows (${cap}).`,
        suggestion: `Give ${demand - cap} of these periods to another teacher, raise the limit, or reduce the teacher's unavailable times.` });
    }
  }
  for (const req of reqs) {
    const units4 = unitsByReq.get(req.id); if (!units4) continue;
    const total = req.periodsPerWeek;
    if (total > req.maxPerDay * days.length) diagnostics.push({ code: 'subject_spread', requirementId: req.id, classroomId: req.classroomId, subjectId: req.subjectId,
      message: `${n.classroom(req.classroomId)}: ${n.subject(req.subjectId)} needs ${total} periods but may appear at most ${req.maxPerDay}× on each of ${days.length} days.`,
      suggestion: `Allow ${Math.ceil(total / days.length)} periods per day for this subject, or reduce its weekly periods.` });
  }
  const roomDemand = new Map<string, number>();
  for (const u of units) if (u.roomId) inc(roomDemand, u.roomId);
  for (const [rid, demand] of roomDemand) {
    const r = rooms.get(rid);
    const free = slots.filter((s) => !(r?.unavailable.includes(slotKey(s.day, s.periodKey))) && !fixedRoom.has(`${rid}|${s.day}|${s.periodKey}`)).length;
    if (demand > free) diagnostics.push({ code: 'room_overloaded', roomId: rid,
      message: `${n.room(rid)} is needed for ${demand} periods but only ${free} are free.`,
      suggestion: 'Add another room of this kind, or let some lessons use the class\'s own room.' });
  }

  // ---- static domains (slots allowed by unavailability and fixed lessons)
  const domain: number[][] = units.map((u) => {
    const t = u.teacherId ? teachers.get(u.teacherId) : undefined; const r = u.roomId ? rooms.get(u.roomId) : undefined;
    const out: number[] = [];
    slots.forEach((s, i) => {
      const k = slotKey(s.day, s.periodKey);
      if (fixedClass.has(`${u.req.classroomId}|${s.day}|${s.periodKey}`)) return;
      if (u.teacherId && (t?.unavailable.includes(k) || fixedTeacher.has(`${u.teacherId}|${s.day}|${s.periodKey}`))) return;
      if (u.roomId && (r?.unavailable.includes(k) || fixedRoom.has(`${u.roomId}|${s.day}|${s.periodKey}`))) return;
      out.push(i);
    });
    return out;
  });

  /** Subject of each fixed lesson by classroom and slot index (for the back-to-back preference). */
  const fixedSubjectAt = new Map<string, string>();
  for (const e of input.fixed) { const i = slotIndex.get(slotKey(e.day, e.periodKey)); if (i !== undefined) fixedSubjectAt.set(`${e.classroomId}|${i}`, e.subjectId); }

  // ---- search state
  const at = new Int32Array(units.length).fill(-1);
  const classAt = new Map<string, number>(); const teacherAt = new Map<string, number>(); const roomAt = new Map<string, number>();
  const teacherDay = new Map<string, number>(); const teacherWeek = new Map<string, number>(); const subjectDay = new Map<string, number>();
  const ck = (u: Unit, s: number) => `${u.req.classroomId}|${s}`;
  const tk = (u: Unit, s: number) => `${u.teacherId}|${s}`;
  const rk = (u: Unit, s: number) => `${u.roomId}|${s}`;
  const dayOf = (s: number) => slots[s]!.day;
  const tdk = (u: Unit, s: number) => `${u.teacherId}|${dayOf(s)}`;
  const sdk = (u: Unit, s: number) => `${u.req.classroomId}|${u.req.subjectId}|${dayOf(s)}`;
  const assign = (u: Unit, s: number) => {
    at[u.idx] = s; classAt.set(ck(u, s), u.idx);
    if (u.teacherId) { teacherAt.set(tk(u, s), u.idx); inc(teacherDay, tdk(u, s)); inc(teacherWeek, u.teacherId); }
    if (u.roomId) roomAt.set(rk(u, s), u.idx);
    inc(subjectDay, sdk(u, s));
  };
  const unassign = (u: Unit) => {
    const s = at[u.idx]!; if (s < 0) return;
    at[u.idx] = -1; classAt.delete(ck(u, s));
    if (u.teacherId) { teacherAt.delete(tk(u, s)); inc(teacherDay, tdk(u, s), -1); inc(teacherWeek, u.teacherId, -1); }
    if (u.roomId) roomAt.delete(rk(u, s));
    inc(subjectDay, sdk(u, s), -1);
  };

  /** Hard limits that are never "kicked": per-day subject cap and teacher day/week caps. */
  const withinLimits = (u: Unit, s: number) => {
    const sd = (subjectDay.get(sdk(u, s)) ?? 0) + (fixedSubjectDay.get(sdk(u, s)) ?? 0);
    if (sd >= u.req.maxPerDay) return false;
    if (u.teacherId) {
      const lim = teacherLimit(u.teacherId);
      if (lim.day !== null && (teacherDay.get(tdk(u, s)) ?? 0) + (fixedTeacherDay.get(tdk(u, s)) ?? 0) >= lim.day) return false;
      if (lim.week !== null && (teacherWeek.get(u.teacherId) ?? 0) + (fixedTeacherWeek.get(u.teacherId) ?? 0) >= lim.week) return false;
    }
    return true;
  };
  const conflictsOf = (u: Unit, s: number): number[] => {
    const c = new Set<number>();
    const a = classAt.get(ck(u, s)); if (a !== undefined) c.add(a);
    if (u.teacherId) { const b = teacherAt.get(tk(u, s)); if (b !== undefined) c.add(b); }
    if (u.roomId) { const r = roomAt.get(rk(u, s)); if (r !== undefined) c.add(r); }
    c.delete(u.idx);
    return [...c];
  };
  /** Allocation-free: true when nothing occupies the class / teacher / room in slot s. */
  const isFree = (u: Unit, s: number) => {
    const a = classAt.get(ck(u, s)); if (a !== undefined && a !== u.idx) return false;
    if (u.teacherId) { const b = teacherAt.get(tk(u, s)); if (b !== undefined && b !== u.idx) return false; }
    if (u.roomId) { const r = roomAt.get(rk(u, s)); if (r !== undefined && r !== u.idx) return false; }
    return true;
  };
  const soft = (u: Unit, s: number) => {
    let p = 0;
    const sameDay = (subjectDay.get(sdk(u, s)) ?? 0) + (fixedSubjectDay.get(sdk(u, s)) ?? 0);
    p += sameDay * 6; // spread a subject across the week
    if (cfg.avoidConsecutiveSameSubject && !u.req.allowDouble) {
      for (const nb of neighbours[s]!) {
        const o = classAt.get(ck(u, nb));
        const fixedSame = fixedSubjectAt.get(ck(u, nb)) === u.req.subjectId;
        if ((o !== undefined && units[o]!.req.subjectId === u.req.subjectId) || fixedSame) p += 20;
      }
    }
    if (u.teacherId) p += 1.5 * Math.max(0, (teacherDay.get(tdk(u, s)) ?? 0) + (fixedTeacherDay.get(tdk(u, s)) ?? 0) - 3); // balance a teacher's heavy days
    return p;
  };

  const maxIter = input.maxIterations ?? Math.max(4000, units.length * 80);
  const deadline = started + (input.timeLimitMs ?? 8000);
  const lastPlaced = new Int32Array(units.length).fill(-1000);
  let best: Int32Array = at.slice(); let bestPlaced = 0; let bestPenalty = Infinity;
  const unassigned = new Set(units.map((u) => u.idx));
  let iter = 0;
  const totalPenalty = () => { let p = 0; for (const u of units) if (at[u.idx]! >= 0) { const s = at[u.idx]!; unassign(u); p += soft(u, s); assign(u, s); } return p; };

  while (unassigned.size && iter < maxIter && Date.now() < deadline) {
    iter++;
    // Most constrained unassigned lesson first (fewest conflict-free slots), random tie-break.
    let pick = -1; let pickFree = Infinity; let pickTie = 0;
    for (const i of unassigned) {
      const u = units[i]!;
      let free = 0;
      for (const s of domain[i]!) if (isFree(u, s) && withinLimits(u, s)) { free++; if (free >= pickFree) break; }
      const tie = random();
      if (free < pickFree || (free === pickFree && tie < pickTie)) { pick = i; pickFree = free; pickTie = tie; }
    }
    const u = units[pick]!;
    let bestSlot = -1; let bestCost = Infinity; let bestKick: number[] = [];
    for (const s of domain[pick]!) {
      if (!withinLimits(u, s)) continue;
      const kick = conflictsOf(u, s);
      let cost = soft(u, s) + random() * 0.5;
      for (const k of kick) cost += 100 + (iter - lastPlaced[k]! < 4 ? 400 : 0); // tabu: do not undo the last moves
      if (cost < bestCost) { bestCost = cost; bestSlot = s; bestKick = kick; }
    }
    if (bestSlot < 0) {
      // Limits block every slot: free one of this teacher's / subject's lessons at random to make room.
      const sameOwner = units.filter((x) => at[x.idx]! >= 0 && ((u.teacherId && x.teacherId === u.teacherId) || (x.req.id === u.req.id)));
      if (!sameOwner.length) { unassigned.delete(pick); continue; } // genuinely impossible; reported below
      const victim = sameOwner[Math.floor(random() * sameOwner.length)]!;
      unassign(victim); unassigned.add(victim.idx);
      continue;
    }
    for (const k of bestKick) { unassign(units[k]!); unassigned.add(k); }
    assign(u, bestSlot); unassigned.delete(pick); lastPlaced[pick] = iter;
    const placed = units.length - unassigned.size;
    if (placed > bestPlaced || (placed === bestPlaced && placed === units.length)) {
      const pen = placed === units.length ? totalPenalty() : Infinity;
      if (placed > bestPlaced || pen < bestPenalty) { best = at.slice(); bestPlaced = placed; bestPenalty = pen; }
    }
  }
  // Units dropped as impossible above are still "unassigned" for reporting.
  for (const u of units) if (best[u.idx]! < 0) unassigned.add(u.idx);

  // ---- restore the best state for reporting
  for (const u of units) unassign(u);
  for (const u of units) if (best[u.idx]! >= 0) assign(u, best[u.idx]!);

  // ---- improvement: hill-climb on the soft preferences with moves and same-class swaps.
  // Every candidate keeps all hard constraints (no conflicts, limits respected).
  const placedUnits = () => units.filter((u) => at[u.idx]! >= 0);
  const costAt = (u: Unit, s: number) => { const cur = at[u.idx]!; unassign(u); const c = soft(u, s); assign(u, cur); return c; };
  const canPlace = (u: Unit, s: number) => isFree(u, s) && withinLimits(u, s);
  const improveDeadline = Date.now() + Math.min(2500, Math.max(500, (input.timeLimitMs ?? 8000) / 4));
  const unitsByClass = new Map<string, Unit[]>();
  for (const u of units) { const l = unitsByClass.get(u.req.classroomId); if (l) l.push(u); else unitsByClass.set(u.req.classroomId, [u]); }
  for (let round = 0; round < 30 && Date.now() < improveDeadline; round++) {
    let improved = false;
    const order = placedUnits().sort(() => random() - 0.5);
    for (const u of order) {
      if (Date.now() >= improveDeadline) break;
      const s0 = at[u.idx]!;
      const c0 = costAt(u, s0);
      if (c0 <= 0.0001) continue;
      // 1) move to a free slot with a lower cost
      unassign(u);
      let moved = false;
      for (const s of domain[u.idx]!) {
        if (s === s0 || !canPlace(u, s)) continue;
        if (soft(u, s) + 0.01 < c0) { assign(u, s); moved = true; break; }
      }
      if (moved) { improved = true; continue; }
      assign(u, s0);
      // 2) swap with another lesson of the same class
      for (const v of unitsByClass.get(u.req.classroomId)!) {
        if (v === u || v.req.subjectId === u.req.subjectId) continue;
        const s1 = at[v.idx]!;
        if (s1 < 0 || !domain[u.idx]!.includes(s1) || !domain[v.idx]!.includes(s0)) continue;
        const before = c0 + costAt(v, s1);
        unassign(u); unassign(v);
        let ok = false;
        if (canPlace(u, s1)) { assign(u, s1); if (canPlace(v, s0)) { assign(v, s0); ok = true; } else unassign(u); }
        if (ok) {
          const after = costAt(u, s1) + costAt(v, s0);
          if (after + 0.01 < before) { improved = true; break; }
          unassign(u); unassign(v);
        }
        assign(u, s0); assign(v, s1);
      }
    }
    if (!improved) break;
  }
  if (placedUnits().length === units.length) bestPenalty = totalPenalty();

  const entries: GeneratedEntry[] = units.filter((u) => at[u.idx]! >= 0).map((u) => {
    const s = slots[at[u.idx]!]!;
    return { classroomId: u.req.classroomId, day: s.day, periodKey: s.periodKey, subjectId: u.req.subjectId, teacherId: u.teacherId, roomId: u.roomId, requirementId: u.req.id };
  });

  // ---- explain what could not be placed
  const unplaced: Unplaced[] = [...preUnplaced];
  for (const [reqId, list] of unitsByReq) {
    const missing = list.filter((u) => at[u.idx]! < 0);
    if (!missing.length) continue;
    const u = missing[0]!;
    const counts = new Map<string, number>();
    const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    if (!domain[u.idx]!.length) add('no_slot');
    for (const s of domain[u.idx]!) {
      if (classAt.has(ck(u, s))) add('class_busy');
      else if (u.teacherId && teacherAt.has(tk(u, s))) add('teacher_busy');
      else if (u.roomId && roomAt.has(rk(u, s))) add('room_busy');
      else if (!withinLimits(u, s)) add('limit');
    }
    const reasons: string[] = [];
    if (counts.get('no_slot')) reasons.push(`There is no period where ${u.teacherId ? n.teacher(u.teacherId) : 'the teacher'}${u.roomId ? ` and ${n.room(u.roomId)}` : ''} and the class are all available.`);
    if (counts.get('class_busy')) reasons.push(`${n.classroom(u.req.classroomId)} is already full in ${counts.get('class_busy')} candidate periods.`);
    if (counts.get('teacher_busy')) reasons.push(`${n.teacher(u.teacherId!)} is teaching elsewhere in ${counts.get('teacher_busy')} candidate periods.`);
    if (counts.get('room_busy')) reasons.push(`${n.room(u.roomId!)} is booked in ${counts.get('room_busy')} candidate periods.`);
    if (counts.get('limit')) reasons.push(`Daily/weekly limits (subject per day or teacher load) block ${counts.get('limit')} candidate periods.`);
    const suggestion = counts.get('teacher_busy') ? 'Share this subject with another qualified teacher or reduce the teacher\'s other periods.'
      : counts.get('room_busy') ? 'Add another room or remove the fixed room for this subject.'
        : counts.get('class_busy') || counts.get('no_slot') ? 'Reduce weekly periods for this class or add teaching periods/working days.'
          : 'Relax the per-day limit for this subject or the teacher\'s daily limit.';
    unplaced.push({ requirementId: reqId, classroomId: u.req.classroomId, subjectId: u.req.subjectId, teacherId: u.teacherId, missing: missing.length, reasons, suggestion });
  }

  const required = units.length + preUnplaced.reduce((a, x) => a + x.missing, 0);
  return {
    status: unplaced.length === 0 ? 'complete' : 'incomplete',
    entries, unplaced, diagnostics,
    stats: { required, placed: entries.length, iterations: iter, softPenalty: Number.isFinite(bestPenalty) ? Math.round(bestPenalty) : 0, ms: Date.now() - started }
  };
}
