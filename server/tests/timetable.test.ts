import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildPeriods } from '@sms/shared';
import { buildWorld, login, makeParent, resetDb, startDb, stopDb, uuid, type World } from './helpers.js';
import {
  AcademicSession, Classroom, NotificationJob, SchoolSettings, Student, Substitution, TimetableEntry, TimetableNotice, User
} from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';
import { processSmsQueue } from '../src/services/notifications.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

type Agent = Awaited<ReturnType<typeof login>>;

/** Mon–Fri, 4 teaching periods with a break after period 2. */
const PERIODS = buildPeriods({ start: '08:00', count: 4, minutes: 40, breaks: [{ afterPeriod: 2, minutes: 20, kind: 'break', label: 'Break' }] });
const DAYS = [1, 2, 3, 4, 5];
// 2026-11-16 is a Monday.
const MONDAY = '2026-11-16';

interface Setup { p: Agent; math: string; eng: string; sci: string; lab: string }

async function setup(): Promise<Setup> {
  const p = await login(w.app, 'principal');
  const cfg = await p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS, teacherMaxPerDay: 6 });
  expect(cfg.status).toBe(200);
  const mk = async (name: string) => { const r = await p.post('/api/timetable/subjects', { name }); expect(r.status).toBe(201); return r.body.data._id as string; };
  const [math, eng, sci] = [await mk('Mathematics'), await mk('English'), await mk('Science')];
  const lab = (await p.post('/api/timetable/rooms', { name: 'Science Lab', kind: 'lab' })).body.data._id as string;
  // teacher1 teaches maths + English, teacher2 science + English.
  expect((await p.put(`/api/timetable/teachers/${w.teacher}/profile`, { sessionId: w.sessionId, subjectIds: [math, eng] })).status).toBe(200);
  expect((await p.put(`/api/timetable/teachers/${w.otherTeacher}/profile`, { sessionId: w.sessionId, subjectIds: [sci, eng] })).status).toBe(200);
  for (const cid of [w.classroomId, w.otherClassroomId]) {
    const r = await p.put(`/api/timetable/requirements/${cid}`, { sessionId: w.sessionId, items: [
      { subjectId: math, periodsPerWeek: 5, maxPerDay: 1 },
      { subjectId: eng, periodsPerWeek: 4, maxPerDay: 1 },
      { subjectId: sci, periodsPerWeek: 3, maxPerDay: 1, roomId: lab }
    ] });
    expect(r.status).toBe(200);
  }
  return { p, math, eng, sci, lab };
}
const board = async (a: Agent, state = 'draft') => { const r = await a.get(`/api/timetable/board?sessionId=${w.sessionId}&state=${state}`); expect(r.status).toBe(200); return r.body.data; };
async function generate(s: Setup, extra: Record<string, unknown> = {}) {
  const b = await board(s.p);
  return s.p.post('/api/timetable/generate', { sessionId: w.sessionId, classroomIds: [w.classroomId, w.otherClassroomId], version: b.meta.version, seed: 11, ...extra });
}
async function publish(s: Setup) {
  const b = await board(s.p);
  const r = await s.p.post('/api/timetable/publish', { sessionId: w.sessionId, version: b.meta.version, confirmWarnings: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
/** A free (class-wise) teaching slot for a classroom in the draft. */
function freeSlot(b: { entries: { classroomId: string; day: number; periodKey: string }[] }, classroomId: string) {
  for (const d of DAYS) for (const p of ['p1', 'p2', 'p3', 'p4']) if (!b.entries.some((e) => e.classroomId === classroomId && e.day === d && e.periodKey === p)) return { day: d, periodKey: p };
  return null;
}

describe('school timing configuration', () => {
  it('validates periods server-side and protects concurrent edits with versions', async () => {
    const p = await login(w.app, 'principal');
    const overlap = [{ key: 'p1', label: 'P1', start: '08:00', end: '08:45', kind: 'teaching' }, { key: 'p2', label: 'P2', start: '08:30', end: '09:10', kind: 'teaching' }];
    const bad = await p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: overlap });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/overlaps/);
    const first = await p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS,
      dayOverrides: [{ day: 5, periods: buildPeriods({ start: '08:00', count: 3, minutes: 35, breaks: [] }) }], specialDays: [{ date: '2026-11-18', label: 'Sports day', closed: true }] });
    expect(first.status).toBe(200);
    const v = first.body.data.config.version;
    expect((await p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS, version: v })).status).toBe(200);
    // Saving again from the stale version is refused instead of overwriting the other change.
    expect((await p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS, version: v })).status).toBe(409);
    // A session that does not exist in this school is refused.
    expect((await p.put('/api/timetable/config', { sessionId: uuid(), workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS })).status).toBe(404);
  });

  it('subjects and rooms cannot be duplicated', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.post('/api/timetable/subjects', { name: 'Urdu' })).status).toBe(201);
    expect((await p.post('/api/timetable/subjects', { name: 'urdu' })).status).toBe(409);
    expect((await p.post('/api/timetable/rooms', { name: 'Lab 1' })).status).toBe(201);
    expect((await p.post('/api/timetable/rooms', { name: 'LAB 1' })).status).toBe(409);
  });
});

describe('automatic generation', () => {
  it('generates a complete draft that meets weekly requirements without any double-booking', async () => {
    const s = await setup();
    const r = await generate(s);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('complete');
    expect(r.body.data.written).toBe(true);
    const b = await board(s.p);
    expect(b.entries).toHaveLength(24);
    expect(b.conflicts.filter((c: { severity: string }) => c.severity === 'error')).toEqual([]);
    for (const cid of [w.classroomId, w.otherClassroomId]) {
      expect(b.entries.filter((e: { classroomId: string; subjectId: string }) => e.classroomId === cid && e.subjectId === s.math)).toHaveLength(5);
      expect(b.entries.filter((e: { classroomId: string; subjectId: string }) => e.classroomId === cid && e.subjectId === s.sci)).toHaveLength(3);
    }
    const slots = (f: (e: { teacherId: string; roomId: string | null }) => boolean) => b.entries.filter(f).map((e: { day: number; periodKey: string }) => `${e.day}:${e.periodKey}`);
    for (const t of [w.teacher, w.otherTeacher]) { const x = slots((e) => e.teacherId === t); expect(new Set(x).size).toBe(x.length); }
    const labSlots = slots((e) => e.roomId === s.lab); expect(new Set(labSlots).size).toBe(6);
    // Breaks are never used.
    expect(b.entries.some((e: { periodKey: string }) => e.periodKey === 'b1')).toBe(false);
    // Nothing is published yet: the published view is still empty.
    expect((await board(s.p, 'published')).entries).toHaveLength(0);
  });

  it('respects teacher availability', async () => {
    const s = await setup();
    const blocked = ['1:p1', '1:p2', '2:p1', '3:p3', '4:p4'];
    await s.p.put(`/api/timetable/teachers/${w.teacher}/profile`, { sessionId: w.sessionId, subjectIds: [s.math, s.eng], unavailable: blocked });
    const r = await generate(s);
    expect(r.body.data.status).toBe('complete');
    const b = await board(s.p);
    expect(b.entries.filter((e: { teacherId: string; day: number; periodKey: string }) => e.teacherId === w.teacher && blocked.includes(`${e.day}:${e.periodKey}`))).toEqual([]);
  });

  it('reports unsatisfiable requirements with reasons and does not write unless asked', async () => {
    const s = await setup();
    // 5-A now needs 5+4+3+12 = 24 periods but the week has only 20; and nobody teaches the new subject.
    const art = (await s.p.post('/api/timetable/subjects', { name: 'Art' })).body.data._id;
    await s.p.put(`/api/timetable/requirements/${w.classroomId}`, { sessionId: w.sessionId, items: [
      { subjectId: s.math, periodsPerWeek: 5, maxPerDay: 1 }, { subjectId: s.eng, periodsPerWeek: 4, maxPerDay: 1 },
      { subjectId: s.sci, periodsPerWeek: 3, maxPerDay: 1, roomId: s.lab }, { subjectId: art, periodsPerWeek: 12, maxPerDay: 3 }
    ] });
    const r = await generate(s);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('incomplete');
    expect(r.body.data.written).toBe(false);
    expect(r.body.data.diagnostics.map((d: { code: string }) => d.code)).toEqual(expect.arrayContaining(['no_teacher']));
    expect(r.body.data.unplaced.length).toBeGreaterThan(0);
    expect(r.body.data.unplaced.every((u: { reasons: string[]; suggestion: string }) => u.reasons.length && u.suggestion)).toBe(true);
    expect((await board(s.p)).entries).toHaveLength(0);
    // Saving the partial result is an explicit choice, and the report still says incomplete.
    const partial = await generate(s, { acceptPartial: true });
    expect(partial.body.data.written).toBe(true);
    expect(partial.body.data.status).toBe('incomplete');
    expect((await board(s.p)).meta.lastGeneration.status).toBe('incomplete');
  });

  it('keeps locked lessons and lessons of other classes when regenerating one class', async () => {
    const s = await setup();
    await generate(s);
    let b = await board(s.p);
    const other = b.entries.filter((e: { classroomId: string }) => e.classroomId === w.otherClassroomId).map((e: { _id: string }) => e._id).sort();
    const lockMe = b.entries.find((e: { classroomId: string }) => e.classroomId === w.classroomId);
    expect((await s.p.patch(`/api/timetable/entries/${lockMe._id}`, { locked: true, version: b.meta.version })).status).toBe(200);
    b = await board(s.p);
    const r = await s.p.post('/api/timetable/generate', { sessionId: w.sessionId, classroomIds: [w.classroomId], version: b.meta.version, seed: 99 });
    expect(r.body.data.status).toBe('complete');
    b = await board(s.p);
    expect(b.entries.filter((e: { classroomId: string }) => e.classroomId === w.otherClassroomId).map((e: { _id: string }) => e._id).sort()).toEqual(other);
    expect(b.entries.some((e: { _id: string }) => e._id === lockMe._id)).toBe(true);
    expect(b.conflicts.filter((c: { severity: string }) => c.severity === 'error')).toEqual([]);
  });
});

describe('conflict prevention on manual edits', () => {
  it('refuses teacher, room and class double-booking, breaks and non-working days', async () => {
    const s = await setup();
    await generate(s);
    const b = await board(s.p);
    const v = b.meta.version;
    const t1 = b.entries.find((e: { teacherId: string; classroomId: string }) => e.teacherId === w.teacher && e.classroomId === w.classroomId);
    // Teacher double-booking: put teacher1 into 5-B in a period where they already teach 5-A.
    const occupied5B = b.entries.find((e: { classroomId: string; day: number; periodKey: string }) => e.classroomId === w.otherClassroomId && e.day === t1.day && e.periodKey === t1.periodKey);
    if (occupied5B) {
      const r = await s.p.patch(`/api/timetable/entries/${occupied5B._id}`, { teacherId: w.teacher, version: v });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('TIMETABLE_CONFLICT');
      expect(r.body.error.details.conflicts[0].code).toBe('teacher_clash');
    }
    // Room double-booking: the lab is used by 5-A; move a 5-B lesson into the lab in that period.
    const labLesson = b.entries.find((e: { roomId: string | null; classroomId: string }) => e.roomId === s.lab && e.classroomId === w.classroomId);
    const other = b.entries.find((e: { classroomId: string; day: number; periodKey: string }) => e.classroomId === w.otherClassroomId && e.day === labLesson.day && e.periodKey === labLesson.periodKey);
    // Either put an existing 5-B lesson into the lab, or add a new 5-B lesson there (5-B is free in that period).
    const roomClash = other
      ? await s.p.patch(`/api/timetable/entries/${other._id}`, { roomId: s.lab, version: v })
      : await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.otherClassroomId, day: labLesson.day, periodKey: labLesson.periodKey, subjectId: s.eng, teacherId: null, roomId: s.lab, version: v });
    expect(roomClash.status).toBe(409);
    expect(roomClash.body.error.details.conflicts.map((c: { code: string }) => c.code)).toContain('room_clash');
    // Class conflict: a second lesson for 5-A in an occupied period.
    const a5 = b.entries.find((e: { classroomId: string }) => e.classroomId === w.classroomId);
    const clash = await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: a5.day, periodKey: a5.periodKey, subjectId: s.eng, teacherId: null, version: v });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.conflicts.map((c: { code: string }) => c.code)).toContain('class_clash');
    // Break period and non-working day.
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 1, periodKey: 'b1', subjectId: s.eng, teacherId: null, version: v })).body.error.details.conflicts[0].code).toBe('not_teaching_period');
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 0, periodKey: 'p1', subjectId: s.eng, teacherId: null, version: v })).body.error.details.conflicts[0].code).toBe('not_working_day');
    // Nothing changed.
    expect((await board(s.p)).entries).toHaveLength(24);
    // Even if validation were bypassed, the database refuses a double-booked teacher.
    const e = b.entries.find((x: { teacherId: string }) => x.teacherId === w.teacher);
    await expect(TimetableEntry.create({ sessionId: w.sessionId, state: 'draft', classroomId: uuid(), day: e.day, periodKey: e.periodKey, subjectId: s.math, teacherId: w.teacher })).rejects.toThrow(/duplicate key/);
  });

  it('warns before saving a soft problem (teacher unavailable) and saves only after confirmation', async () => {
    const s = await setup();
    await s.p.put(`/api/timetable/teachers/${w.teacher}/profile`, { sessionId: w.sessionId, subjectIds: [s.math, s.eng], unavailable: ['5:p4'] });
    const v = (await board(s.p)).meta.version;
    const body = { sessionId: w.sessionId, classroomId: w.classroomId, day: 5, periodKey: 'p4', subjectId: s.math, teacherId: w.teacher, version: v };
    const warn = await s.p.post('/api/timetable/entries', body);
    expect(warn.status).toBe(422);
    expect(warn.body.error.code).toBe('TIMETABLE_WARNINGS');
    expect(warn.body.error.details.conflicts.map((c: { code: string }) => c.code)).toContain('teacher_unavailable');
    const okRes = await s.p.post('/api/timetable/entries', { ...body, confirmWarnings: true });
    expect(okRes.status).toBe(201);
  });

  it('moves, swaps and removes lessons; stale versions are rejected', async () => {
    const s = await setup();
    await generate(s);
    let b = await board(s.p);
    const mine = b.entries.filter((e: { classroomId: string }) => e.classroomId === w.classroomId);
    // Free a slot then move a lesson into it.
    const victim = mine[0];
    const del = await s.p.del(`/api/timetable/entries/${victim._id}?version=${b.meta.version}`);
    expect(del.status).toBe(422); // removing breaks a weekly requirement: needs confirmation
    expect((await s.p.del(`/api/timetable/entries/${victim._id}?version=${b.meta.version}&confirmWarnings=true`)).status).toBe(200);
    b = await board(s.p);
    const stale = b.meta.version - 1;
    type E = { _id: string; classroomId: string; teacherId: string | null; roomId: string | null; day: number; periodKey: string };
    const busyAt = (e: E) => b.entries.some((o: E) => o._id !== e._id && o.day === victim.day && o.periodKey === victim.periodKey && ((e.teacherId && o.teacherId === e.teacherId) || (e.roomId && o.roomId === e.roomId)));
    const fiveA: E[] = b.entries.filter((e: E) => e.classroomId === w.classroomId);
    // A lesson whose teacher is busy in the target period: refused, and only conflicts involving THAT lesson are reported.
    const blocked = fiveA.find((e) => busyAt(e));
    if (blocked) {
      const r = await s.p.patch(`/api/timetable/entries/${blocked._id}`, { day: victim.day, periodKey: victim.periodKey, version: b.meta.version, confirmWarnings: true });
      expect(r.status).toBe(409);
      expect(r.body.error.details.conflicts.every((c: { entryIds: string[] }) => c.entryIds.includes(blocked._id))).toBe(true);
    }
    const mover = fiveA.find((e) => !busyAt(e))!;
    expect(mover).toBeTruthy();
    expect((await s.p.patch(`/api/timetable/entries/${mover._id}`, { day: victim.day, periodKey: victim.periodKey, version: stale })).status).toBe(409);
    const moved = await s.p.patch(`/api/timetable/entries/${mover._id}`, { day: victim.day, periodKey: victim.periodKey, version: b.meta.version, confirmWarnings: true });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    b = await board(s.p);
    const x = b.entries.find((e: { _id: string }) => e._id === mover._id);
    expect([x.day, x.periodKey]).toEqual([victim.day, victim.periodKey]);
    // Swap two lessons of the same class with different subjects.
    const [a1, a2] = [b.entries.find((e: { classroomId: string; subjectId: string }) => e.classroomId === w.classroomId && e.subjectId === s.eng), b.entries.find((e: { classroomId: string; subjectId: string }) => e.classroomId === w.classroomId && e.subjectId === s.sci)];
    const sw = await s.p.post('/api/timetable/entries/swap', { sessionId: w.sessionId, a: a1._id, b: a2._id, version: b.meta.version, confirmWarnings: true });
    expect(sw.status, JSON.stringify(sw.body)).toBe(200);
    b = await board(s.p);
    expect(b.entries.find((e: { _id: string }) => e._id === a1._id).subjectId).toBe(s.sci);
    expect(b.entries.find((e: { _id: string }) => e._id === a2._id).subjectId).toBe(s.eng);
    // Swapping lessons of different classes is refused.
    const o = b.entries.find((e: { classroomId: string }) => e.classroomId === w.otherClassroomId);
    expect((await s.p.post('/api/timetable/entries/swap', { sessionId: w.sessionId, a: a1._id, b: o._id, version: b.meta.version })).status).toBe(400);
  });

  it('adds multi-period lessons only across consecutive teaching periods', async () => {
    const s = await setup();
    const v = (await board(s.p)).meta.version;
    // p1 + p2 are back to back; p2 + p3 are separated by the break.
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 2, periodKey: 'p1', span: 2, subjectId: s.sci, teacherId: w.otherTeacher, roomId: s.lab, version: v, confirmWarnings: true })).status).toBe(201);
    const v2 = (await board(s.p)).meta.version;
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 3, periodKey: 'p2', span: 2, subjectId: s.sci, teacherId: w.otherTeacher, version: v2, confirmWarnings: true })).status).toBe(400);
  });
});

describe('draft and published states', () => {
  it('publishing makes the draft visible; later draft edits stay private until published again', async () => {
    const s = await setup();
    await generate(s);
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/timetable/my')).body.data.lessons).toHaveLength(0);
    // Warnings must be confirmed before publishing.
    const b0 = await board(s.p);
    await s.p.del(`/api/timetable/entries/${b0.entries[0]._id}?version=${b0.meta.version}&confirmWarnings=true`);
    const b1 = await board(s.p);
    const needConfirm = await s.p.post('/api/timetable/publish', { sessionId: w.sessionId, version: b1.meta.version });
    expect(needConfirm.status).toBe(422);
    const pub = await publish(s);
    expect(pub.lessons).toBe(23);
    const mine = (await t.get('/api/timetable/my')).body.data;
    expect(mine.published).toBe(true);
    expect(mine.lessons.length).toBeGreaterThan(0);
    expect(mine.lessons.every((l: { classroom: string }) => ['5-A', '5-B'].includes(l.classroom))).toBe(true);
    const published = (await board(s.p, 'published')).entries;
    expect(mine.lessons).toHaveLength(published.filter((e: { teacherId: string }) => e.teacherId === w.teacher).length);
    // Edit the draft: the published timetable does not change.
    const b2 = await board(s.p);
    const ent = b2.entries.find((e: { teacherId: string }) => e.teacherId === w.teacher);
    expect((await s.p.del(`/api/timetable/entries/${ent._id}?version=${b2.meta.version}&confirmWarnings=true`)).status).toBe(200);
    expect((await board(s.p, 'published')).entries).toHaveLength(23);
    expect((await board(s.p)).meta.draftDirty).toBe(true);
    // Publish again: only the change is applied, and the affected teacher gets a "changed" notice.
    const again = await publish(s);
    expect(again.changedPeriods).toBe(1);
    expect((await board(s.p, 'published')).entries).toHaveLength(22);
    const notices = (await t.get('/api/timetable/my')).body.data.notices;
    expect(notices.map((n: { kind: string }) => n.kind)).toEqual(expect.arrayContaining(['changed', 'published']));
    // Reset the draft back to what is published.
    const b3 = await board(s.p);
    await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: ent.day, periodKey: ent.periodKey, subjectId: ent.subjectId, teacherId: ent.teacherId, version: b3.meta.version, confirmWarnings: true });
    const b4 = await board(s.p);
    expect(b4.entries).toHaveLength(23);
    expect((await s.p.post('/api/timetable/draft/reset', { sessionId: w.sessionId, version: b4.meta.version })).status).toBe(200);
    expect((await board(s.p)).entries).toHaveLength(22);
  });

  it('refuses to publish a draft with hard conflicts (e.g. a lesson left on a period that became a break)', async () => {
    const s = await setup();
    await generate(s);
    const v = (await board(s.p)).meta.version;
    // Turn period p4 into a lunch break: lessons there become hard conflicts.
    const changed = PERIODS.map((p) => (p.key === 'p4' ? { ...p, kind: 'lunch' as const, label: 'Lunch' } : p));
    const cfg = await s.p.get(`/api/timetable/config?sessionId=${w.sessionId}`);
    const saved = await s.p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: changed, version: cfg.body.data.version });
    expect(saved.status).toBe(200);
    expect(saved.body.data.affectedLessons).toBeGreaterThan(0);
    const r = await s.p.post('/api/timetable/publish', { sessionId: w.sessionId, version: v, confirmWarnings: true });
    expect(r.status).toBe(409);
    expect(r.body.error.details.conflicts[0].code).toBe('not_teaching_period');
  });
});

describe('substitute teachers', () => {
  it('suggests only free teachers, records the cover, prevents double-booking and never edits the timetable', async () => {
    const s = await setup();
    await generate(s);
    await publish(s);
    const publishedBefore = (await board(s.p, 'published')).entries.map((e: { _id: string; teacherId: string }) => `${e._id}:${e.teacherId}`).sort();
    // A third teacher who is free all week.
    await createVersioned(User, { username: 'teacher3', fullName: 'TEACHER3', role: 'teacher', passwordHash: (await User.findById(w.teacher).select('+passwordHash').lean())!.passwordHash });
    const plan = await s.p.get(`/api/timetable/substitutions/plan?teacherId=${w.teacher}&date=${MONDAY}`);
    expect(plan.status).toBe(200);
    expect(plan.body.data.lessons.length).toBeGreaterThan(0);
    const lesson = plan.body.data.lessons[0];
    const t3 = (await User.findOne({ username: 'teacher3' }).lean())!._id;
    expect(lesson.candidates.map((c: { teacherId: string }) => c.teacherId)).toContain(t3);
    expect(lesson.candidates.map((c: { teacherId: string }) => c.teacherId)).not.toContain(w.teacher);
    // teacher2 is suggested only where they have no lesson of their own in that period.
    const t2Busy = (await board(s.p, 'published')).entries.some((e: { teacherId: string; day: number; periodKey: string }) => e.teacherId === w.otherTeacher && e.day === 1 && e.periodKey === lesson.periodKey);
    expect(lesson.candidates.some((c: { teacherId: string }) => c.teacherId === w.otherTeacher)).toBe(!t2Busy);
    if (t2Busy) {
      const refused = await s.p.post('/api/timetable/substitutions', { date: MONDAY, entryId: lesson.entryId, substituteTeacherId: w.otherTeacher });
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/teaching their own class/);
    }
    const created = await s.p.post('/api/timetable/substitutions', { date: MONDAY, entryId: lesson.entryId, substituteTeacherId: t3, reason: 'Sick leave' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // The same lesson cannot get a second substitute, and teacher3 cannot cover two lessons in one period.
    expect((await s.p.post('/api/timetable/substitutions', { date: MONDAY, entryId: lesson.entryId, substituteTeacherId: t3 })).status).toBe(409);
    const sameSlot = (await board(s.p, 'published')).entries.find((e: { _id: string; day: number; periodKey: string }) => e._id !== lesson.entryId && e.day === 1 && e.periodKey === lesson.periodKey);
    if (sameSlot) expect((await s.p.post('/api/timetable/substitutions', { date: MONDAY, entryId: sameSlot._id, substituteTeacherId: t3 })).status).toBe(409);
    // Wrong weekday for the lesson.
    expect((await s.p.post('/api/timetable/substitutions', { date: '2026-11-17', entryId: lesson.entryId, substituteTeacherId: t3 })).status).toBe(400);
    // The permanent timetable is untouched; the cover is recorded and visible to both teachers.
    expect((await board(s.p, 'published')).entries.map((e: { _id: string; teacherId: string }) => `${e._id}:${e.teacherId}`).sort()).toEqual(publishedBefore);
    const t3Agent = await login(w.app, 'teacher3');
    const t3My = (await t3Agent.get(`/api/timetable/my?date=${MONDAY}`)).body.data;
    expect(t3My.covering).toHaveLength(1);
    expect(t3My.notices[0].kind).toBe('substitution');
    expect((await (await login(w.app, 'teacher1')).get(`/api/timetable/my?date=${MONDAY}`)).body.data.coveredBy).toHaveLength(1);
    const list = await s.p.get(`/api/timetable/substitutions?from=${MONDAY}&to=${MONDAY}`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].reason).toBe('Sick leave');
    // Cancel.
    expect((await s.p.post(`/api/timetable/substitutions/${created.body.data.substitution._id}/cancel`)).status).toBe(200);
    expect(await Substitution.countDocuments({ status: 'active' })).toBe(0);
    expect(await Substitution.countDocuments({ status: 'cancelled' })).toBe(1); // history is kept
  });

  it('no substitutions on holidays / closed special days', async () => {
    const s = await setup();
    await generate(s);
    await publish(s);
    const cfg = await s.p.get(`/api/timetable/config?sessionId=${w.sessionId}`);
    await s.p.put('/api/timetable/config', { sessionId: w.sessionId, workingDays: DAYS, dayStart: '07:30', dayEnd: '14:00', periods: PERIODS, specialDays: [{ date: MONDAY, label: 'Sports day', closed: true }], version: cfg.body.data.version });
    const plan = await s.p.get(`/api/timetable/substitutions/plan?teacherId=${w.teacher}&date=${MONDAY}`);
    expect(plan.body.data.plan.closed).toBe(true);
    expect(plan.body.data.lessons).toEqual([]);
  });
});

describe('access control', () => {
  it('only authorised staff can view or change timetables', async () => {
    const s = await setup();
    const t = await login(w.app, 'teacher1');
    expect((await t.get(`/api/timetable/board?sessionId=${w.sessionId}`)).status).toBe(403);
    expect((await t.post('/api/timetable/generate', { sessionId: w.sessionId, classroomIds: [w.classroomId], version: 1 })).status).toBe(403);
    expect((await t.post('/api/timetable/substitutions', { date: MONDAY, entryId: uuid(), substituteTeacherId: w.teacher })).status).toBe(403);
    expect((await t.put('/api/timetable/config', { sessionId: w.sessionId })).status).toBe(403);
    // Staff role: read-only.
    await createVersioned(User, { username: 'office', fullName: 'Office', role: 'staff', passwordHash: (await User.findById(w.teacher).select('+passwordHash').lean())!.passwordHash });
    const staff = await login(w.app, 'office');
    expect((await staff.get(`/api/timetable/board?sessionId=${w.sessionId}`)).status).toBe(200);
    expect((await staff.post('/api/timetable/generate', { sessionId: w.sessionId, classroomIds: [w.classroomId], version: 1 })).status).toBe(403);
    expect((await staff.post('/api/timetable/publish', { sessionId: w.sessionId, version: 1 })).status).toBe(403);
    // A principal can revoke publishing from an admin.
    expect((await s.p.patch(`/api/users/${w.admin}`, { revokedPermissions: ['timetable.publish'] })).status).toBe(200);
    expect((await (await login(w.app, 'admin1')).post('/api/timetable/publish', { sessionId: w.sessionId, version: 1 })).status).toBe(403);
    // Unauthenticated.
    expect((await request(w.app).get('/api/timetable/my')).status).toBe(401);
  });

  it('a teacher sees only their own schedule', async () => {
    const s = await setup();
    await generate(s);
    await publish(s);
    const mine = (await (await login(w.app, 'teacher2')).get('/api/timetable/my')).body.data.lessons;
    const theirs = (await board(s.p, 'published')).entries.filter((e: { teacherId: string }) => e.teacherId === w.otherTeacher);
    expect(mine).toHaveLength(theirs.length);
    expect(mine.every((l: { subject: string }) => ['Science', 'English'].includes(l.subject))).toBe(true);
  });

  it('parents see only linked children; students only their own class', async () => {
    const s = await setup();
    await generate(s);
    await publish(s);
    const { parent } = await makeParent(w); // linked to Ali and Sara (5-A), not Omar
    const ali = w.studentIds[0]!;
    const tt = await parent.get(`/api/parent/children/${ali}/timetable`);
    expect(tt.status).toBe(200);
    expect(tt.body.data.published).toBe(true);
    expect(tt.body.data.classroom.name).toBe('5-A');
    expect(tt.body.data.lessons).toHaveLength(12);
    expect(tt.body.data.lessons[0]).toEqual(expect.objectContaining({ subject: expect.any(String), teacher: expect.any(String), day: expect.any(Number), periodKey: expect.any(String) }));
    expect(tt.body.data.config.periods.find((p: { key: string }) => p.key === 'p1')).toEqual(expect.objectContaining({ start: '08:00', end: '08:40' }));
    // An unlinked child and a made-up id look the same: not found.
    expect((await parent.get(`/api/parent/children/${w.studentIds[2]}/timetable`)).status).toBe(404);
    expect((await parent.get(`/api/parent/children/${uuid()}/timetable`)).status).toBe(404);
    // Parents cannot reach staff timetable APIs.
    expect((await parent.get(`/api/timetable/board?sessionId=${w.sessionId}`)).status).toBe(403);
    expect((await parent.get('/api/timetable/my')).status).toBe(403);

    // Student account for Omar (moved to 5-B for this test).
    const omar = w.studentIds[2]!;
    const roomB = (await Classroom.findById(w.otherClassroomId).lean())!;
    await Student.updateOne({ _id: omar }, { classroomId: roomB._id, sectionId: roomB.sectionId });
    const acc = await s.p.post(`/api/students/${omar}/portal-account`, { username: 'omar.student' });
    expect(acc.status).toBe(201);
    expect((await s.p.post(`/api/students/${omar}/portal-account`, { username: 'omar2' })).status).toBe(409);
    // Separate sign-in pages.
    expect((await request(w.app).post('/api/auth/login').send({ username: 'omar.student', password: acc.body.data.temporaryPassword, portal: 'staff' })).status).toBe(401);
    expect((await request(w.app).post('/api/auth/login').send({ username: 'principal', password: 'Correct-Horse-9', portal: 'student' })).status).toBe(401);
    expect((await request(w.app).post('/api/auth/login').send({ username: 'omar.student', password: acc.body.data.temporaryPassword, portal: 'student' })).status).toBe(200);
    const st = await login(w.app, 'omar.student', acc.body.data.temporaryPassword);
    const me = await st.get('/api/student/timetable');
    expect(me.status).toBe(200);
    expect(me.body.data.classroom.name).toBe('5-B');
    expect(me.body.data.lessons).toHaveLength(12);
    expect((await st.get('/api/student/me')).body.data.fullName).toBe('Omar');
    // The student is fenced out of everything else.
    for (const u of [`/api/timetable/board?sessionId=${w.sessionId}`, '/api/timetable/my', `/api/parent/children/${ali}/timetable`, '/api/students', `/api/students/${ali}`]) {
      expect((await st.get(u)).status, u).toBe(403);
    }
    // Student accounts can never be given staff permissions.
    const su = (await User.findOne({ username: 'omar.student' }).lean())!;
    expect((await s.p.patch(`/api/users/${su._id}`, { extraPermissions: ['students.view'] })).status).toBe(400);
    expect((await s.p.patch(`/api/users/${su._id}`, { role: 'admin' })).status).toBe(400);
    // Suspending the account ends access.
    expect((await s.p.patch(`/api/students/${omar}/portal-account`, { status: 'suspended' })).status).toBe(200);
    expect((await st.get('/api/student/timetable')).status).toBe(401);
  });

  it('isolates data: references from another session or unknown ids are refused', async () => {
    const s = await setup();
    // A second session with its own classroom: it must not be usable in this session's timetable.
    const other = await createVersioned(AcademicSession, { name: '2027-2028', startDate: '2027-04-01', endDate: '2028-03-31' });
    const room = await Classroom.findById(w.classroomId).lean();
    const foreign = await createVersioned(Classroom, { classId: room!.classId, sectionId: room!.sectionId, sessionId: other._id, name: '5-A (next year)' });
    const v = (await board(s.p)).meta.version;
    expect((await s.p.put(`/api/timetable/requirements/${foreign._id}`, { sessionId: w.sessionId, items: [] })).status).toBe(404);
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: foreign._id, day: 1, periodKey: 'p1', subjectId: s.math, teacherId: null, version: v })).status).toBe(404);
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 1, periodKey: 'p1', subjectId: uuid(), teacherId: null, version: v })).status).toBe(404);
    expect((await s.p.post('/api/timetable/entries', { sessionId: w.sessionId, classroomId: w.classroomId, day: 1, periodKey: 'p1', subjectId: s.math, teacherId: uuid(), version: v })).status).toBe(404);
    expect((await s.p.post('/api/timetable/generate', { sessionId: w.sessionId, classroomIds: [foreign._id], version: v })).status).toBe(404);
    expect((await s.p.get(`/api/timetable/board?sessionId=${uuid()}`)).status).toBe(404);
    // A lesson id from the published set (or anywhere else) cannot be edited as a draft.
    expect((await s.p.patch(`/api/timetable/entries/${uuid()}`, { locked: true, version: v })).status).toBe(404);
  });
});

describe('notifications and data preservation', () => {
  it('queues guardian messages honestly and never reports them as sent without a provider', async () => {
    await SchoolSettings.updateOne({ _id: 'school' }, { smsAutomation: { enabled: true, events: ['timetable'], sendAfterSubmission: true, channels: ['sms'] } });
    invalidateSettings();
    const s = await setup();
    await makeParent(w);
    await generate(s);
    const pub = await publish(s);
    expect(pub.notification.guardianMessages.queued).toBeGreaterThan(0);
    const jobs = await NotificationJob.find({ event: 'timetable' }).lean();
    expect(jobs.length).toBe(pub.notification.guardianMessages.queued);
    expect(jobs.every((j) => j.status === 'pending')).toBe(true);
    await processSmsQueue();
    const after = await NotificationJob.find({ event: 'timetable' }).lean();
    expect(after.every((j) => j.status === 'blocked_config')).toBe(true);
    expect(after.some((j) => ['sent', 'delivered'].includes(j.status))).toBe(false);
    expect(await TimetableNotice.countDocuments({ kind: 'published', everyone: true })).toBe(1);
  });

  it('timetable operations never touch existing school records', async () => {
    const before = { students: await Student.countDocuments(), users: await User.countDocuments(), classrooms: await Classroom.countDocuments(), sessions: await AcademicSession.countDocuments() };
    const s = await setup();
    await generate(s);
    await publish(s);
    const b = await board(s.p);
    await s.p.post('/api/timetable/draft/clear', { sessionId: w.sessionId, version: b.meta.version });
    expect({ students: await Student.countDocuments(), users: await User.countDocuments(), classrooms: await Classroom.countDocuments(), sessions: await AcademicSession.countDocuments() }).toEqual(before);
    // Clearing the draft leaves the published timetable intact.
    expect((await board(s.p, 'published')).entries).toHaveLength(24);
  });
});
