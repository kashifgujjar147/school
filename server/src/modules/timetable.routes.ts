import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  WEEKDAY_NAMES, draftActionSchema, entryCreateSchema, entrySwapSchema, entryUpdateSchema, generateSchema, generateTimetable, isoDate,
  periodsForDay, planForDate, publishSchema, requirementsPutSchema, roomSchema, roomUpdateSchema, schoolDate, slotKey, subjectSchema,
  subjectUpdateSchema, substitutionCreateSchema, teacherProfileSchema, timetableConfigSchema, validateConfig, weekdayOf,
  type TEntry
} from '@sms/shared';
import { withTransaction } from '../config/db.js';
import {
  Classroom, Holiday, Room, Subject, SubjectRequirement, Substitution, TeacherAssignment, TeacherProfile, TimetableConfig, TimetableEntry, TimetableMeta, User
} from '../models/index.js';
import { can, canAny } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createVersioned, hardDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { renderPdf } from '../services/pdf.js';
import {
  assertChange, assertRefs, configShape, ensureMeta, getConfig, loadContext, noticesFor, notify, requireConfig, sessionOr404, teacherPool,
  toEntry, touchDraft, validateCtx, type Ctx
} from '../services/timetable.js';
import { AppError, badRequest, conflict, forbidden, h, notFound, ok, parse, queryBool } from '../utils/http.js';
import { $cmp, $in, $ne } from '../utils/query.js';

/**
 * Timetable & scheduling API. Every route checks its permission here on the server:
 *   timetable.view      read every timetable, setup and report (principal, admin, staff)
 *   timetable.manage    change setup, generate and edit the DRAFT
 *   timetable.publish   publish the draft (what teachers, students and parents see)
 *   substitutes.manage  assign / cancel substitute teachers
 * Teachers read only their own schedule through /my. Students and parents use their own portals.
 */
export const timetableRouter = Router();

const uuid = z.string().uuid();
const idParam = (v: unknown) => { const r = uuid.safeParse(v); if (!r.success) throw notFound(); return r.data; };
const stateQ = z.enum(['draft', 'published']).default('draft');
const isStaff = (req: Request) => req.user && req.user.role !== 'parent' && req.user.role !== 'student';
const today = async () => schoolDate(new Date(), (await getSettings()).timeZone);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ================================================================= Subjects
timetableRouter.get('/subjects', canAny('timetable.view', 'timetable.manage'), h(async (req, res) => {
  const all = parse(z.object({ archived: queryBool.optional() }), req.query).archived;
  ok(res, await Subject.find({ deletedAt: null, ...(all ? {} : { archived: false }) }).sort({ name: 1 }).lean());
}));
timetableRouter.post('/subjects', can('timetable.manage'), h(async (req, res) => {
  const b = parse(subjectSchema, req.body);
  if (await Subject.exists({ nameLower: b.name.toLowerCase(), deletedAt: null })) throw conflict(`A subject called "${b.name}" already exists`);
  const doc = await createVersioned(Subject, { ...b, nameLower: b.name.toLowerCase() });
  await audit(req, 'timetable.subject_created', 'subject', doc._id, { name: b.name });
  ok(res, doc, undefined, 201);
}));
timetableRouter.patch('/subjects/:id', can('timetable.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(subjectUpdateSchema, req.body);
  if (b.name && await Subject.exists({ nameLower: b.name.toLowerCase(), _id: $ne(id), deletedAt: null })) throw conflict(`A subject called "${b.name}" already exists`);
  const doc = await updateVersioned(Subject, id, { ...b, ...(b.name ? { nameLower: b.name.toLowerCase() } : {}) });
  await audit(req, 'timetable.subject_updated', 'subject', id, b);
  ok(res, doc);
}));

// ================================================================= Rooms & labs
timetableRouter.get('/rooms', canAny('timetable.view', 'timetable.manage'), h(async (req, res) => {
  const all = parse(z.object({ archived: queryBool.optional() }), req.query).archived;
  ok(res, await Room.find({ deletedAt: null, ...(all ? {} : { archived: false }) }).sort({ name: 1 }).lean());
}));
timetableRouter.post('/rooms', can('timetable.manage'), h(async (req, res) => {
  const b = parse(roomSchema, req.body);
  if (await Room.exists({ nameLower: b.name.toLowerCase(), deletedAt: null })) throw conflict(`A room called "${b.name}" already exists`);
  const doc = await createVersioned(Room, { ...b, nameLower: b.name.toLowerCase() });
  await audit(req, 'timetable.room_created', 'room', doc._id, { name: b.name });
  ok(res, doc, undefined, 201);
}));
timetableRouter.patch('/rooms/:id', can('timetable.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(roomUpdateSchema, req.body);
  if (b.name && await Room.exists({ nameLower: b.name.toLowerCase(), _id: $ne(id), deletedAt: null })) throw conflict(`A room called "${b.name}" already exists`);
  const doc = await updateVersioned(Room, id, { ...b, ...(b.name ? { nameLower: b.name.toLowerCase() } : {}) });
  await audit(req, 'timetable.room_updated', 'room', id, b);
  ok(res, doc);
}));

// ================================================================= Bell schedule
timetableRouter.get('/config', canAny('timetable.view', 'timetable.manage'), h(async (req, res) => {
  const { sessionId } = parse(z.object({ sessionId: uuid }), req.query);
  await sessionOr404(sessionId);
  const { doc } = await getConfig(sessionId);
  // null until the bell schedule is saved for this session; the editor then starts from the attendance working days.
  ok(res, doc ?? null);
}));
timetableRouter.put('/config', can('timetable.manage'), h(async (req, res) => {
  const b = parse(timetableConfigSchema, req.body);
  await sessionOr404(b.sessionId);
  const { version, sessionId, ...data } = b;
  const shape = configShape(data as never)!;
  const errors = validateConfig(shape);
  if (errors.length) throw badRequest(errors[0]!, { errors });
  const existing = await TimetableConfig.findOne({ sessionId, deletedAt: null }).lean();
  const doc = existing
    ? await updateVersioned(TimetableConfig, existing._id, { ...data, updatedBy: req.user!.id }, {}, version)
    : await createVersioned(TimetableConfig, { sessionId, ...data, updatedBy: req.user!.id });
  // Lessons now sitting on a break or a removed period become hard conflicts the board shows.
  const ctx = await loadContext(sessionId, 'draft');
  const affected = validateCtx(ctx).filter((c) => c.code === 'not_teaching_period' || c.code === 'not_working_day');
  await audit(req, 'timetable.config_saved', 'timetable_config', doc._id, { sessionId, workingDays: data.workingDays, periods: data.periods.length });
  ok(res, { config: doc, affectedLessons: affected.length });
}));

// ================================================================= Weekly requirements
timetableRouter.get('/requirements', canAny('timetable.view', 'timetable.manage'), h(async (req, res) => {
  const { sessionId } = parse(z.object({ sessionId: uuid }), req.query);
  ok(res, await SubjectRequirement.find({ sessionId, deletedAt: null }).lean());
}));
timetableRouter.put('/requirements/:classroomId', can('timetable.manage'), h(async (req, res) => {
  const classroomId = idParam(req.params.classroomId);
  const b = parse(requirementsPutSchema, req.body);
  const room = await Classroom.findOne({ _id: classroomId, sessionId: b.sessionId, deletedAt: null }).lean();
  if (!room) throw notFound('Classroom not found in this session');
  const [subjects, rooms, pool] = await Promise.all([
    Subject.find({ _id: $in(b.items.map((i) => i.subjectId)), deletedAt: null, archived: false }).select('_id').lean(),
    Room.find({ _id: $in(b.items.map((i) => i.roomId).filter((x): x is string => Boolean(x))), deletedAt: null, archived: false }).select('_id').lean(),
    teacherPool(b.sessionId)
  ]);
  for (const i of b.items) {
    if (!subjects.some((s) => s._id === i.subjectId)) throw notFound('Subject not found');
    if (i.roomId && !rooms.some((r) => r._id === i.roomId)) throw notFound('Room not found');
    if (i.teacherId && !pool.users.some((u) => u._id === i.teacherId)) throw notFound('Teacher not found');
    if (i.maxPerDay < 1) throw badRequest('maxPerDay must be at least 1');
  }
  const current = await SubjectRequirement.find({ classroomId, deletedAt: null }).lean();
  await withTransaction(async (session) => {
    for (const c of current) if (!b.items.some((i) => i.subjectId === c.subjectId)) await hardDeleteVersioned(SubjectRequirement, c._id, { session });
    for (const i of b.items) {
      const c = current.find((x) => x.subjectId === i.subjectId);
      if (c) await updateVersioned(SubjectRequirement, c._id, { ...i }, { session });
      else await createVersioned(SubjectRequirement, { sessionId: b.sessionId, classroomId, ...i }, { session });
    }
  });
  await audit(req, 'timetable.requirements_saved', 'classroom', classroomId, { subjects: b.items.length, periods: b.items.reduce((a, i) => a + i.periodsPerWeek, 0) });
  ok(res, await SubjectRequirement.find({ classroomId, deletedAt: null }).lean());
}));

// ================================================================= Teachers (availability, subjects, limits)
timetableRouter.get('/teachers', canAny('timetable.view', 'timetable.manage'), h(async (req, res) => {
  const { sessionId } = parse(z.object({ sessionId: uuid }), req.query);
  await sessionOr404(sessionId);
  const { users, profiles } = await teacherPool(sessionId);
  ok(res, users.map((u) => ({ _id: u._id, fullName: u.fullName, username: u.username, role: u.role, profile: profiles.find((p) => p.teacherId === u._id) ?? null })));
}));
timetableRouter.put('/teachers/:teacherId/profile', can('timetable.manage'), h(async (req, res) => {
  const teacherId = idParam(req.params.teacherId);
  const b = parse(teacherProfileSchema, req.body);
  await sessionOr404(b.sessionId);
  const u = await User.findOne({ _id: teacherId, status: 'active', deletedAt: null, role: $in(['teacher', 'principal', 'admin', 'staff']) }).lean();
  if (!u) throw notFound('Teacher not found');
  const subjects = await Subject.find({ _id: $in(b.subjectIds), deletedAt: null }).select('_id').lean();
  if (subjects.length !== new Set(b.subjectIds).size) throw notFound('Subject not found');
  const existing = await TeacherProfile.findOne({ sessionId: b.sessionId, teacherId, deletedAt: null }).lean();
  const { sessionId, ...data } = b;
  const doc = existing ? await updateVersioned(TeacherProfile, existing._id, data) : await createVersioned(TeacherProfile, { sessionId, teacherId, ...data });
  await audit(req, 'timetable.teacher_profile_saved', 'user', teacherId, { subjects: data.subjectIds.length, unavailable: data.unavailable.length, maxPerDay: data.maxPerDay, maxPerWeek: data.maxPerWeek });
  ok(res, doc);
}));

// ================================================================= Board (everything the editor needs)
timetableRouter.get('/board', can('timetable.view'), h(async (req, res) => {
  const q = parse(z.object({ sessionId: uuid, state: stateQ }), req.query);
  await sessionOr404(q.sessionId);
  const [ctx, meta] = await Promise.all([loadContext(q.sessionId, q.state), ensureMeta(q.sessionId)]);
  ok(res, {
    meta: { version: meta.version, status: meta.status, draftDirty: meta.draftDirty, publishedAt: meta.publishedAt, publishedBy: meta.publishedBy, publishCount: meta.publishCount, draftUpdatedAt: meta.draftUpdatedAt, lastGeneration: meta.lastGeneration },
    state: q.state, config: ctx.configDoc, entries: ctx.rawEntries.map((e) => ({ _id: e._id, classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null, locked: Boolean(e.locked), source: e.source })),
    conflicts: validateCtx(ctx),
    classrooms: ctx.classrooms.filter((c) => !c.archived).map((c) => ({ _id: c._id, name: c.name, classId: c.classId, sectionId: c.sectionId, room: c.room ?? null,
      className: ctx.classes.find((x) => x._id === c.classId)?.name ?? '', classOrder: ctx.classes.find((x) => x._id === c.classId)?.order ?? 0, sectionName: ctx.sections.find((x) => x._id === c.sectionId)?.name ?? '' })),
    teachers: ctx.teacherUsers.map((u) => ({ _id: u._id, fullName: u.fullName, role: u.role })),
    profiles: ctx.profiles, rooms: ctx.rooms, subjects: ctx.subjects, requirements: ctx.requirements
  });
}));

// ================================================================= Automatic generation
timetableRouter.post('/generate', can('timetable.manage'), h(async (req, res) => {
  const b = parse(generateSchema, req.body);
  await sessionOr404(b.sessionId);
  const ctx = await loadContext(b.sessionId, 'draft');
  if (!ctx.config) throw new AppError(409, 'TIMETABLE_NOT_CONFIGURED', 'Set up the school timings and periods for this session first.');
  for (const id of b.classroomIds) if (!ctx.classrooms.some((c) => c._id === id && !c.archived)) throw notFound('Classroom not found in this session');
  if (b.teacherIds) for (const id of b.teacherIds) if (!ctx.teacherUsers.some((u) => u._id === id)) throw notFound('Teacher not found');
  const selected = new Set(b.classroomIds);
  const reqs = ctx.requirements.filter((r) => selected.has(r.classroomId));
  if (!reqs.some((r) => r.periodsPerWeek > 0)) throw badRequest('The selected classes have no weekly subject requirements yet. Add them under Requirements first.');
  // Keep: every lesson of other classes, and locked lessons of the selected ones.
  const fixed = ctx.entries.filter((e) => !selected.has(e.classroomId) || (b.keepLocked && e.locked));
  const seed = b.seed ?? (Math.floor(Math.random() * 2_000_000_000) + 1);
  const result = generateTimetable({
    config: ctx.config, classroomIds: b.classroomIds, requirements: reqs, teachers: ctx.teachers, rooms: ctx.tRooms, fixed,
    days: b.days, teacherIds: b.teacherIds, seed, names: ctx.names, timeLimitMs: 12_000
  });
  const report = { at: new Date().toISOString(), by: req.user!.fullName, seed, status: result.status, stats: result.stats, unplaced: result.unplaced, diagnostics: result.diagnostics, classroomIds: b.classroomIds };
  const write = result.status === 'complete' || b.acceptPartial;
  let version: number | null = null;
  if (write) {
    const removed = ctx.rawEntries.filter((e) => selected.has(e.classroomId) && !(b.keepLocked && e.locked));
    const meta = await withTransaction(async (session) => {
      const m = await touchDraft(b.sessionId, b.version, req.user!.id, session, { lastGeneration: report });
      for (const e of removed) await hardDeleteVersioned(TimetableEntry, e._id, { session });
      for (const e of result.entries) {
        await createVersioned(TimetableEntry, { sessionId: b.sessionId, state: 'draft', classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId, locked: false, source: 'auto' }, { session });
      }
      return m;
    });
    version = meta.version;
    await audit(req, 'timetable.generated', 'timetable', b.sessionId, { status: result.status, placed: result.stats.placed, required: result.stats.required, classrooms: b.classroomIds.length, seed, partial: result.status !== 'complete' });
  }
  ok(res, { written: write, version, ...report });
}));

// ================================================================= Manual editing (draft only)
async function draftEntry(id: string) {
  const e = await TimetableEntry.findOne({ _id: id, state: 'draft', deletedAt: null }).lean();
  if (!e) throw notFound('Lesson not found in the draft');
  return e;
}

timetableRouter.post('/entries', can('timetable.manage'), h(async (req, res) => {
  const b = parse(entryCreateSchema, req.body);
  await sessionOr404(b.sessionId);
  const ctx = await loadContext(b.sessionId, 'draft');
  if (!ctx.config) throw new AppError(409, 'TIMETABLE_NOT_CONFIGURED', 'Set up the school timings and periods for this session first.');
  assertRefs(ctx, b);
  // Multi-period lessons: the following teaching periods, back to back (no break in between).
  const all = periodsForDay(ctx.config, b.day);
  const start = all.findIndex((p) => p.key === b.periodKey);
  const keys: string[] = [];
  if (start < 0 || all[start]!.kind !== 'teaching') {
    keys.push(b.periodKey); // a break, an unknown period or a non-working day: validation below reports exactly why (409)
  } else {
    for (let i = start; i < all.length && keys.length < b.span; i++) { if (all[i]!.kind !== 'teaching') break; keys.push(all[i]!.key); }
    if (keys.length < b.span) throw badRequest(`Only ${keys.length} consecutive teaching period(s) are available from that period before a break or the end of the day.`);
  }
  const newEntries: TEntry[] = keys.map((k, i) => ({ id: `new-${i}`, classroomId: b.classroomId, day: b.day, periodKey: k, subjectId: b.subjectId, teacherId: b.teacherId, roomId: b.roomId, locked: b.locked }));
  const warnings = assertChange(ctx, [...ctx.entries, ...newEntries], b.confirmWarnings);
  const { created, meta } = await withTransaction(async (session) => {
    const m = await touchDraft(b.sessionId, b.version, req.user!.id, session);
    const out = [];
    for (const e of newEntries) out.push(await createVersioned(TimetableEntry, { sessionId: b.sessionId, state: 'draft', classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId, roomId: e.roomId, locked: Boolean(e.locked), source: 'manual' }, { session }));
    return { created: out, meta: m };
  });
  await audit(req, 'timetable.entry_added', 'timetable_entry', created[0]!._id, { classroomId: b.classroomId, day: b.day, periods: keys, subjectId: b.subjectId, teacherId: b.teacherId, warnings: warnings.map((w) => w.code) });
  ok(res, { entries: created, version: meta.version, warnings }, undefined, 201);
}));

timetableRouter.patch('/entries/:id', can('timetable.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(entryUpdateSchema, req.body);
  const cur = await draftEntry(id);
  const ctx = await loadContext(cur.sessionId, 'draft');
  const next: TEntry = { ...toEntry(cur), ...(b.day !== undefined ? { day: b.day } : {}), ...(b.periodKey !== undefined ? { periodKey: b.periodKey } : {}),
    ...(b.subjectId !== undefined ? { subjectId: b.subjectId } : {}), ...(b.teacherId !== undefined ? { teacherId: b.teacherId } : {}),
    ...(b.roomId !== undefined ? { roomId: b.roomId } : {}), ...(b.locked !== undefined ? { locked: b.locked } : {}) };
  assertRefs(ctx, next);
  const warnings = assertChange(ctx, ctx.entries.map((e) => (e.id === id ? next : e)), b.confirmWarnings);
  const { version: _v, confirmWarnings: _c, ...patch } = b;
  const { doc, meta } = await withTransaction(async (session) => {
    const m = await touchDraft(cur.sessionId, b.version, req.user!.id, session);
    return { doc: await updateVersioned(TimetableEntry, id, { ...patch, source: 'manual' }, { session }), meta: m };
  });
  const moved = b.day !== undefined || b.periodKey !== undefined;
  await audit(req, moved ? 'timetable.entry_moved' : 'timetable.entry_updated', 'timetable_entry', id, { from: { day: cur.day, periodKey: cur.periodKey, teacherId: cur.teacherId, roomId: cur.roomId, subjectId: cur.subjectId }, to: patch, warnings: warnings.map((w) => w.code) });
  ok(res, { entry: doc, version: meta.version, warnings });
}));

timetableRouter.delete('/entries/:id', can('timetable.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const q = parse(z.object({ version: z.coerce.number().int().min(1), confirmWarnings: queryBool.optional() }), req.query);
  const cur = await draftEntry(id);
  const ctx = await loadContext(cur.sessionId, 'draft');
  const warnings = assertChange(ctx, ctx.entries.filter((e) => e.id !== id), Boolean(q.confirmWarnings));
  const meta = await withTransaction(async (session) => {
    const m = await touchDraft(cur.sessionId, q.version, req.user!.id, session);
    await hardDeleteVersioned(TimetableEntry, id, { session });
    return m;
  });
  await audit(req, 'timetable.entry_removed', 'timetable_entry', id, { classroomId: cur.classroomId, day: cur.day, periodKey: cur.periodKey, subjectId: cur.subjectId, teacherId: cur.teacherId });
  ok(res, { version: meta.version, warnings });
}));

/** Swap two lessons of the same class: each takes the other's subject, teacher and room. */
timetableRouter.post('/entries/swap', can('timetable.manage'), h(async (req, res) => {
  const b = parse(entrySwapSchema, req.body);
  if (b.a === b.b) throw badRequest('Choose two different lessons');
  const [a, c] = await Promise.all([draftEntry(b.a), draftEntry(b.b)]);
  if (a.sessionId !== b.sessionId || c.sessionId !== b.sessionId) throw notFound('Lesson not found in the draft');
  if (a.classroomId !== c.classroomId) throw badRequest('Only lessons of the same class can be swapped. Move the lesson instead.');
  const ctx = await loadContext(b.sessionId, 'draft');
  const content = (e: typeof a) => ({ subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null, locked: Boolean(e.locked) });
  const after = ctx.entries.map((e) => (e.id === a._id ? { ...e, ...content(c) } : e.id === c._id ? { ...e, ...content(a) } : e));
  const warnings = assertChange(ctx, after, b.confirmWarnings);
  const meta = await withTransaction(async (session) => {
    const m = await touchDraft(b.sessionId, b.version, req.user!.id, session);
    // Clear teacher/room on one side first so the unique indexes never see a transient double-booking.
    await updateVersioned(TimetableEntry, a._id, { teacherId: null, roomId: null }, { session });
    await updateVersioned(TimetableEntry, c._id, { ...content(a), source: 'manual' }, { session });
    await updateVersioned(TimetableEntry, a._id, { ...content(c), source: 'manual' }, { session });
    return m;
  });
  await audit(req, 'timetable.entries_swapped', 'timetable_entry', a._id, { a: { id: a._id, day: a.day, periodKey: a.periodKey }, b: { id: c._id, day: c.day, periodKey: c.periodKey } });
  ok(res, { version: meta.version, warnings });
}));

timetableRouter.post('/draft/clear', can('timetable.manage'), h(async (req, res) => {
  const b = parse(draftActionSchema, req.body);
  await sessionOr404(b.sessionId);
  const filter: Record<string, unknown> = { sessionId: b.sessionId, state: 'draft', deletedAt: null };
  if (b.classroomIds?.length) filter.classroomId = $in(b.classroomIds);
  const list = (await TimetableEntry.find(filter).lean()).filter((e) => !(b.keepLocked && e.locked));
  const meta = await withTransaction(async (session) => {
    const m = await touchDraft(b.sessionId, b.version, req.user!.id, session);
    for (const e of list) await hardDeleteVersioned(TimetableEntry, e._id, { session });
    return m;
  });
  await audit(req, 'timetable.draft_cleared', 'timetable', b.sessionId, { removed: list.length, classrooms: b.classroomIds?.length ?? 'all' });
  ok(res, { removed: list.length, version: meta.version });
}));

/** Throws away draft changes: the draft becomes a copy of the published timetable again. */
timetableRouter.post('/draft/reset', can('timetable.manage'), h(async (req, res) => {
  const b = parse(draftActionSchema, req.body);
  await sessionOr404(b.sessionId);
  const [drafts, published] = await Promise.all([
    TimetableEntry.find({ sessionId: b.sessionId, state: 'draft', deletedAt: null }).lean(),
    TimetableEntry.find({ sessionId: b.sessionId, state: 'published', deletedAt: null }).lean()
  ]);
  const meta = await withTransaction(async (session) => {
    const m = await touchDraft(b.sessionId, b.version, req.user!.id, session);
    for (const e of drafts) await hardDeleteVersioned(TimetableEntry, e._id, { session });
    for (const e of published) await createVersioned(TimetableEntry, { sessionId: b.sessionId, state: 'draft', classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null, locked: Boolean(e.locked), source: e.source ?? 'manual' }, { session });
    return updateVersioned(TimetableMeta, m._id, { draftDirty: false }, { session });
  });
  await audit(req, 'timetable.draft_reset', 'timetable', b.sessionId, { restored: published.length });
  ok(res, { restored: published.length, version: meta.version });
}));

// ================================================================= Publishing
const sameLesson = (a: { subjectId: string; teacherId?: string | null; roomId?: string | null }, b: { subjectId: string; teacherId?: string | null; roomId?: string | null }) =>
  a.subjectId === b.subjectId && (a.teacherId ?? null) === (b.teacherId ?? null) && (a.roomId ?? null) === (b.roomId ?? null);

timetableRouter.post('/publish', can('timetable.publish'), h(async (req, res) => {
  const b = parse(publishSchema, req.body);
  await sessionOr404(b.sessionId);
  const ctx = await loadContext(b.sessionId, 'draft');
  if (!ctx.config) throw new AppError(409, 'TIMETABLE_NOT_CONFIGURED', 'Set up the school timings and periods for this session first.');
  if (!ctx.entries.length) throw badRequest('The draft is empty. Generate or add lessons before publishing.');
  const conflicts = validateCtx(ctx);
  const errors = conflicts.filter((c) => c.severity === 'error');
  if (errors.length) throw new AppError(409, 'TIMETABLE_CONFLICT', `The draft has ${errors.length} conflict(s) that must be fixed before publishing.`, { conflicts: errors });
  const warnings = conflicts.filter((c) => c.severity === 'warning');
  if (warnings.length && !b.confirmWarnings) throw new AppError(422, 'TIMETABLE_WARNINGS', `The draft has ${warnings.length} warning(s). Confirm to publish anyway.`, { conflicts: warnings });

  const published = await TimetableEntry.find({ sessionId: b.sessionId, state: 'published', deletedAt: null }).lean();
  const key = (e: { classroomId: string; day: number; periodKey: string }) => `${e.classroomId}|${e.day}|${e.periodKey}`;
  const draftByKey = new Map(ctx.rawEntries.map((e) => [key(e), e]));
  const pubByKey = new Map(published.map((e) => [key(e), e]));
  const toDelete = published.filter((p) => { const d = draftByKey.get(key(p)); return !d || !sameLesson(d, p) || Boolean(d.locked) !== Boolean(p.locked); });
  const toCreate = ctx.rawEntries.filter((d) => { const p = pubByKey.get(key(d)); return !p || !sameLesson(d, p) || Boolean(d.locked) !== Boolean(p.locked); });
  const first = published.length === 0;
  const t = await today();

  const { meta, cancelledSubs } = await withTransaction(async (session) => {
    const m = await touchDraft(b.sessionId, b.version, req.user!.id, session);
    // Deletions first, then creations: no intermediate state can collide on the unique indexes.
    for (const e of toDelete) await hardDeleteVersioned(TimetableEntry, e._id, { session });
    for (const d of toCreate) await createVersioned(TimetableEntry, { sessionId: b.sessionId, state: 'published', classroomId: d.classroomId, day: d.day, periodKey: d.periodKey, subjectId: d.subjectId, teacherId: d.teacherId ?? null, roomId: d.roomId ?? null, locked: Boolean(d.locked), source: d.source ?? 'manual' }, { session });
    // A substitution for a lesson that no longer exists in that form is cancelled, never left dangling.
    const stale = toDelete.length ? await Substitution.find({ entryId: $in(toDelete.map((e) => e._id)), status: 'active', date: $cmp({ gte: t }), deletedAt: null }).session(session ?? null).lean() : [];
    for (const s of stale) await updateVersioned(Substitution, s._id, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user!.id }, { session });
    const done = await updateVersioned(TimetableMeta, m._id, { status: 'published', draftDirty: false, publishedAt: new Date(), publishedBy: req.user!.fullName, publishCount: (m.publishCount ?? 0) + 1 }, { session });
    return { meta: done.toObject(), cancelledSubs: stale };
  });

  // Who is affected: classrooms and teachers of every lesson that changed.
  const changed = [...toDelete, ...toCreate];
  const classroomIds = [...new Set(changed.map((e) => e.classroomId))];
  const teacherIds = [...new Set(changed.map((e) => e.teacherId).filter((x): x is string => Boolean(x)))];
  const lines = toCreate.slice(0, 15).map((d) => {
    const before = pubByKey.get(key(d));
    const where = `${ctx.names.classroom(d.classroomId)}, ${ctx.names.period(d.day, d.periodKey)}`;
    return before ? `${where}: ${ctx.names.subject(before.subjectId)} → ${ctx.names.subject(d.subjectId)}${d.teacherId !== before.teacherId ? ` (teacher: ${d.teacherId ? ctx.names.teacher(d.teacherId) : '—'})` : ''}${d.roomId !== before.roomId ? ` (room: ${d.roomId ? ctx.names.room(d.roomId) : '—'})` : ''}` : `${where}: ${ctx.names.subject(d.subjectId)} added`;
  });
  const removedOnly = toDelete.filter((p) => !draftByKey.has(key(p))).slice(0, 5).map((p) => `${ctx.names.classroom(p.classroomId)}, ${ctx.names.period(p.day, p.periodKey)}: ${ctx.names.subject(p.subjectId)} removed`);
  let notification = null;
  if (first || changed.length) {
    notification = await notify({
      sessionId: b.sessionId, kind: first ? 'published' : 'changed', everyone: first,
      title: first ? 'New timetable published' : 'Timetable updated',
      body: first ? `The class timetable is now available.${b.note ? ` ${b.note}` : ''}` : [`${changed.length ? `${new Set(changed.map(key)).size} period(s) changed.` : ''}`, ...lines, ...removedOnly, ...(b.note ? [b.note] : [])].join('\n'),
      teacherIds, classroomIds, actorId: req.user!.id, refId: meta._id,
      guardianKey: `timetable-publish-${meta._id}-${meta.publishCount}`,
      guardianMessage: first ? 'The new class timetable is now in the portal.' : 'Some periods, teachers or rooms have changed. Please check the portal.'
    });
  }
  await audit(req, 'timetable.published', 'timetable', b.sessionId, { lessons: ctx.entries.length, changed: changed.length, first, warnings: warnings.length, cancelledSubstitutions: cancelledSubs.length });
  ok(res, { version: meta.version, publishedAt: meta.publishedAt, lessons: ctx.entries.length, changedPeriods: new Set(changed.map(key)).size, cancelledSubstitutions: cancelledSubs.length, notification });
}));

// ================================================================= Print / PDF export
timetableRouter.get('/export.pdf', can('timetable.view'), h(async (req, res) => {
  const q = parse(z.object({ sessionId: uuid, state: stateQ, view: z.enum(['classroom', 'teacher', 'room']), id: uuid }), req.query);
  await sessionOr404(q.sessionId);
  const ctx = await loadContext(q.sessionId, q.state);
  if (!ctx.config) throw new AppError(409, 'TIMETABLE_NOT_CONFIGURED', 'No timings configured for this session.');
  const title = q.view === 'classroom' ? ctx.names.classroom(q.id) : q.view === 'teacher' ? ctx.names.teacher(q.id) : ctx.names.room(q.id);
  if (title === 'Unknown') throw notFound();
  const mine = ctx.entries.filter((e) => (q.view === 'classroom' ? e.classroomId === q.id : q.view === 'teacher' ? e.teacherId === q.id : e.roomId === q.id));
  const pdf = await timetablePdf(ctx, mine, `${title} — timetable`, q.state, q.view);
  await audit(req, 'timetable.exported', 'timetable', q.sessionId, { view: q.view, id: q.id, state: q.state });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="timetable-${title.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.pdf"`);
  res.send(pdf);
}));

async function timetablePdf(ctx: Ctx, entries: TEntry[], title: string, state: string, view: 'classroom' | 'teacher' | 'room') {
  const cfg = ctx.config!;
  const s = await getSettings();
  const cols = cfg.periods;
  const cell = (day: number, key: string) => {
    const p = periodsForDay(cfg, day).find((x) => x.key === key);
    if (!p) return '';
    if (p.kind !== 'teaching') return p.label;
    const e = entries.find((x) => x.day === day && x.periodKey === key);
    if (!e) return '—';
    const who = view === 'teacher' ? ctx.names.classroom(e.classroomId) : e.teacherId ? ctx.names.teacher(e.teacherId) : '';
    return [ctx.names.subject(e.subjectId), who, view !== 'room' && e.roomId ? ctx.names.room(e.roomId) : ''].filter(Boolean).join(' · ');
  };
  const width = Math.max(48, Math.floor(700 / (cols.length + 1)));
  return renderPdf({
    title, subtitle: `${state === 'draft' ? 'DRAFT — not published. ' : ''}Generated ${new Date().toISOString().slice(0, 10)}${cfg.dayOverrides.length ? ' · Some weekdays have their own bell schedule (see the dashboard).' : ''}`,
    columns: [{ header: 'Day', key: 'day', width: 70 }, ...cols.map((p) => ({ header: `${p.label} ${p.start}-${p.end}`, key: p.key, width }))],
    rows: [...cfg.workingDays].sort().map((d) => ({ day: WEEKDAY_NAMES[d], ...Object.fromEntries(cols.map((p) => [p.key, cell(d, p.key)])) })),
    summary: [`${entries.length} lesson(s) per week`]
  }, { schoolName: s.name, logoPath: s.logoPath, header: s.reportHeader, footer: s.reportFooter, primaryColor: s.primaryColor ?? '#1e3a5f' });
}

// ================================================================= Teacher's own schedule (any staff member; own data only)
timetableRouter.get('/my', h(async (req, res) => {
  if (!isStaff(req)) throw forbidden();
  const s = await getSettings();
  const q = parse(z.object({ date: isoDate.optional() }), req.query);
  const sessionId = s.defaultSessionId;
  const from = q.date ?? schoolDate(new Date(), s.timeZone);
  const me = req.user!.id;
  if (!sessionId) return ok(res, { configured: false, published: false, config: null, lessons: [], covering: [], coveredBy: [], notices: [], plans: [] });
  const [{ shape }, meta, lessons, covering, coveredBy, holidays, notices] = await Promise.all([
    getConfig(sessionId), TimetableMeta.findOne({ sessionId, deletedAt: null }).lean(),
    TimetableEntry.find({ sessionId, state: 'published', teacherId: me, deletedAt: null }).lean(),
    Substitution.find({ substituteTeacherId: me, status: 'active', deletedAt: null, date: $cmp({ gte: from, lte: addDays(from, 13) }) }).sort({ date: 1 }).lean(),
    Substitution.find({ originalTeacherId: me, status: 'active', deletedAt: null, date: $cmp({ gte: from, lte: addDays(from, 13) }) }).sort({ date: 1 }).lean(),
    Holiday.find({ deletedAt: null, date: $cmp({ lte: addDays(from, 13) }) }).lean(),
    noticesFor({ teacherId: me })
  ]);
  const classroomIds = [...lessons.map((l) => l.classroomId), ...covering.map((c) => c.classroomId), ...coveredBy.map((c) => c.classroomId)];
  const subjectIds = [...lessons.map((l) => l.subjectId), ...covering.map((c) => c.subjectId), ...coveredBy.map((c) => c.subjectId)];
  const roomIds = [...lessons.map((l) => l.roomId), ...covering.map((c) => c.roomId)].filter((x): x is string => Boolean(x));
  const [rooms, subjects, places, people] = await Promise.all([
    Classroom.find({ _id: $in(classroomIds) }).select('name room').lean(), Subject.find({ _id: $in(subjectIds) }).select('name color').lean(),
    Room.find({ _id: $in(roomIds) }).select('name').lean(), User.find({ _id: $in([...covering.map((c) => c.originalTeacherId), ...coveredBy.map((c) => c.substituteTeacherId)].filter((x): x is string => Boolean(x))) }).select('fullName').lean()
  ]);
  const cn = (id: string) => rooms.find((r) => r._id === id); const sn = (id: string) => subjects.find((x) => x._id === id);
  const rn = (id?: string | null, classroomId?: string) => (id ? places.find((r) => r._id === id)?.name : undefined) ?? (classroomId ? cn(classroomId)?.room : undefined) ?? null;
  const pn = (id?: string | null) => (id ? people.find((p) => p._id === id)?.fullName ?? null : null);
  ok(res, {
    configured: Boolean(shape), published: meta?.status === 'published', publishedAt: meta?.publishedAt ?? null, config: shape,
    lessons: lessons.map((l) => ({ _id: l._id, day: l.day, periodKey: l.periodKey, classroom: cn(l.classroomId)?.name ?? '', subject: sn(l.subjectId)?.name ?? '', subjectColor: sn(l.subjectId)?.color ?? null, room: rn(l.roomId, l.classroomId) })),
    covering: covering.map((c) => ({ _id: c._id, date: c.date, periodKey: c.periodKey, classroom: cn(c.classroomId)?.name ?? '', subject: sn(c.subjectId)?.name ?? '', room: rn(c.roomId, c.classroomId), forTeacher: pn(c.originalTeacherId) })),
    coveredBy: coveredBy.map((c) => ({ _id: c._id, date: c.date, periodKey: c.periodKey, entryId: c.entryId, classroom: cn(c.classroomId)?.name ?? '', subject: sn(c.subjectId)?.name ?? '', substitute: pn(c.substituteTeacherId) })),
    notices,
    plans: shape ? Array.from({ length: 7 }, (_, i) => planForDate(shape, addDays(from, i), holidays)) : []
  });
}));

// ================================================================= Substitutes
interface Candidate { teacherId: string; fullName: string; qualified: boolean; teachesClass: boolean; lessonsThatDay: number }

/** Teachers who can cover a lesson on a date, best first. Hard rules: free, available, under the daily limit, not absent. */
async function coverCandidates(sessionId: string, date: string, day: number, periodKey: string, subjectId: string, classroomId: string, exclude: string[]) {
  const cfg = await requireConfig(sessionId);
  const { users, profiles } = await teacherPool(sessionId);
  const [published, subsThatDay, absentees, assignments] = await Promise.all([
    TimetableEntry.find({ sessionId, state: 'published', day, deletedAt: null }).select('teacherId periodKey').lean(),
    Substitution.find({ date, status: 'active', deletedAt: null }).select('substituteTeacherId originalTeacherId periodKey').lean(),
    Substitution.distinct('originalTeacherId', { date, status: 'active', deletedAt: null }),
    TeacherAssignment.find({ classroomId, endedAt: null, deletedAt: null }).select('teacherId').lean()
  ]);
  const out: Candidate[] = [];
  const reasons: Record<string, string> = {};
  for (const u of users) {
    if (exclude.includes(u._id)) continue;
    const p = profiles.find((x) => x.teacherId === u._id);
    const ownLessons = published.filter((e) => e.teacherId === u._id);
    const covering = subsThatDay.filter((s) => s.substituteTeacherId === u._id);
    if ((absentees as string[]).includes(u._id)) { reasons[u._id] = 'absent (being covered)'; continue; }
    if (ownLessons.some((e) => e.periodKey === periodKey)) { reasons[u._id] = 'teaching their own class'; continue; }
    if (covering.some((s) => s.periodKey === periodKey)) { reasons[u._id] = 'already covering another lesson'; continue; }
    if (p?.unavailable?.includes(slotKey(day, periodKey))) { reasons[u._id] = 'marked unavailable'; continue; }
    const limit = p?.maxPerDay ?? cfg.teacherMaxPerDay;
    const load = ownLessons.length + covering.length;
    if (limit !== null && load >= limit) { reasons[u._id] = `already at the daily limit (${limit})`; continue; }
    out.push({ teacherId: u._id, fullName: u.fullName, qualified: Boolean(p?.subjectIds?.includes(subjectId)), teachesClass: assignments.some((a) => a.teacherId === u._id), lessonsThatDay: load });
  }
  out.sort((a, b) => Number(b.qualified) - Number(a.qualified) || Number(b.teachesClass) - Number(a.teachesClass) || a.lessonsThatDay - b.lessonsThatDay || a.fullName.localeCompare(b.fullName));
  return { candidates: out, unavailable: reasons };
}

timetableRouter.get('/substitutions', canAny('timetable.view', 'substitutes.manage'), h(async (req, res) => {
  const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional(), includeCancelled: queryBool.optional() }), req.query);
  const from = q.from ?? await today(); const to = q.to ?? addDays(from, 30);
  if (from > to) throw badRequest('from must be on or before to');
  const subs = await Substitution.find({ deletedAt: null, date: $cmp({ gte: from, lte: to }), ...(q.includeCancelled ? {} : { status: 'active' }) }).sort({ date: 1, periodKey: 1 }).limit(1000).lean();
  const [people, rooms, subjects, places] = await Promise.all([
    User.find({ _id: $in([...subs.map((s) => s.substituteTeacherId), ...subs.map((s) => s.originalTeacherId)].filter((x): x is string => Boolean(x))) }).select('fullName').lean(),
    Classroom.find({ _id: $in(subs.map((s) => s.classroomId)) }).select('name').lean(),
    Subject.find({ _id: $in(subs.map((s) => s.subjectId)) }).select('name').lean(),
    Room.find({ _id: $in(subs.map((s) => s.roomId).filter((x): x is string => Boolean(x))) }).select('name').lean()
  ]);
  const name = (list: { _id: string; fullName?: string; name?: string }[], id?: string | null) => { const x = list.find((y) => y._id === id); return x ? (x.fullName ?? x.name ?? '') : null; };
  ok(res, subs.map((s) => ({ ...s, substitute: name(people, s.substituteTeacherId), original: name(people, s.originalTeacherId), classroom: name(rooms, s.classroomId), subject: name(subjects, s.subjectId), room: name(places, s.roomId) })));
}));

/** The absent teacher's lessons on a date, with existing covers and ranked suggestions for each. */
timetableRouter.get('/substitutions/plan', canAny('substitutes.manage', 'timetable.view'), h(async (req, res) => {
  const q = parse(z.object({ teacherId: uuid, date: isoDate }), req.query);
  const s = await getSettings();
  const sessionId = s.defaultSessionId;
  if (!sessionId) throw badRequest('Choose a default academic session first.');
  const cfg = await requireConfig(sessionId);
  const teacher = await User.findOne({ _id: q.teacherId, deletedAt: null }).select('fullName').lean();
  if (!teacher) throw notFound('Teacher not found');
  const holidays = await Holiday.find({ deletedAt: null, date: $cmp({ lte: q.date }) }).lean();
  const plan = planForDate(cfg, q.date, holidays);
  if (plan.closed) return ok(res, { date: q.date, teacher: teacher.fullName, plan, lessons: [] });
  const day = weekdayOf(q.date);
  const happening = new Set(plan.periods.filter((p) => p.kind === 'teaching').map((p) => p.key));
  const lessons = (await TimetableEntry.find({ sessionId, state: 'published', teacherId: q.teacherId, day, deletedAt: null }).lean()).filter((e) => happening.has(e.periodKey));
  const existing = await Substitution.find({ date: q.date, entryId: $in(lessons.map((l) => l._id)), status: 'active', deletedAt: null }).lean();
  const [rooms, subjects, subUsers] = await Promise.all([
    Classroom.find({ _id: $in(lessons.map((l) => l.classroomId)) }).select('name').lean(),
    Subject.find({ _id: $in(lessons.map((l) => l.subjectId)) }).select('name').lean(),
    User.find({ _id: $in(existing.map((e) => e.substituteTeacherId)) }).select('fullName').lean()
  ]);
  const out = [];
  for (const l of lessons.sort((a, b) => plan.periods.findIndex((p) => p.key === a.periodKey) - plan.periods.findIndex((p) => p.key === b.periodKey))) {
    const cover = existing.find((e) => e.entryId === l._id);
    const period = plan.periods.find((p) => p.key === l.periodKey)!;
    const c = cover ? null : await coverCandidates(sessionId, q.date, day, l.periodKey, l.subjectId, l.classroomId, [q.teacherId]);
    out.push({
      entryId: l._id, periodKey: l.periodKey, period: { label: period.label, start: period.start, end: period.end },
      classroom: rooms.find((r) => r._id === l.classroomId)?.name ?? '', subject: subjects.find((x) => x._id === l.subjectId)?.name ?? '',
      cover: cover ? { _id: cover._id, substitute: subUsers.find((u) => u._id === cover.substituteTeacherId)?.fullName ?? '', reason: cover.reason } : null,
      candidates: c?.candidates.slice(0, 15) ?? [], unavailableCount: c ? Object.keys(c.unavailable).length : 0
    });
  }
  ok(res, { date: q.date, teacher: teacher.fullName, plan, lessons: out });
}));

timetableRouter.post('/substitutions', can('substitutes.manage'), h(async (req, res) => {
  const b = parse(substitutionCreateSchema, req.body);
  const entry = await TimetableEntry.findOne({ _id: b.entryId, state: 'published', deletedAt: null }).lean();
  if (!entry) throw notFound('Published lesson not found');
  const session = await sessionOr404(entry.sessionId);
  if (b.date < session.startDate || b.date > session.endDate) throw badRequest('The date is outside the academic session.');
  const day = weekdayOf(b.date);
  if (day !== entry.day) throw badRequest(`That lesson is on ${WEEKDAY_NAMES[entry.day]}, but ${b.date} is a ${WEEKDAY_NAMES[day]}.`);
  const cfg = await requireConfig(entry.sessionId);
  const plan = planForDate(cfg, b.date, await Holiday.find({ deletedAt: null, date: $cmp({ lte: b.date }) }).lean());
  if (plan.closed) throw badRequest(`The school is closed on ${b.date}${plan.label ? ` (${plan.label})` : ''}.`);
  if (!plan.periods.some((p) => p.key === entry.periodKey && p.kind === 'teaching')) throw badRequest('That period does not take place on this date (special schedule).');
  if (b.substituteTeacherId === entry.teacherId) throw badRequest('The substitute must be a different teacher.');
  const { candidates, unavailable } = await coverCandidates(entry.sessionId, b.date, day, entry.periodKey, entry.subjectId, entry.classroomId, entry.teacherId ? [entry.teacherId] : []);
  if (!candidates.some((c) => c.teacherId === b.substituteTeacherId)) {
    const why = unavailable[b.substituteTeacherId];
    throw conflict(why ? `That teacher cannot cover this lesson: ${why}.` : 'That teacher cannot be scheduled.');
  }
  if (b.roomId) {
    const r = await Room.findOne({ _id: b.roomId, deletedAt: null, archived: false }).lean();
    if (!r) throw notFound('Room not found');
    const busy = await TimetableEntry.exists({ sessionId: entry.sessionId, state: 'published', roomId: b.roomId, day, periodKey: entry.periodKey, _id: $ne(entry._id), deletedAt: null })
      || await Substitution.exists({ date: b.date, periodKey: entry.periodKey, roomId: b.roomId, status: 'active', deletedAt: null });
    if (busy) throw conflict('That room is already booked in this period.');
  }
  let sub;
  try {
    sub = await createVersioned(Substitution, {
      sessionId: entry.sessionId, date: b.date, day, periodKey: entry.periodKey, entryId: entry._id, classroomId: entry.classroomId, subjectId: entry.subjectId,
      originalTeacherId: entry.teacherId ?? null, substituteTeacherId: b.substituteTeacherId, roomId: b.roomId ?? entry.roomId ?? null, reason: b.reason ?? null, createdBy: req.user!.id
    });
  } catch (e) {
    // The unique indexes are the last line of defence against two admins assigning at the same moment.
    if ((e as { code?: number }).code === 11000) throw conflict('This lesson already has a substitute, or that teacher was just assigned elsewhere in this period. Reload and try again.');
    throw e;
  }
  const [classroom, subject, sub2, orig] = await Promise.all([
    Classroom.findById(entry.classroomId).select('name').lean(), Subject.findById(entry.subjectId).select('name').lean(),
    User.findById(b.substituteTeacherId).select('fullName').lean(), entry.teacherId ? User.findById(entry.teacherId).select('fullName').lean() : null
  ]);
  const period = plan.periods.find((p) => p.key === entry.periodKey)!;
  const what = `${subject?.name ?? 'Lesson'} for ${classroom?.name ?? ''} on ${b.date}, ${period.label} (${period.start}–${period.end})`;
  const notification = await notify({
    sessionId: entry.sessionId, kind: 'substitution', date: b.date, refId: sub._id, actorId: req.user!.id,
    title: `Substitute teacher: ${what}`.slice(0, 160),
    body: `${sub2?.fullName ?? 'A substitute'} will teach ${what}${orig ? ` instead of ${orig.fullName}` : ''}.`,
    teacherIds: [b.substituteTeacherId, ...(entry.teacherId ? [entry.teacherId] : [])], classroomIds: [entry.classroomId],
    guardianKey: `substitution-${sub._id}`, guardianMessage: `${subject?.name ?? 'A lesson'} on ${b.date} (${period.label}) will be taught by ${sub2?.fullName ?? 'a substitute teacher'}.`
  });
  await audit(req, 'timetable.substitute_assigned', 'substitution', sub._id, { date: b.date, entryId: entry._id, original: entry.teacherId, substitute: b.substituteTeacherId, reason: b.reason ?? null });
  ok(res, { substitution: sub, notification }, undefined, 201);
}));

timetableRouter.post('/substitutions/:id/cancel', can('substitutes.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const sub = await Substitution.findOne({ _id: id, deletedAt: null }).lean();
  if (!sub) throw notFound();
  if (sub.status !== 'active') throw conflict('This substitution is already cancelled.');
  const doc = await updateVersioned(Substitution, id, { status: 'cancelled', cancelledAt: new Date(), cancelledBy: req.user!.id });
  const subject = await Subject.findById(sub.subjectId).select('name').lean();
  const notification = await notify({
    sessionId: sub.sessionId, kind: 'substitution_cancelled', date: sub.date, refId: id, actorId: req.user!.id,
    title: `Substitution cancelled: ${subject?.name ?? 'lesson'} on ${sub.date}`, body: 'The regular teacher will teach this lesson as normal.',
    teacherIds: [sub.substituteTeacherId, ...(sub.originalTeacherId ? [sub.originalTeacherId] : [])], classroomIds: [sub.classroomId],
    guardianKey: `substitution-cancel-${id}`, guardianMessage: `The substitute for ${subject?.name ?? 'a lesson'} on ${sub.date} was cancelled; the regular teacher will teach.`
  });
  await audit(req, 'timetable.substitute_cancelled', 'substitution', id, { date: sub.date });
  ok(res, { substitution: doc, notification });
}));

