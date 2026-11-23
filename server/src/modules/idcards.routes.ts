import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, isTest } from '../config/env.js';
import { AcademicSession, Classroom, SchoolClass, Section, Student } from '../models/index.js';
import { can, requireFeature } from '../middleware/auth.js';
import { randomToken } from '../security/crypto.js';
import { audit } from '../services/audit.js';
import { renderIdCardsPdf, type IdCardInput } from '../services/documents.js';
import { updateVersioned } from '../services/repo.js';
import { getSettings } from '../services/settings.js';
import { h, notFound, ok, parse } from '../utils/http.js';
import { $in } from '../utils/query.js';

/**
 * Student ID cards. The QR code encodes `${APP_URL}/verify/<token>` where the token is 192 random
 * bits stored on the student (idCardToken). It is not derived from the student id or admission
 * number, so card URLs cannot be guessed or enumerated; rotating the token revokes old cards.
 */
export const idCardsRouter = Router();
idCardsRouter.use(requireFeature('id_cards'));

const TOKEN_RX = /^[A-Za-z0-9_-]{32}$/;
export const verifyUrl = (token: string) => `${env.APP_URL}/verify/${token}`;

async function ensureToken(studentId: string, rotate = false): Promise<string> {
  const st = await Student.findById(studentId).select('idCardToken').lean();
  if (!st) throw notFound('Student not found');
  if (st.idCardToken && !rotate) return st.idCardToken;
  const token = randomToken(24); // 24 bytes → 32 base64url chars
  await updateVersioned(Student, studentId, { idCardToken: token, idCardIssuedAt: new Date() });
  return token;
}

export async function cardInputs(studentIds: string[]): Promise<IdCardInput[]> {
  const students = await Student.find({ _id: $in(studentIds), deletedAt: null }).sort({ fullName: 1 }).lean();
  const rooms = await Classroom.find({ _id: $in(students.map((s) => s.classroomId)) }).lean();
  const [classes, sections, sessions] = await Promise.all([
    SchoolClass.find({ _id: $in(rooms.map((r) => r.classId)) }).select('name').lean(),
    Section.find({ _id: $in(rooms.map((r) => r.sectionId)) }).select('name').lean(),
    AcademicSession.find({ _id: $in(rooms.map((r) => r.sessionId)) }).select('name endDate').lean()
  ]);
  const out: IdCardInput[] = [];
  for (const s of students) {
    const room = rooms.find((r) => r._id === s.classroomId);
    const sess = sessions.find((x) => x._id === room?.sessionId);
    out.push({
      fullName: s.fullName, admissionNumber: s.admissionNumber,
      className: classes.find((c) => c._id === room?.classId)?.name ?? room?.name ?? '',
      sectionName: sections.find((c) => c._id === room?.sectionId)?.name,
      sessionName: sess?.name, validUntil: sess?.endDate ?? null,
      photoPath: s.photoPath, verifyUrl: verifyUrl(await ensureToken(s._id))
    });
  }
  return out;
}

const layoutQ = z.object({ layout: z.enum(['sheet', 'card']).default('sheet') });

function sendPdf(res: import('express').Response, pdf: Buffer, name: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

idCardsRouter.get('/students/:id', can('idcards.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { layout } = parse(layoutQ, req.query);
  const cards = await cardInputs([id]);
  if (!cards.length) throw notFound('Student not found');
  await audit(req, 'idcard.generated', 'student', id);
  sendPdf(res, await renderIdCardsPdf(cards, await getSettings(), layout), `id-card-${cards[0]!.admissionNumber}.pdf`);
}));

idCardsRouter.get('/classrooms/:id', can('idcards.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { layout } = parse(layoutQ, req.query);
  const room = await Classroom.findOne({ _id: id, deletedAt: null }).select('name').lean();
  if (!room) throw notFound('Classroom not found');
  const ids = (await Student.find({ classroomId: id, status: 'active', deletedAt: null }).select('_id').lean()).map((s) => s._id);
  await audit(req, 'idcard.bulk_generated', 'classroom', id, { count: ids.length });
  sendPdf(res, await renderIdCardsPdf(await cardInputs(ids), await getSettings(), layout), `id-cards-${room.name}.pdf`);
}));

/** Issues a new token: every previously printed card for this student stops verifying. */
idCardsRouter.post('/students/:id/rotate', can('idcards.manage'), h(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  if (!(await Student.exists({ _id: id, deletedAt: null }))) throw notFound();
  await ensureToken(id, true);
  await audit(req, 'idcard.revoked_and_reissued', 'student', id);
  ok(res, { rotated: true });
}));

// ------------------------------------------------------------------ Public verification
export const verifyRouter = Router();
const verifyLimiter = rateLimit({ windowMs: 60_000, limit: isTest ? 10_000 : 30, standardHeaders: 'draft-7', legacyHeaders: false });

/**
 * Minimal, approved disclosure only: school name, student name, class, whether enrolment is
 * current and when the card was issued. No photo, date of birth, admission number, contact or
 * guardian information is ever returned to an anonymous caller.
 */
/** Result of checking a card token (shared by the JSON API and the server-rendered page). */
export interface CardCheck { valid: boolean; schoolName: string; logoPath: string | null; student?: { fullName: string; className: string; enrolled: boolean }; issuedAt?: Date | null }

export async function checkCard(token: string): Promise<CardCheck> {
  const s = await getSettings();
  const st = TOKEN_RX.test(token) ? await Student.findOne({ idCardToken: token, deletedAt: null }).select('fullName classroomId status idCardIssuedAt').lean() : null;
  if (!st) return { valid: false, schoolName: s.name, logoPath: s.logoPath ?? null };
  const room = await Classroom.findById(st.classroomId).select('classId sectionId').lean();
  const [cls, sec] = await Promise.all([room ? SchoolClass.findById(room.classId).select('name').lean() : null, room ? Section.findById(room.sectionId).select('name').lean() : null]);
  return {
    valid: st.status === 'active', schoolName: s.name, logoPath: s.logoPath ?? null,
    student: { fullName: st.fullName, className: [cls?.name, sec?.name].filter(Boolean).join(' · '), enrolled: st.status === 'active' },
    issuedAt: st.idCardIssuedAt ?? null
  };
}

verifyRouter.get('/:token', verifyLimiter, h(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const { logoPath: _logo, ...r } = await checkCard(String(req.params.token ?? ''));
  if (!r.student) return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'This card could not be verified.' }, data: { valid: false, schoolName: r.schoolName } });
  ok(res, r);
}));

/**
 * The same check as a complete HTML page at /verify/<token>. Mounted when this server does not also
 * serve the web app (e.g. the API runs as its own service), so a scanned QR code always shows a result
 * — including cards already printed with this server's address.
 */
export const verifyPageRouter = Router();
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const TONES = {
  ok: { bg: '#ecfdf3', line: '#a7f3d0', fg: '#065f46', icon: '✓', en: 'Valid student card', ur: 'یہ کارڈ درست ہے' },
  warn: { bg: '#fffbeb', line: '#fde68a', fg: '#92400e', icon: '!', en: 'This student is not currently enrolled', ur: 'یہ طالب علم اس وقت داخل نہیں ہے' },
  bad: { bg: '#fef2f2', line: '#fecaca', fg: '#991b1b', icon: '✕', en: 'This card could not be verified', ur: 'اس کارڈ کی تصدیق نہیں ہو سکی' }
} as const;

verifyPageRouter.get('/:token', verifyLimiter, h(async (req, res) => {
  const r = await checkCard(String(req.params.token ?? ''));
  const s = await getSettings();
  const brand = /^#[0-9a-f]{6}$/i.test(s.primaryColor ?? '') ? s.primaryColor : '#1c1f5e';
  const tone = TONES[r.valid ? 'ok' : r.student ? 'warn' : 'bad'];
  const logo = r.logoPath && /^\/(uploads|brand)\//.test(r.logoPath)
    ? `<img src="${esc(r.logoPath)}" alt="" width="76" height="76" style="border-radius:50%;background:#fff;object-fit:contain;box-shadow:0 0 0 4px #fff,0 0 0 6px ${brand}33">`
    : '';
  const row = (k: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid ${tone.line}"><span style="opacity:.75">${k}</span><strong style="text-align:end">${esc(v)}</strong></div>`;
  const details = r.student
    ? row('Name', r.student.fullName) + row('Class', r.student.className || '-') + row('Enrolled', r.student.enrolled ? 'Yes' : 'No') + (r.issuedAt ? row('Card issued', r.issuedAt.toISOString().slice(0, 10)) : '')
    : '';
  res.status(r.student ? 200 : 404);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Card verification - ${esc(r.schoolName)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#12153d;padding:24px;box-sizing:border-box">
<main style="width:100%;max-width:380px;text-align:center">${logo}
<h1 style="font-size:20px;margin:14px 0 4px;color:${brand}">${esc(r.schoolName)}</h1>
<p style="margin:0 0 20px;color:#4a5070;font-size:14px">Student ID card verification</p>
<section role="status" style="background:${tone.bg};border:1px solid ${tone.line};color:${tone.fg};border-radius:18px;padding:22px;text-align:start">
<div style="text-align:center"><div style="width:56px;height:56px;margin:0 auto;border-radius:50%;background:${tone.fg};color:#fff;font-size:30px;line-height:56px;font-weight:700">${tone.icon}</div>
<p style="font-size:18px;font-weight:700;margin:12px 0 2px">${tone.en}</p><p style="margin:0 0 12px;font-size:15px" dir="rtl">${tone.ur}</p></div>${details}</section>
</main></body></html>`);
}));
