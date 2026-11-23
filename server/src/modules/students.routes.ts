import { Router } from 'express';
import { z } from 'zod';
import {
  paginationSchema, studentSchema, studentUpdateSchema, transferSchema, bulkPromoteSchema,
  matchDuplicate, normalizeName, STUDENT_STATUSES, countStatuses, attendancePercent, type AttendanceStatus
} from '@sms/shared';
import { AttendanceRecord, Classroom, Guardian, Student, StudentGuardian, StudentHistory, SchoolClass, Section } from '../models/index.js';
import { can, canAny } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { assertClassroomAccess, classroomScopeFilter } from '../services/access.js';
import { createVersioned, softDeleteVersioned, updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { memoryUpload, removeUpload, saveImage } from '../services/uploads.js';
import { readTable, toCsv, toXlsx } from '../services/spreadsheet.js';
import { withTransaction } from '../config/db.js';
import { badRequest, conflict, escapeRegex, h, notFound, ok, pageArgs, parse, phoneSearchRegex, sortArg } from '../utils/http.js';
import { $in, $ne } from '../utils/query.js';

export const studentsRouter = Router();
const idParam = (v: unknown) => z.string().uuid().parse(v);

/** Custom field values may only use keys the school defined in Settings (empty values are dropped). */
async function customFieldValues(values: Record<string, string> | undefined) {
  if (!values) return undefined;
  const allowed = new Set(((await getSettings()).studentCustomFields ?? []).map((f) => f.key));
  const unknown = Object.keys(values).filter((k) => !allowed.has(k));
  if (unknown.length) throw badRequest(`Unknown custom field(s): ${unknown.join(', ')}`);
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
}

async function classroomPlacement(classroomId: string) {
  const c = await Classroom.findOne({ _id: classroomId, deletedAt: null, archived: false }).lean();
  if (!c) throw badRequest('Classroom not found or archived');
  return { classroomId: c._id, classId: c.classId, sectionId: c.sectionId, sessionId: c.sessionId };
}

async function findDuplicates(input: { admissionNumber?: string; fullName: string; dateOfBirth?: string | null }, excludeId?: string) {
  const candidates = await Student.find({
    deletedAt: null, _id: $ne(excludeId ?? ''),
    $or: [{ admissionNumberLower: input.admissionNumber?.toLowerCase() ?? '__none__' }, { nameNormalized: normalizeName(input.fullName) }]
  }).limit(20).lean();
  return candidates
    .map((c) => ({ student: { _id: c._id, fullName: c.fullName, admissionNumber: c.admissionNumber, classroomId: c.classroomId, status: c.status }, match: matchDuplicate(input, { ...c, guardianPhone: c.primaryGuardianPhone }) }))
    .filter((x) => x.match);
}

studentsRouter.get('/', canAny('students.view'), h(async (req, res) => {
  const q = parse(paginationSchema.extend({
    classroomId: z.string().uuid().optional(), classId: z.string().uuid().optional(), sectionId: z.string().uuid().optional(),
    status: z.enum(STUDENT_STATUSES).optional(), gender: z.string().optional()
  }), req.query);
  const filter: Record<string, unknown> = { deletedAt: null, ...(await classroomScopeFilter(req.user!)) };
  if (q.classroomId) {
    await assertClassroomAccess(req.user!, q.classroomId);
    filter.classroomId = q.classroomId;
  }
  if (q.classId) filter.classId = q.classId;
  if (q.sectionId) filter.sectionId = q.sectionId;
  filter.status = q.status ?? 'active';
  if (q.gender) filter.gender = q.gender;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    const phoneRx = phoneSearchRegex(q.q);
    filter.$or = [{ fullName: rx }, { admissionNumber: rx }, ...(phoneRx ? [{ primaryGuardianPhone: phoneRx }] : [])];
  }
  const { skip, limit } = pageArgs(q);
  const [items, total] = await Promise.all([
    Student.find(filter).sort(sortArg(q.sort, ['fullName', 'admissionNumber', 'admissionDate', 'createdAt'], { fullName: 1 })).skip(skip).limit(limit).lean(),
    Student.countDocuments(filter)
  ]);
  const rooms = await Classroom.find({ _id: $in([...new Set(items.map((s) => s.classroomId))]) }).select('name').lean();
  ok(res, items.map((s) => ({ ...s, classroomName: rooms.find((r) => r._id === s.classroomId)?.name })), { page: q.page, pageSize: q.pageSize, total });
}));

studentsRouter.get('/:id', can('students.view'), h(async (req, res) => {
  const s = await Student.findOne({ _id: idParam(req.params.id), deletedAt: null }).lean();
  if (!s) throw notFound();
  await assertClassroomAccess(req.user!, s.classroomId);
  const settings = await getSettings();
  const [history, recent, statusAgg, links, room] = await Promise.all([
    StudentHistory.find({ studentId: s._id }).sort({ at: -1 }).limit(100).lean(),
    AttendanceRecord.find({ studentId: s._id, deletedAt: null }).sort({ date: -1 }).limit(60).lean(),
    AttendanceRecord.aggregate<{ _id: AttendanceStatus; n: number }>([{ $match: { studentId: s._id, deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    req.user!.permissions.includes('guardians.view') ? StudentGuardian.find({ studentId: s._id, deletedAt: null }).lean() : Promise.resolve([]),
    Classroom.findById(s.classroomId).select('name').lean()
  ]);
  const counts = countStatuses([]);
  for (const a of statusAgg) { counts[a._id] = a.n; counts.total += a.n; }
  const guardians = links.length ? await Guardian.find({ _id: $in(links.map((l) => l.guardianId)), deletedAt: null }).lean() : [];
  ok(res, {
    ...s, classroomName: room?.name,
    history, recentAttendance: recent,
    attendanceSummary: { ...counts, percent: attendancePercent(counts, settings.policy) },
    guardians: guardians.map((g) => ({ ...g, link: links.find((l) => l.guardianId === g._id) }))
  });
}));

studentsRouter.post('/check-duplicates', can('students.manage'), h(async (req, res) => {
  const b = parse(z.object({ admissionNumber: z.string().optional(), fullName: z.string().min(1), dateOfBirth: z.string().optional().nullable() }), req.body);
  ok(res, await findDuplicates(b));
}));

studentsRouter.post('/', can('students.manage'), h(async (req, res) => {
  const b = parse(studentSchema, req.body);
  b.customFields = await customFieldValues(b.customFields);
  const dups = await findDuplicates(b);
  if (dups.some((d) => d.match?.level === 'exact')) throw conflict('Admission number already exists', dups);
  if (dups.length && !b.confirmDuplicate) throw conflict('Possible duplicate student. Confirm to continue.', dups);
  const placement = await classroomPlacement(b.classroomId);
  const { confirmDuplicate: _c, classroomId: _r, ...data } = b;
  const student = await withTransaction(async (session) => {
    const doc = await createVersioned(Student, {
      ...data, ...placement,
      admissionNumberLower: b.admissionNumber.toLowerCase(), nameNormalized: normalizeName(b.fullName), status: 'active'
    }, { session });
    await createVersioned(StudentHistory, { studentId: doc._id, kind: 'created', to: placement, by: req.user!.id, at: new Date() }, { session });
    return doc;
  });
  await audit(req, 'student.created', 'student', student._id);
  ok(res, student, undefined, 201);
}));

studentsRouter.patch('/:id', can('students.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(studentUpdateSchema.extend({ version: z.number().int().optional() }), req.body);
  if (b.customFields) b.customFields = await customFieldValues(b.customFields);
  const current = await Student.findOne({ _id: id, deletedAt: null }).lean();
  if (!current) throw notFound();
  const { version, confirmDuplicate, ...patch } = b;
  const extra: Record<string, unknown> = {};
  if (patch.admissionNumber && patch.admissionNumber !== current.admissionNumber) {
    if (await Student.exists({ admissionNumberLower: patch.admissionNumber.toLowerCase(), _id: $ne(id) })) throw conflict('Admission number already exists');
    extra.admissionNumberLower = patch.admissionNumber.toLowerCase();
  }
  if (patch.fullName) {
    extra.nameNormalized = normalizeName(patch.fullName);
    const dups = (await findDuplicates({ fullName: patch.fullName, dateOfBirth: patch.dateOfBirth ?? current.dateOfBirth }, id)).filter((d) => d.match?.level === 'likely');
    if (dups.length && !confirmDuplicate && normalizeName(patch.fullName) !== current.nameNormalized) throw conflict('Possible duplicate student. Confirm to continue.', dups);
  }
  const updated = await updateVersioned(Student, id, { ...patch, ...extra }, {}, version);
  if (patch.status && patch.status !== current.status) {
    await createVersioned(StudentHistory, { studentId: id, kind: patch.status === 'archived' ? 'archived' : current.status === 'archived' ? 'restored' : 'status_change', from: current.status, to: patch.status, by: req.user!.id, at: new Date() });
  }
  await audit(req, 'student.updated', 'student', id, { changed: Object.keys(patch) });
  ok(res, updated);
}));

/** Transfer / promotion / section change. Attendance history stays attached to the old classroom. */
studentsRouter.post('/:id/move', can('students.manage'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const b = parse(transferSchema, req.body);
  const s = await Student.findOne({ _id: id, deletedAt: null }).lean();
  if (!s) throw notFound();
  if (s.classroomId === b.classroomId) throw badRequest('Student is already in this classroom');
  const placement = await classroomPlacement(b.classroomId);
  await withTransaction(async (session) => {
    await updateVersioned(Student, id, placement, { session });
    await createVersioned(StudentHistory, { studentId: id, kind: b.kind, from: { classroomId: s.classroomId, classId: s.classId, sectionId: s.sectionId }, to: placement, reason: b.reason, by: req.user!.id, at: new Date() }, { session });
  });
  await audit(req, `student.${b.kind}`, 'student', id, { from: s.classroomId, to: b.classroomId });
  ok(res, { moved: true });
}));

studentsRouter.post('/bulk-promote', can('students.manage'), h(async (req, res) => {
  const b = parse(bulkPromoteSchema, req.body);
  if (b.fromClassroomId === b.toClassroomId) throw badRequest('Choose a different destination classroom');
  const placement = await classroomPlacement(b.toClassroomId);
  const students = await Student.find({ _id: $in(b.studentIds), classroomId: b.fromClassroomId, deletedAt: null, status: 'active' }).lean();
  let moved = 0;
  for (const s of students) {
    await withTransaction(async (session) => {
      await updateVersioned(Student, s._id, placement, { session });
      await createVersioned(StudentHistory, { studentId: s._id, kind: 'promotion', from: { classroomId: s.classroomId }, to: placement, reason: b.reason, by: req.user!.id, at: new Date() }, { session });
    });
    moved++;
  }
  await audit(req, 'student.bulk_promotion', 'classroom', b.fromClassroomId, { to: b.toClassroomId, moved });
  ok(res, { moved, skipped: b.studentIds.length - moved });
}));

/** Authorised deletion is a soft delete: the student disappears from lists; attendance history is kept. */
studentsRouter.delete('/:id', can('students.delete'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const { reason } = parse(z.object({ reason: z.string().min(3).max(300) }), req.body ?? {});
  await softDeleteVersioned(Student, id);
  await audit(req, 'student.deleted', 'student', id, { reason });
  ok(res, { deleted: true });
}));

const photoUpload = memoryUpload(3 * 1024 * 1024);
studentsRouter.post('/:id/photo', can('students.manage'), photoUpload.single('file'), h(async (req, res) => {
  const id = idParam(req.params.id);
  if (!req.file) throw badRequest('No file uploaded');
  const s = await Student.findById(id).lean();
  if (!s) throw notFound();
  const p = await saveImage(req.file.buffer, 'students');
  await removeUpload(s.photoPath);
  await updateVersioned(Student, id, { photoPath: p });
  ok(res, { path: p });
}));

// ------------------------------------------------------------------ Import
/**
 * Two-step import. dryRun=true validates every row and returns a per-row error report without
 * writing anything. dryRun=false imports only the valid rows.
 * Columns: admissionNumber, fullName, dateOfBirth, gender, class, section, admissionDate,
 *          emergencyContactName, emergencyContactPhone, parentName, whatsappNumber, address
 */
const importUpload = memoryUpload(5 * 1024 * 1024);
/** Excel stores 03001234567 as a number and drops the leading 0; put it back for Pakistani mobiles. */
const excelMobile = (v?: string) => { const d = (v ?? '').replace(/[\s-]/g, ''); return /^3\d{9}$/.test(d) ? '0' + d : (v ?? '').trim(); };
studentsRouter.post('/import', can('students.import'), importUpload.single('file'), h(async (req, res) => {
  if (!req.file) throw badRequest('No file uploaded');
  if (!/\.(csv|xlsx)$/i.test(req.file.originalname)) throw badRequest('Upload a .csv or .xlsx file');
  const dryRun = req.query.dryRun !== 'false';
  const sessionId = z.string().uuid().parse(req.query.sessionId ?? (await getSettings()).defaultSessionId);
  const rows = await readTable(req.file.buffer, req.file.originalname);
  if (rows.length > 5000) throw badRequest('Maximum 5000 rows per import');
  const [classes, sections, rooms] = await Promise.all([
    SchoolClass.find({ deletedAt: null }).lean(), Section.find({ deletedAt: null }).lean(), Classroom.find({ sessionId, deletedAt: null, archived: false }).lean()
  ]);
  const seen = new Set<string>();
  const report: { row: number; admissionNumber?: string; errors: string[]; warnings: string[] }[] = [];
  const valid: Record<string, unknown>[] = [];
  for (const [i, r] of rows.entries()) {
    const errors: string[] = []; const warnings: string[] = [];
    const cls = classes.find((c) => c.name.toLowerCase() === (r.class ?? '').toLowerCase());
    const sec = cls && sections.find((s) => s.classId === cls._id && s.name.toLowerCase() === (r.section ?? '').toLowerCase());
    const room = sec && rooms.find((x) => x.classId === cls!._id && x.sectionId === sec._id);
    if (!cls) errors.push(`Unknown class "${r.class ?? ''}"`);
    else if (!sec) errors.push(`Unknown section "${r.section ?? ''}" for class ${cls.name}`);
    else if (!room) errors.push(`No classroom for ${cls.name}-${sec.name} in the selected session`);
    const parsed = studentSchema.safeParse({
      admissionNumber: r.admissionNumber, fullName: r.fullName, dateOfBirth: r.dateOfBirth || null,
      gender: (r.gender || 'unspecified').toLowerCase(), classroomId: room?._id ?? '00000000-0000-4000-8000-000000000000',
      admissionDate: r.admissionDate || null, emergencyContactName: r.emergencyContactName || null,
      emergencyContactPhone: r.emergencyContactPhone || null, parentName: r.parentName || null, whatsappNumber: excelMobile(r.whatsappNumber) || null, address: r.address || null
    });
    if (!parsed.success) for (const [f, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) errors.push(`${f}: ${((msgs as string[] | undefined) ?? []).join(', ')}`);
    const adm = (r.admissionNumber ?? '').toLowerCase();
    if (adm && seen.has(adm)) errors.push('Admission number repeated in this file');
    seen.add(adm);
    if (parsed.success && !errors.length) {
      const dups = await findDuplicates(parsed.data);
      if (dups.some((d) => d.match?.level === 'exact')) errors.push('Admission number already exists');
      else if (dups.length) warnings.push(`Possible duplicate of ${dups.map((d) => d.student.fullName + ' (' + d.student.admissionNumber + ')').join(', ')} — imported anyway`);
    }
    report.push({ row: i + 2, admissionNumber: r.admissionNumber, errors, warnings });
    if (!errors.length && parsed.success) valid.push({ ...parsed.data, ...(await classroomPlacement(room!._id)) });
  }
  let imported = 0;
  if (!dryRun) {
    for (const v of valid) {
      const { confirmDuplicate: _c, ...data } = v as Record<string, unknown> & { admissionNumber: string; fullName: string };
      const doc = await createVersioned(Student, { ...data, admissionNumberLower: data.admissionNumber.toLowerCase(), nameNormalized: normalizeName(data.fullName), status: 'active' });
      await createVersioned(StudentHistory, { studentId: doc._id, kind: 'created', to: { classroomId: data.classroomId }, reason: 'import', by: req.user!.id, at: new Date() });
      imported++;
    }
    await audit(req, 'student.imported', 'student', undefined, { imported, rows: rows.length });
  }
  ok(res, { dryRun, totalRows: rows.length, validRows: valid.length, invalidRows: rows.length - valid.length, imported, report: report.filter((r) => r.errors.length || r.warnings.length) });
}));

studentsRouter.get('/export/file', can('students.view'), h(async (req, res) => {
  const format = z.enum(['csv', 'xlsx']).parse(req.query.format ?? 'xlsx');
  const filter: Record<string, unknown> = { deletedAt: null, ...(await classroomScopeFilter(req.user!)) };
  if (req.query.classroomId) filter.classroomId = z.string().uuid().parse(req.query.classroomId);
  filter.status = z.enum(STUDENT_STATUSES).parse(req.query.status ?? 'active');
  const students = await Student.find(filter).sort({ fullName: 1 }).limit(20000).lean();
  const rooms = await Classroom.find({ _id: $in([...new Set(students.map((s) => s.classroomId))]) }).lean();
  const rows = students.map((s) => ({ ...s, classroom: rooms.find((r) => r._id === s.classroomId)?.name }));
  const cols = [
    { header: 'Admission No', key: 'admissionNumber' }, { header: 'Full name', key: 'fullName', width: 28 }, { header: 'Classroom', key: 'classroom' },
    { header: 'Date of birth', key: 'dateOfBirth' }, { header: 'Gender', key: 'gender' }, { header: 'Admission date', key: 'admissionDate' },
    { header: 'Status', key: 'status' }, { header: 'Emergency contact', key: 'emergencyContactName' }, { header: 'Emergency phone', key: 'emergencyContactPhone' },
    { header: 'Parent name', key: 'parentName' }, { header: 'Parent WhatsApp', key: 'whatsappNumber' },
    { header: 'Address', key: 'address', width: 30 }
  ];
  await audit(req, 'student.exported', 'student', undefined, { count: rows.length, format });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
    return res.send(toCsv(cols, rows));
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="students.xlsx"');
  res.send(await toXlsx('Students', cols, rows));
}));

studentsRouter.get('/import/template', can('students.import'), h(async (_req, res) => {
  const cols = ['admissionNumber', 'fullName', 'dateOfBirth', 'gender', 'class', 'section', 'admissionDate', 'emergencyContactName', 'emergencyContactPhone', 'parentName', 'whatsappNumber', 'address'].map((k) => ({ header: k, key: k }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  res.send(toCsv(cols, []));
}));
