import type { ClientSession } from 'mongoose';
import {
  WEEKDAY_NAMES, introducedConflicts, planForDate, validateTimetable, weekdayOf,
  type Conflict, type Namer, type TEntry, type TimetableConfigShape, type TRequirement, type TRoom, type TTeacher
} from '@sms/shared';
import {
  AcademicSession, Classroom, Holiday, Room, SchoolClass, Section, Student, Subject, SubjectRequirement, Substitution, TeacherProfile,
  TimetableConfig, TimetableEntry, TimetableMeta, TimetableNotice, User
} from '../models/index.js';
import { createVersioned, updateVersioned } from './repo.js';
import { enqueueStudentEvent } from './notifications.js';
import { logger } from '../utils/logger.js';
import { AppError, notFound } from '../utils/http.js';
import { $cmp, $in } from '../utils/query.js';

export type TState = 'draft' | 'published';

export async function sessionOr404(sessionId: string) {
  const s = await AcademicSession.findOne({ _id: sessionId, deletedAt: null }).lean();
  if (!s) throw notFound('Academic session not found');
  return s;
}

export function configShape(c: InstanceType<typeof TimetableConfig> | Record<string, unknown> | null): TimetableConfigShape | null {
  if (!c) return null;
  const x = c as unknown as TimetableConfigShape & { specialDays: { date: string; label: string; closed: boolean; periods?: TimetableConfigShape['periods'] | null }[] };
  return {
    workingDays: [...x.workingDays], dayStart: x.dayStart, dayEnd: x.dayEnd,
    periods: x.periods.map((p) => ({ key: p.key, label: p.label, start: p.start, end: p.end, kind: p.kind })),
    dayOverrides: (x.dayOverrides ?? []).map((o) => ({ day: o.day, periods: o.periods.map((p) => ({ key: p.key, label: p.label, start: p.start, end: p.end, kind: p.kind })) })),
    specialDays: (x.specialDays ?? []).map((s) => ({ date: s.date, label: s.label, closed: s.closed, periods: s.periods?.length ? s.periods.map((p) => ({ key: p.key, label: p.label, start: p.start, end: p.end, kind: p.kind })) : null })),
    defaultPeriodMinutes: x.defaultPeriodMinutes ?? 40,
    teacherMaxPerDay: x.teacherMaxPerDay ?? null, teacherMaxPerWeek: x.teacherMaxPerWeek ?? null,
    avoidConsecutiveSameSubject: x.avoidConsecutiveSameSubject ?? true
  };
}

export async function getConfig(sessionId: string) {
  const doc = await TimetableConfig.findOne({ sessionId, deletedAt: null }).lean();
  return { doc, shape: configShape(doc) };
}
export async function requireConfig(sessionId: string): Promise<TimetableConfigShape> {
  const { shape } = await getConfig(sessionId);
  if (!shape) throw new AppError(409, 'TIMETABLE_NOT_CONFIGURED', 'Set up the school timings and periods for this session first.');
  return shape;
}

/** Teachers who can be scheduled: active teacher accounts, plus any staff member with a scheduling profile. */
export async function teacherPool(sessionId: string) {
  const profiles = await TeacherProfile.find({ sessionId, deletedAt: null }).lean();
  const users = await User.find({
    status: 'active', deletedAt: null,
    $or: [{ role: 'teacher' }, { _id: $in(profiles.map((p) => p.teacherId)), role: $in(['principal', 'admin', 'staff', 'teacher']) }]
  }).select('fullName username role').sort({ fullName: 1 }).lean();
  return { users, profiles };
}

export function toTeachers(users: { _id: string }[], profiles: { teacherId: string; subjectIds: string[]; maxPerDay?: number | null; maxPerWeek?: number | null; unavailable: string[] }[]): TTeacher[] {
  return users.map((u) => {
    const p = profiles.find((x) => x.teacherId === u._id);
    return { id: u._id, subjectIds: p?.subjectIds ?? [], maxPerDay: p?.maxPerDay ?? null, maxPerWeek: p?.maxPerWeek ?? null, unavailable: p?.unavailable ?? [] };
  });
}

export const toEntry = (e: { _id: string; classroomId: string; day: number; periodKey: string; subjectId: string; teacherId?: string | null; roomId?: string | null; locked?: boolean }): TEntry =>
  ({ id: e._id, classroomId: e.classroomId, day: e.day, periodKey: e.periodKey, subjectId: e.subjectId, teacherId: e.teacherId ?? null, roomId: e.roomId ?? null, locked: Boolean(e.locked) });

/** Everything needed to validate or display a session's timetable. */
export async function loadContext(sessionId: string, state: TState, session?: ClientSession) {
  const [cfg, entries, rooms, subjects, reqs, pool, classrooms] = await Promise.all([
    getConfig(sessionId),
    TimetableEntry.find({ sessionId, state, deletedAt: null }).session(session ?? null).lean(),
    Room.find({ deletedAt: null }).sort({ name: 1 }).lean(),
    Subject.find({ deletedAt: null }).sort({ name: 1 }).lean(),
    SubjectRequirement.find({ sessionId, deletedAt: null }).lean(),
    teacherPool(sessionId),
    Classroom.find({ sessionId, deletedAt: null }).sort({ name: 1 }).lean()
  ]);
  const [classes, sections] = await Promise.all([
    SchoolClass.find({ _id: $in(classrooms.map((c) => c.classId)) }).select('name order').lean(),
    Section.find({ _id: $in(classrooms.map((c) => c.sectionId)) }).select('name').lean()
  ]);
  const teachers = toTeachers(pool.users, pool.profiles);
  const requirements: TRequirement[] = reqs.map((r) => ({ id: r._id, classroomId: r.classroomId, subjectId: r.subjectId, teacherId: r.teacherId ?? null, roomId: r.roomId ?? null, periodsPerWeek: r.periodsPerWeek, maxPerDay: r.maxPerDay ?? 2, allowDouble: Boolean(r.allowDouble) }));
  const tRooms: TRoom[] = rooms.map((r) => ({ id: r._id, unavailable: r.unavailable ?? [] }));
  const nameOf = <T extends { _id: string }>(list: T[], f: (x: T) => string) => (id: string) => { const x = list.find((y) => y._id === id); return x ? f(x) : 'Unknown'; };
  const shape = cfg.shape;
  const names: Namer = {
    classroom: nameOf(classrooms, (c) => c.name), teacher: nameOf(pool.users, (u) => u.fullName),
    room: nameOf(rooms, (r) => r.name), subject: nameOf(subjects, (s) => s.name),
    period: (day, key) => {
      const p = shape ? (shape.dayOverrides.find((o) => o.day === day)?.periods ?? shape.periods).find((x) => x.key === key) : undefined;
      return `${WEEKDAY_NAMES[day] ?? day} ${p ? `${p.label} (${p.start})` : key}`;
    }
  };
  return {
    config: shape, configDoc: cfg.doc, entries: entries.map(toEntry), rawEntries: entries, rooms, subjects, requirements, tRooms, teachers,
    teacherUsers: pool.users, profiles: pool.profiles, classrooms, classes, sections, names
  };
}
export type Ctx = Awaited<ReturnType<typeof loadContext>>;

export function validateCtx(ctx: Ctx, entries: TEntry[] = ctx.entries): Conflict[] {
  if (!ctx.config) return [];
  return validateTimetable({ config: ctx.config, entries, teachers: ctx.teachers, rooms: ctx.tRooms, requirements: ctx.requirements, names: ctx.names });
}

/**
 * Gate for every draft change: conflicts the change would INTRODUCE are checked against the current draft.
 * Hard conflicts are refused (409). Warnings need an explicit confirmation (422 until confirmed).
 */
export function assertChange(ctx: Ctx, after: TEntry[], confirmWarnings: boolean) {
  const added = introducedConflicts(validateCtx(ctx), validateCtx(ctx, after));
  const errors = added.filter((c) => c.severity === 'error');
  if (errors.length) throw new AppError(409, 'TIMETABLE_CONFLICT', errors[0]!.message, { conflicts: errors });
  const warnings = added.filter((c) => c.severity === 'warning');
  if (warnings.length && !confirmWarnings) throw new AppError(422, 'TIMETABLE_WARNINGS', 'This change needs confirmation.', { conflicts: warnings });
  return warnings;
}

/** References in a lesson must exist in THIS school and THIS session. Ids from anywhere else are refused. */
export function assertRefs(ctx: Ctx, e: { classroomId: string; subjectId: string; teacherId: string | null; roomId: string | null }) {
  const room = ctx.classrooms.find((c) => c._id === e.classroomId);
  if (!room || room.archived) throw notFound('Classroom not found in this session');
  const subject = ctx.subjects.find((s) => s._id === e.subjectId);
  if (!subject || subject.archived) throw notFound('Subject not found');
  if (e.teacherId && !ctx.teacherUsers.some((u) => u._id === e.teacherId)) throw notFound('Teacher not found (only active teachers can be scheduled)');
  if (e.roomId) { const r = ctx.rooms.find((x) => x._id === e.roomId); if (!r || r.archived) throw notFound('Room not found'); }
}

export async function ensureMeta(sessionId: string, session?: ClientSession) {
  const m = await TimetableMeta.findOne({ sessionId, deletedAt: null }).session(session ?? null).lean();
  if (m) return m;
  try {
    return (await createVersioned(TimetableMeta, { sessionId, status: 'empty' }, { session })).toObject();
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return (await TimetableMeta.findOne({ sessionId }).lean())!;
    throw e;
  }
}

/** Claims the draft for a change: fails with 409 if someone changed it since `expectedVersion`. */
export async function touchDraft(sessionId: string, expectedVersion: number, actorId: string, session?: ClientSession, extra: Record<string, unknown> = {}) {
  const meta = await ensureMeta(sessionId, session);
  const updated = await updateVersioned(TimetableMeta, meta._id, {
    draftUpdatedAt: new Date(), draftUpdatedBy: actorId, draftDirty: true,
    status: meta.status === 'published' ? 'published' : 'draft', ...extra
  }, { session }, expectedVersion);
  return updated.toObject() as typeof meta;
}

// ---------------------------------------------------------------- Notifications
async function activeStudentIds(classroomIds: string[]) {
  if (!classroomIds.length) return [];
  return (await Student.find({ classroomId: $in(classroomIds), status: 'active', deletedAt: null }).select('_id').lean()).map((s) => s._id);
}

export interface NotifyOutcome { notice: string | null; guardianMessages: { queued: number; skipped: number; reason: string | null } }

/**
 * In-app notice (always) plus guardian SMS / WhatsApp through the existing queue (only when the school
 * switched the "timetable" event on). Queued messages are reported as queued, never as sent.
 */
export async function notify(opts: {
  sessionId: string; kind: 'published' | 'changed' | 'substitution' | 'substitution_cancelled'; title: string; body: string; everyone?: boolean;
  teacherIds: string[]; classroomIds: string[]; date?: string | null; refId?: string | null; actorId?: string; guardianKey: string; guardianMessage: string;
}): Promise<NotifyOutcome> {
  const notice = await createVersioned(TimetableNotice, {
    sessionId: opts.sessionId, kind: opts.kind, title: opts.title.slice(0, 160), body: opts.body.slice(0, 2000), everyone: Boolean(opts.everyone),
    teacherIds: [...new Set(opts.teacherIds.filter(Boolean))], classroomIds: [...new Set(opts.classroomIds)], date: opts.date ?? null, refId: opts.refId ?? null, createdBy: opts.actorId
  });
  let guardianMessages: NotifyOutcome['guardianMessages'] = { queued: 0, skipped: 0, reason: null };
  try {
    const classroomIds = opts.everyone ? (await Classroom.find({ sessionId: opts.sessionId, deletedAt: null, archived: false }).select('_id').lean()).map((c) => c._id) : opts.classroomIds;
    guardianMessages = await enqueueStudentEvent({
      event: 'timetable', studentIds: await activeStudentIds(classroomIds), key: opts.guardianKey, refId: opts.refId ?? notice._id, actorId: opts.actorId,
      vars: () => ({ message: opts.guardianMessage, title: opts.title })
    });
  } catch (err) {
    logger.error({ err }, 'timetable guardian notification failed');
    guardianMessages = { queued: 0, skipped: 0, reason: 'error' };
  }
  return { notice: notice._id, guardianMessages };
}

// ---------------------------------------------------------------- Portals
/** Published timetable of one classroom, ready for display (names resolved; no internal fields). */
export async function classroomTimetable(classroomId: string, date?: string) {
  const room = await Classroom.findOne({ _id: classroomId, deletedAt: null }).lean();
  if (!room) throw notFound();
  const sessionId = room.sessionId;
  const [{ shape }, entries, meta] = await Promise.all([
    getConfig(sessionId),
    TimetableEntry.find({ sessionId, state: 'published', classroomId, deletedAt: null }).lean(),
    TimetableMeta.findOne({ sessionId, deletedAt: null }).lean()
  ]);
  const [subjects, teachers, rooms] = await Promise.all([
    Subject.find({ _id: $in(entries.map((e) => e.subjectId)) }).select('name code color').lean(),
    User.find({ _id: $in(entries.map((e) => e.teacherId).filter((x): x is string => Boolean(x))) }).select('fullName').lean(),
    Room.find({ _id: $in(entries.map((e) => e.roomId).filter((x): x is string => Boolean(x))) }).select('name').lean()
  ]);
  // Substitutions for the coming week, so families see who is covering a lesson.
  const from = date ?? new Date().toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${from}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const subs = await Substitution.find({ classroomId, status: 'active', deletedAt: null, date: $cmp({ gte: from, lte: to }) }).lean();
  const subTeachers = await User.find({ _id: $in(subs.map((s) => s.substituteTeacherId)) }).select('fullName').lean();
  const holidays = await Holiday.find({ deletedAt: null, date: $cmp({ lte: to }) }).lean();
  return {
    classroom: { _id: room._id, name: room.name, room: room.room ?? null },
    published: meta?.status === 'published',
    publishedAt: meta?.publishedAt ?? null,
    config: shape,
    lessons: entries.map((e) => ({
      _id: e._id, day: e.day, periodKey: e.periodKey,
      subject: subjects.find((s) => s._id === e.subjectId)?.name ?? '', subjectColor: subjects.find((s) => s._id === e.subjectId)?.color ?? null,
      teacher: teachers.find((t) => t._id === e.teacherId)?.fullName ?? null, room: rooms.find((r) => r._id === e.roomId)?.name ?? room.room ?? null
    })),
    substitutions: subs.map((s) => ({ date: s.date, periodKey: s.periodKey, entryId: s.entryId, teacher: subTeachers.find((t) => t._id === s.substituteTeacherId)?.fullName ?? '' })),
    plans: shape ? Array.from({ length: 7 }, (_, i) => planForDate(shape, new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), holidays)) : []
  };
}

export async function noticesFor(filter: { teacherId?: string; classroomIds?: string[] }, limit = 20) {
  const or: Record<string, unknown>[] = [{ everyone: true }];
  if (filter.teacherId) or.push({ teacherIds: filter.teacherId });
  if (filter.classroomIds?.length) or.push({ classroomIds: $in(filter.classroomIds) });
  return TimetableNotice.find({ deletedAt: null, $or: or }).sort({ createdAt: -1 }).limit(limit).select('kind title body date createdAt').lean();
}

export { planForDate, weekdayOf };
