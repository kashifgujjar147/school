import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPeriods, generateTimetable, introducedConflicts, planForDate, slotKey, teachingSlots, validateConfig, validateTimetable,
  type GenerateInput, type TEntry, type TimetableConfigShape, type TRequirement, type TTeacher
} from './timetable.js';
import { generateSchema, timetableConfigSchema } from '../schemas/timetable.js';
import { effectivePermissions } from './permissions.js';

const periods = buildPeriods({ start: '08:00', count: 6, minutes: 40, breaks: [{ afterPeriod: 3, minutes: 20, kind: 'break', label: 'Break' }] });
const cfg = (over: Partial<TimetableConfigShape> = {}): TimetableConfigShape => ({
  workingDays: [1, 2, 3, 4, 5], dayStart: '07:30', dayEnd: '14:00', periods, dayOverrides: [], specialDays: [],
  defaultPeriodMinutes: 40, teacherMaxPerDay: null, teacherMaxPerWeek: null, avoidConsecutiveSameSubject: true, ...over
});
const T = (id: string, subjectIds: string[], over: Partial<TTeacher> = {}): TTeacher => ({ id, unavailable: [], maxPerDay: null, maxPerWeek: null, subjectIds, ...over });
const R = (id: string, classroomId: string, subjectId: string, periodsPerWeek: number, over: Partial<TRequirement> = {}): TRequirement =>
  ({ id, classroomId, subjectId, teacherId: null, roomId: null, periodsPerWeek, maxPerDay: 2, ...over });

/** Hard-constraint audit of a generated timetable. */
function assertNoHardConflicts(c: TimetableConfigShape, entries: { classroomId: string; day: number; periodKey: string; teacherId: string | null; roomId: string | null; subjectId: string }[]) {
  const asEntries: TEntry[] = entries.map((e, i) => ({ id: `e${i}`, ...e }));
  const errors = validateTimetable({ config: c, entries: asEntries, teachers: [], rooms: [], requirements: [] }).filter((x) => x.severity === 'error');
  assert.deepEqual(errors, [], errors.map((e) => e.message).join('\n'));
}

describe('bell schedule', () => {
  test('buildPeriods creates teaching periods and breaks in order', () => {
    assert.equal(periods.length, 7);
    assert.deepEqual(periods.map((p) => p.kind), ['teaching', 'teaching', 'teaching', 'break', 'teaching', 'teaching', 'teaching']);
    assert.equal(periods[3]!.start, '10:00'); assert.equal(periods[4]!.start, '10:20'); assert.equal(periods[6]!.end, '12:20');
    assert.deepEqual(validateConfig(cfg()), []);
  });
  test('validateConfig rejects overlaps, out-of-hours periods and missing teaching periods', () => {
    const bad = cfg({ periods: [{ key: 'p1', label: 'P1', start: '08:00', end: '08:40', kind: 'teaching' }, { key: 'p2', label: 'P2', start: '08:30', end: '09:10', kind: 'teaching' }] });
    assert.ok(validateConfig(bad).some((e) => e.includes('overlaps')));
    assert.ok(validateConfig(cfg({ dayEnd: '09:00' })).some((e) => e.includes('outside school hours')));
    assert.ok(validateConfig(cfg({ dayOverrides: [{ day: 5, periods: [{ key: 'b1', label: 'Prayer', start: '08:00', end: '09:00', kind: 'break' }] }] })).some((e) => e.includes('no teaching period')));
    assert.ok(validateConfig(cfg({ dayOverrides: [{ day: 0, periods }] })).some((e) => e.includes('not a working day')));
  });
  test('per-weekday schedules, special days and holidays', () => {
    const friday = buildPeriods({ start: '08:00', count: 4, minutes: 35, breaks: [] });
    const c = cfg({ dayOverrides: [{ day: 5, periods: friday }], specialDays: [{ date: '2026-11-18', label: 'Sports day', closed: true }, { date: '2026-11-19', label: 'Short day', closed: false, periods: friday.slice(0, 2) }] });
    assert.equal(teachingSlots(c).length, 4 * 6 + 4);
    assert.equal(planForDate(c, '2026-11-16').periods.length, 7); // Monday
    assert.equal(planForDate(c, '2026-11-20').periods.length, 4); // Friday override
    assert.equal(planForDate(c, '2026-11-15').closed, true); // Sunday
    assert.equal(planForDate(c, '2026-11-18').closed, true);
    assert.equal(planForDate(c, '2026-11-19').periods.length, 2);
    assert.equal(planForDate(c, '2026-11-17', [{ date: '2026-11-17', name: 'Holiday' }]).label, 'Holiday');
  });
  test('API schemas: config and generate requests are validated', () => {
    assert.equal(timetableConfigSchema.safeParse({ sessionId: crypto.randomUUID(), workingDays: [1, 9], dayStart: '08:00', dayEnd: '14:00', periods }).success, false);
    assert.equal(timetableConfigSchema.safeParse({ sessionId: crypto.randomUUID(), workingDays: [1], dayStart: '08:00', dayEnd: '14:00', periods: [{ ...periods[0]!, start: '8:00' }] }).success, false);
    assert.equal(generateSchema.safeParse({ sessionId: crypto.randomUUID(), classroomIds: [], version: 1 }).success, false);
  });
});

describe('validateTimetable', () => {
  const base = { teacherId: 't1', roomId: null, subjectId: 'math' };
  test('detects class, teacher and room double-booking', () => {
    const entries: TEntry[] = [
      { id: 'a', classroomId: 'c1', day: 1, periodKey: 'p1', ...base },
      { id: 'b', classroomId: 'c1', day: 1, periodKey: 'p1', ...base, teacherId: 't2' },
      { id: 'c', classroomId: 'c2', day: 1, periodKey: 'p2', ...base, roomId: 'lab' },
      { id: 'd', classroomId: 'c3', day: 1, periodKey: 'p2', ...base, teacherId: 't3', roomId: 'lab' },
      { id: 'e', classroomId: 'c4', day: 1, periodKey: 'p1', ...base }
    ];
    const codes = validateTimetable({ config: cfg(), entries, teachers: [], rooms: [], requirements: [] }).map((c) => c.code).sort();
    assert.deepEqual(codes, ['class_clash', 'room_clash', 'teacher_clash']);
  });
  test('breaks, unknown periods and non-working days are hard errors', () => {
    const entries: TEntry[] = [
      { id: 'a', classroomId: 'c1', day: 1, periodKey: 'b1', ...base },
      { id: 'b', classroomId: 'c1', day: 0, periodKey: 'p1', ...base },
      { id: 'c', classroomId: 'c1', day: 2, periodKey: 'p99', ...base }
    ];
    const res = validateTimetable({ config: cfg(), entries, teachers: [], rooms: [], requirements: [] });
    assert.deepEqual(res.map((c) => [c.code, c.severity]), [['not_teaching_period', 'error'], ['not_working_day', 'error'], ['not_teaching_period', 'error']]);
  });
  test('availability, load limits, qualifications and weekly requirements are warnings', () => {
    const entries: TEntry[] = [1, 2, 3].map((d) => ({ id: `x${d}`, classroomId: 'c1', day: 1, periodKey: `p${d}`, teacherId: 't1', roomId: null, subjectId: 'math' }));
    const res = validateTimetable({
      config: cfg(), entries,
      teachers: [T('t1', ['english'], { unavailable: [slotKey(1, 'p1')], maxPerDay: 2 })], rooms: [],
      requirements: [R('r1', 'c1', 'math', 5, { maxPerDay: 1 }), R('r2', 'c1', 'urdu', 2)]
    });
    const codes = new Set(res.map((c) => c.code));
    for (const c of ['teacher_unavailable', 'teacher_not_qualified', 'teacher_day_limit', 'subject_day_limit', 'requirement_short', 'consecutive_same_subject']) assert.ok(codes.has(c as never), c);
    assert.ok(res.every((c) => c.severity === 'warning'));
  });
  test('introducedConflicts only reports what a change adds', () => {
    const e1: TEntry = { id: 'a', classroomId: 'c1', day: 1, periodKey: 'p1', ...base };
    const before = validateTimetable({ config: cfg(), entries: [e1], teachers: [], rooms: [], requirements: [] });
    const after = validateTimetable({ config: cfg(), entries: [e1, { ...e1, id: 'b', classroomId: 'c2' }], teachers: [], rooms: [], requirements: [] });
    assert.deepEqual(introducedConflicts(before, after).map((c) => c.code), ['teacher_clash']);
  });
});

describe('generateTimetable', () => {
  const twoClasses = (): GenerateInput => ({
    config: cfg(), classroomIds: ['c1', 'c2'], fixed: [], rooms: [{ id: 'lab', unavailable: [] }],
    teachers: [T('tMath', ['math']), T('tEng', ['eng']), T('tSci', ['sci']), T('tUrdu', ['urdu']), T('tIsl', ['isl'])],
    requirements: [
      ...['c1', 'c2'].flatMap((c) => [
        R(`${c}-math`, c, 'math', 8), R(`${c}-eng`, c, 'eng', 6), R(`${c}-sci`, c, 'sci', 6, { roomId: 'lab' }),
        R(`${c}-urdu`, c, 'urdu', 6), R(`${c}-isl`, c, 'isl', 4)
      ])
    ],
    seed: 7
  });

  test('meets every weekly requirement without any double-booking, break use or overload', () => {
    const input = twoClasses();
    const r = generateTimetable(input);
    assert.equal(r.status, 'complete', JSON.stringify(r.unplaced));
    assert.equal(r.entries.length, 60);
    assertNoHardConflicts(input.config, r.entries);
    for (const req of input.requirements) {
      const mine = r.entries.filter((e) => e.classroomId === req.classroomId && e.subjectId === req.subjectId);
      assert.equal(mine.length, req.periodsPerWeek, req.id);
      for (const d of [1, 2, 3, 4, 5]) assert.ok(mine.filter((e) => e.day === d).length <= req.maxPerDay, `${req.id} day ${d}`);
    }
    assert.ok(r.entries.every((e) => e.periodKey !== 'b1'));
    // The shared science teacher and the single lab are never in two places at once.
    const sci = r.entries.filter((e) => e.subjectId === 'sci').map((e) => slotKey(e.day, e.periodKey));
    assert.equal(new Set(sci).size, sci.length);
  });

  test('is deterministic for a seed', () => {
    const a = generateTimetable(twoClasses()); const b = generateTimetable(twoClasses());
    assert.deepEqual(a.entries, b.entries);
  });

  test('respects teacher unavailability and daily / weekly limits', () => {
    const input = twoClasses();
    const blocked = [slotKey(1, 'p1'), slotKey(1, 'p2'), slotKey(2, 'p1'), slotKey(3, 'p6')];
    input.teachers = input.teachers.map((t) => (t.id === 'tMath' ? { ...t, unavailable: blocked, maxPerDay: 4, maxPerWeek: 16 } : t));
    const r = generateTimetable(input);
    assert.equal(r.status, 'complete', JSON.stringify(r.unplaced));
    const math = r.entries.filter((e) => e.teacherId === 'tMath');
    assert.ok(math.every((e) => !blocked.includes(slotKey(e.day, e.periodKey))));
    for (const d of [1, 2, 3, 4, 5]) assert.ok(math.filter((e) => e.day === d).length <= 4);
  });

  test('keeps fixed lessons and never double-books against them', () => {
    const input = twoClasses();
    // Another class (not regenerated) already uses the maths teacher and the lab on Monday p1-p3.
    input.fixed = [
      { id: 'f1', classroomId: 'other', day: 1, periodKey: 'p1', subjectId: 'math', teacherId: 'tMath', roomId: null },
      { id: 'f2', classroomId: 'other', day: 1, periodKey: 'p2', subjectId: 'sci', teacherId: 'tSci', roomId: 'lab' },
      { id: 'f3', classroomId: 'c1', day: 1, periodKey: 'p3', subjectId: 'math', teacherId: 'tMath', roomId: null, locked: true }
    ];
    const r = generateTimetable(input);
    assert.equal(r.status, 'complete', JSON.stringify(r.unplaced));
    assertNoHardConflicts(input.config, [...input.fixed, ...r.entries]);
    // The locked maths lesson counts towards c1's 8 maths periods.
    assert.equal(r.entries.filter((e) => e.classroomId === 'c1' && e.subjectId === 'math').length, 7);
  });

  test('picks a qualified teacher automatically and spreads subjects without back-to-back repeats', () => {
    const input = twoClasses();
    input.teachers.push(T('tMath2', ['math']));
    const r = generateTimetable(input);
    const c1 = r.entries.filter((e) => e.classroomId === 'c1' && e.subjectId === 'math');
    assert.equal(new Set(c1.map((e) => e.teacherId)).size, 1, 'one teacher per subject per class');
    const warnings = validateTimetable({ config: input.config, entries: r.entries.map((e, i) => ({ id: `${i}`, ...e })), teachers: input.teachers, rooms: input.rooms, requirements: input.requirements });
    assert.equal(warnings.filter((w) => w.code === 'consecutive_same_subject').length, 0);
  });

  test('reports impossible requirements with reasons and suggestions instead of claiming success', () => {
    const input = twoClasses();
    input.requirements.push(R('c1-art', 'c1', 'art', 4)); // 34 periods > 30 slots, and nobody teaches art
    input.requirements = input.requirements.map((x) => (x.id === 'c1-math' ? { ...x, periodsPerWeek: 12, maxPerDay: 2 } : x));
    const r = generateTimetable(input);
    assert.equal(r.status, 'incomplete');
    assert.ok(r.diagnostics.some((d) => d.code === 'no_teacher' && d.suggestion.length > 0));
    assert.ok(r.diagnostics.some((d) => d.code === 'subject_spread'));
    assert.ok(r.unplaced.length > 0 && r.unplaced.every((u) => u.reasons.length > 0 && u.suggestion.length > 0));
    assert.equal(r.stats.placed, r.entries.length);
    assert.ok(r.stats.placed < r.stats.required);
    assertNoHardConflicts(input.config, r.entries);
  });

  test('detects an overloaded teacher before searching', () => {
    const input = twoClasses();
    input.teachers = input.teachers.map((t) => (t.id === 'tMath' ? { ...t, maxPerWeek: 10 } : t));
    input.requirements = input.requirements.map((x) => (x.subjectId === 'math' ? { ...x, teacherId: 'tMath' } : x));
    const r = generateTimetable(input);
    assert.equal(r.status, 'incomplete');
    assert.ok(r.diagnostics.some((d) => d.code === 'teacher_overloaded' && d.teacherId === 'tMath'));
    assert.ok(r.entries.filter((e) => e.teacherId === 'tMath').length <= 10);
  });

  test('handles a realistic school (18 classes, 35 periods each) quickly and completely', () => {
    const c = cfg({ workingDays: [1, 2, 3, 4, 5, 6], periods: buildPeriods({ start: '08:00', count: 6, minutes: 40, breaks: [{ afterPeriod: 4, minutes: 25, kind: 'lunch', label: 'Lunch' }] }), dayOverrides: [{ day: 6, periods: buildPeriods({ start: '08:00', count: 5, minutes: 40, breaks: [] }) }] });
    const classes = Array.from({ length: 18 }, (_, i) => `c${i}`);
    // 34 periods per class in 35 slots; staffing and the single computer lab have real but feasible headroom.
    const subjects: [string, number][] = [['math', 7], ['eng', 6], ['urdu', 6], ['sci', 6], ['isl', 4], ['sst', 4], ['comp', 1]];
    const staff: Record<string, number> = { math: 5, eng: 4, urdu: 4, sci: 4, isl: 3, sst: 3, comp: 1 };
    const teachers: TTeacher[] = [];
    for (const [s] of subjects) for (let k = 0; k < staff[s]!; k++) teachers.push(T(`${s}-${k}`, [s], { maxPerWeek: 30, maxPerDay: 6 }));
    const requirements = classes.flatMap((cl) => subjects.map(([s, n]) => R(`${cl}-${s}`, cl, s, n, { roomId: s === 'comp' ? 'complab' : null })));
    const t0 = Date.now();
    const r = generateTimetable({ config: c, classroomIds: classes, requirements, teachers, rooms: [{ id: 'complab', unavailable: [] }], fixed: [], seed: 3 });
    assert.equal(r.status, 'complete', JSON.stringify(r.unplaced.slice(0, 3)));
    assert.equal(r.entries.length, 18 * 34);
    assertNoHardConflicts(c, r.entries);
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
  });
});

describe('roles', () => {
  test('student and parent accounts never receive staff permissions', () => {
    assert.deepEqual(effectivePermissions('student', 'starter', ['students.view' as never]), ['student.portal']);
    assert.ok(!effectivePermissions('principal', 'standard').includes('student.portal'));
    assert.ok(effectivePermissions('principal', 'standard').includes('timetable.manage'));
    assert.ok(!effectivePermissions('teacher', 'standard').includes('timetable.manage'));
  });
});
