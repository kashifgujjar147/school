/**
 * End-to-end API workflows: request -> validation -> service -> database -> response, then the data is
 * read back to prove it persisted. Covers every endpoint not exercised by the other suites, with
 * permission and invalid-input cases alongside the successful path.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, PW, type World } from './helpers.js';
import { env } from '../src/config/env.js';
import {
  AttendanceRecord, BackupRecord, Classroom, Guardian, Holiday, LoginHistory, NotificationJob, NotificationLog, PasswordResetRequest,
  SchoolClass, SchoolSettings, Section, Session, Student, StudentGuardian, StudentHistory, TeacherAssignment, User
} from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });
const envSnapshot = { ...env };
afterEach(() => { Object.assign(env, envSnapshot); invalidateSettings(); });

/** Smallest buffer the upload sniffer accepts as PNG (magic bytes + 4 bytes). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

async function submitToday(statuses = ['present', 'absent', 'late']) {
  const t = await login(w.app, 'teacher1');
  const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: w.studentIds.map((id, i) => ({ studentId: id, status: statuses[i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
  expect(r.status).toBe(201);
  return r.body.data.sheet as { _id: string };
}

describe('academic structure', () => {
  it('classes and sections: create, rename, reorder, archive; teachers cannot', async () => {
    const p = await login(w.app, 'principal');
    const cls = (await p.get('/api/academic/classes')).body.data[0];
    expect((await p.patch(`/api/academic/classes/${cls._id}`, { name: 'Grade Five', order: 7 })).status).toBe(200);
    const sec = await p.post('/api/academic/sections', { classId: cls._id, name: 'C' });
    expect(sec.status).toBe(201);
    expect((await p.post('/api/academic/sections', { classId: cls._id, name: 'C' })).status).toBe(409); // unique per class
    expect((await p.post('/api/academic/sections', { classId: uuid(), name: 'D' })).status).toBe(400);
    expect((await p.patch(`/api/academic/sections/${sec.body.data._id}`, { name: 'C1', archived: true })).status).toBe(200);
    const after = (await p.get('/api/academic/classes')).body.data[0];
    expect(after).toMatchObject({ name: 'Grade Five', order: 7 });
    expect(after.sections.find((s: { _id: string }) => s._id === sec.body.data._id)).toMatchObject({ name: 'C1', archived: true });
    const t = await login(w.app, 'teacher1');
    expect((await t.patch(`/api/academic/classes/${cls._id}`, { name: 'X' })).status).toBe(403);
  });

  it('holidays: add, list by year, delete', async () => {
    const p = await login(w.app, 'principal');
    const h = await p.post('/api/academic/holidays', { date: '2026-12-25', name: 'Winter break', endDate: '2026-12-31' });
    expect(h.status).toBe(201);
    expect((await p.post('/api/academic/holidays', { date: '2026-12-25', endDate: '2026-12-01', name: 'Bad' })).status).toBe(400);
    expect((await p.get('/api/academic/holidays?year=2026')).body.data).toHaveLength(1);
    expect((await p.del(`/api/academic/holidays/${h.body.data._id}`)).status).toBe(200);
    expect((await p.get('/api/academic/holidays?year=2026')).body.data).toHaveLength(0);
    expect((await Holiday.findById(h.body.data._id).lean())!.deletedAt).toBeTruthy(); // soft delete keeps the record
  });

  it('classrooms: edit, archive refused while students are active, archive + restore an empty one', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch(`/api/academic/classrooms/${w.classroomId}`, { room: 'R-12', capacity: 40 })).status).toBe(200);
    expect((await Classroom.findById(w.classroomId).lean())).toMatchObject({ room: 'R-12', capacity: 40 });
    const busy = await p.patch(`/api/academic/classrooms/${w.classroomId}`, { archived: true });
    expect(busy.status).toBe(409);
    expect((await p.patch(`/api/academic/classrooms/${w.otherClassroomId}`, { archived: true })).status).toBe(200);
    expect((await p.get('/api/academic/classrooms')).body.data.map((r: { _id: string }) => r._id)).not.toContain(w.otherClassroomId);
    expect((await p.patch(`/api/academic/classrooms/${w.otherClassroomId}`, { archived: false })).status).toBe(200);
    expect((await p.get('/api/academic/classrooms')).body.data).toHaveLength(2);
  });

  it('teacher assignments: list, assign, refuse duplicates and non-teachers, end (history kept)', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.get(`/api/academic/assignments?classroomId=${w.classroomId}`)).body.data).toHaveLength(1);
    const a = await p.post('/api/academic/assignments', { teacherId: w.otherTeacher, classroomId: w.classroomId, isHomeroom: true });
    expect(a.status).toBe(201);
    expect((await p.post('/api/academic/assignments', { teacherId: w.otherTeacher, classroomId: w.classroomId })).status).toBe(409);
    expect((await p.post('/api/academic/assignments', { teacherId: w.admin, classroomId: w.classroomId })).status).toBe(400);
    const t2 = await login(w.app, 'teacher2');
    expect((await t2.get('/api/academic/classrooms?mine=true')).body.data).toHaveLength(2);
    expect((await p.post(`/api/academic/assignments/${a.body.data._id}/end`)).status).toBe(200);
    expect((await p.post(`/api/academic/assignments/${a.body.data._id}/end`)).status).toBe(404);
    expect((await t2.get('/api/academic/classrooms?mine=true')).body.data).toHaveLength(1);
    expect((await p.get(`/api/academic/assignments?classroomId=${w.classroomId}&includeEnded=true`)).body.data).toHaveLength(2);
    expect(await TeacherAssignment.countDocuments()).toBe(3);
  });
});

describe('attendance monitoring', () => {
  it('status, sheet detail and record audit trail (with names) reflect the real submission', async () => {
    const p = await login(w.app, 'principal');
    let st = (await p.get(`/api/attendance/status?date=${today()}`)).body.data;
    expect(st.classrooms.find((c: { classroomId: string }) => c.classroomId === w.classroomId).submitted).toBe(false);
    const sheet = await submitToday();
    st = (await p.get(`/api/attendance/status?date=${today()}`)).body.data;
    const row = st.classrooms.find((c: { classroomId: string }) => c.classroomId === w.classroomId);
    expect(row).toMatchObject({ submitted: true, submittedBy: 'TEACHER1', counts: { present: 1, absent: 1, late: 1 } });
    const detail = (await p.get(`/api/attendance/sheets/${sheet._id}`)).body.data;
    expect(detail.records).toHaveLength(3);
    const rec = detail.records.find((r: { status: string }) => r.status === 'absent');
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/attendance/corrections', { attendanceId: rec._id, studentId: rec.studentId, newStatus: 'present', reason: 'Arrived after roll call' })).status).toBe(201);
    const audit = (await p.get(`/api/attendance/audit/${rec._id}`)).body.data;
    expect(audit.map((a: { action: string }) => a.action)).toEqual(['submitted', 'correction_requested']);
    expect(audit[1]).toMatchObject({ from: 'absent', to: 'present', byName: 'TEACHER1', reason: 'Arrived after roll call' });
    expect((await t.get(`/api/attendance/audit/${rec._id}`)).status).toBe(403);
    expect((await p.get(`/api/attendance/sheets/${uuid()}`)).status).toBe(404);
  });

  it('the dashboard overview counts real records', async () => {
    await submitToday();
    const p = await login(w.app, 'principal');
    const d = (await p.get('/api/system/overview')).body.data;
    expect(d.totals).toEqual({ students: 3, activeStudents: 3, teachers: 2, classrooms: 2 });
    expect(d.today).toMatchObject({ present: 1, absent: 1, late: 1, total: 3 });
    expect(d.submissions).toMatchObject({ submitted: 1, total: 2 });
    expect(d.submissions.missing.map((m: { id: string }) => m.id)).toEqual([w.otherClassroomId]);
    const t = await login(w.app, 'teacher2'); // scoped to their own classroom
    expect((await t.get('/api/system/overview')).body.data.totals).toMatchObject({ students: 0, classrooms: 1 });
  });
});

describe('students', () => {
  it('bulk promotion moves only active students of the source classroom and records history', async () => {
    const p = await login(w.app, 'principal');
    await Student.updateOne({ _id: w.studentIds[2] }, { status: 'archived' });
    const r = await p.post('/api/students/bulk-promote', { fromClassroomId: w.classroomId, toClassroomId: w.otherClassroomId, studentIds: w.studentIds, reason: 'Year-end promotion' });
    expect(r.body.data).toEqual({ moved: 2, skipped: 1 });
    expect(await Student.countDocuments({ classroomId: w.otherClassroomId })).toBe(2);
    expect(await StudentHistory.countDocuments({ kind: 'promotion' })).toBe(2);
    expect((await p.post('/api/students/bulk-promote', { fromClassroomId: w.classroomId, toClassroomId: uuid(), studentIds: w.studentIds, reason: 'x y z' })).status).toBe(400);
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/students/bulk-promote', { fromClassroomId: w.otherClassroomId, toClassroomId: w.classroomId, studentIds: w.studentIds, reason: 'nope' })).status).toBe(403);
  });

  it('photo upload accepts images only and stores the path', async () => {
    const p = await login(w.app, 'principal');
    const up = (buf: Buffer, name: string) => p.agent.post(`/api/students/${w.studentIds[0]}/photo`).set('x-csrf-token', p.csrf).attach('file', buf, name);
    expect((await up(Buffer.from('<?php echo 1; ?>....'), 'evil.png')).status).toBe(400);
    const ok = await up(PNG, 'me.png');
    expect(ok.status).toBe(200);
    expect(ok.body.data.path).toMatch(/^\/uploads\/students\/[0-9a-f-]+\.png$/);
    expect((await Student.findById(w.studentIds[0]).lean())!.photoPath).toBe(ok.body.data.path);
  });

  it('export (csv/xlsx) respects teacher scope; the import template has the documented columns', async () => {
    const p = await login(w.app, 'principal');
    const csv = await p.get('/api/students/export/file?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')).toHaveLength(4); // header + 3 students
    expect((await p.get('/api/students/export/file?format=xlsx')).headers['content-type']).toMatch(/spreadsheetml/);
    const t2 = await login(w.app, 'teacher2');
    expect((await t2.get('/api/students/export/file?format=csv')).text.split('\r\n')).toHaveLength(1);
    const tpl = await p.get('/api/students/import/template');
    expect(tpl.text.replace(/^﻿/, '')).toBe('admissionNumber,fullName,dateOfBirth,gender,class,section,admissionDate,emergencyContactName,emergencyContactPhone,parentName,whatsappNumber,address');
  });

  it('custom fields: defined in settings, stored on students, unknown keys refused', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/settings/student-fields', { fields: [{ key: 'bloodGroup', label: 'Blood group' }, { key: 'bloodGroup', label: 'Dup' }] })).status).toBe(400);
    expect((await p.patch('/api/settings/student-fields', { fields: [{ key: 'bloodGroup', label: 'Blood group' }, { key: 'busRoute', label: 'Bus route' }] })).status).toBe(200);
    expect((await p.patch(`/api/students/${w.studentIds[0]}`, { customFields: { shoeSize: '7' } })).status).toBe(400);
    expect((await p.patch(`/api/students/${w.studentIds[0]}`, { customFields: { bloodGroup: ' O+ ', busRoute: '' } })).status).toBe(200);
    expect((await p.get(`/api/students/${w.studentIds[0]}`)).body.data.customFields).toEqual({ bloodGroup: 'O+' });
    const created = await p.post('/api/students', { admissionNumber: 'CF-1', fullName: 'Hina Custom', classroomId: w.classroomId, customFields: { busRoute: 'Route 4' } });
    expect(created.status).toBe(201);
    expect((await Student.findById(created.body.data._id).lean())!.customFields).toEqual({ busRoute: 'Route 4' });
  });
});

describe('guardians', () => {
  it('create, edit, link (first becomes primary), switch primary, unlink; phone search in local format', async () => {
    const p = await login(w.app, 'principal');
    const g1 = (await p.post('/api/guardians', { fullName: 'Asma Bibi', relation: 'Mother', phone: '0300 1112233' })).body.data;
    expect(g1.phone).toBe('+923001112233');
    const g2 = (await p.post('/api/guardians', { fullName: 'Rafiq Khan', relation: 'Father', phone: '+92 321 4445566' })).body.data;
    expect((await p.patch(`/api/guardians/${g1._id}`, { fullName: 'Asma Bibi Khan', phone: '03001112299' })).status).toBe(200);
    const sid = w.studentIds[0];
    const l1 = await p.post(`/api/guardians/students/${sid}/link`, { guardianId: g1._id });
    expect(l1.status).toBe(201);
    expect(l1.body.data.isPrimary).toBe(true);
    expect((await p.post(`/api/guardians/students/${sid}/link`, { guardianId: g1._id })).status).toBe(409);
    const l2 = (await p.post(`/api/guardians/students/${sid}/link`, { guardianId: g2._id })).body.data;
    expect(l2.isPrimary).toBe(false);
    expect((await Student.findById(sid).lean())!.primaryGuardianPhone).toBe('+923001112299');
    expect((await p.patch(`/api/guardians/links/${l2._id}`, { isPrimary: true, receivesAlerts: false })).status).toBe(200);
    expect((await StudentGuardian.findById(l1.body.data._id).lean())!.isPrimary).toBe(false);
    expect((await Student.findById(sid).lean())!.primaryGuardianPhone).toBe('+923214445566');
    // staff type local numbers; stored numbers are international
    expect((await p.get('/api/guardians?q=0321 444 5566')).body.data.map((g: { _id: string }) => g._id)).toEqual([g2._id]);
    expect((await p.get('/api/students?q=03214445566')).body.data.map((s: { _id: string }) => s._id)).toEqual([sid]);
    expect((await p.del(`/api/guardians/links/${l2._id}`)).status).toBe(200);
    // The remaining guardian becomes primary, so the student keeps a contact phone.
    expect((await StudentGuardian.findById(l1.body.data._id).lean())!.isPrimary).toBe(true);
    expect((await Student.findById(sid).lean())!.primaryGuardianPhone).toBe('+923001112299');
    expect((await p.del(`/api/guardians/links/${l1.body.data._id}`)).status).toBe(200);
    expect((await Student.findById(sid).lean())!.primaryGuardianPhone).toBeNull();
    expect(await Guardian.countDocuments()).toBe(2); // unlinking never deletes the guardian
    expect((await p.post('/api/guardians', { fullName: 'Bad', relation: 'Uncle', phone: '12' })).status).toBe(400);
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/guardians', { fullName: 'T', relation: 'X', phone: '03001234567' })).status).toBe(403);
  });
});

describe('settings, website and announcements', () => {
  it('school profile uses optimistic concurrency; the public config reflects it', async () => {
    const p = await login(w.app, 'principal');
    const s = (await p.get('/api/settings')).body.data;
    expect((await p.patch('/api/settings/profile', { name: 'Renamed School', primaryColor: '#123456', version: s.version })).status).toBe(200);
    expect((await p.patch('/api/settings/profile', { name: 'Stale write', version: s.version })).status).toBe(409);
    expect((await p.patch('/api/settings/profile', { timeZone: 'Mars/Olympus' })).status).toBe(400);
    invalidateSettings();
    const pub = (await request(w.app).get('/api/public/config')).body.data;
    expect(pub).toMatchObject({ schoolName: 'Renamed School', primaryColor: '#123456' });
    expect(JSON.stringify(pub)).not.toMatch(/installId|nodeId|mongodb/i);
  });

  it('attendance policy changes what can be submitted', async () => {
    const p = await login(w.app, 'principal');
    const dow = new Date(`${today()}T12:00:00Z`).getUTCDay();
    expect((await p.patch('/api/settings/attendance-policy', { workingDays: [(dow + 1) % 7] })).status).toBe(200);
    expect((await p.patch('/api/settings/attendance-policy', { workingDays: [] })).status).toBe(400);
    invalidateSettings();
    const t = await login(w.app, 'teacher1');
    const r = await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: today(), entries: w.studentIds.map((id) => ({ studentId: id, status: 'present' })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NOT_WORKING_DAY');
  });

  it('backup schedule and branding upload persist', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/settings/backup-schedule', { enabled: true, hour: 23, keepLast: 7 })).status).toBe(200);
    expect((await p.patch('/api/settings/backup-schedule', { enabled: true, hour: 24, keepLast: 7 })).status).toBe(400);
    const logo = await p.agent.post('/api/settings/branding/logo').set('x-csrf-token', p.csrf).attach('file', PNG, 'logo.png');
    expect(logo.status).toBe(200);
    expect((await p.agent.post('/api/settings/branding/banner').set('x-csrf-token', p.csrf).attach('file', PNG, 'x.png')).status).toBe(400);
    const s = (await SchoolSettings.findById('school').lean())!;
    expect(s.backupSchedule).toMatchObject({ enabled: true, hour: 23, keepLast: 7 });
    expect(s.logoPath).toBe(logo.body.data.path);
    invalidateSettings();
    expect((await request(w.app).get('/api/public/config')).body.data.logoUrl).toBe(logo.body.data.path);
  });

  it('public website shows only when enabled, and only published announcements', async () => {
    const p = await login(w.app, 'principal');
    expect((await request(w.app).get('/api/public/website')).status).toBe(404);
    expect((await p.patch('/api/settings/website', { enabled: true, heroTitle: 'Welcome', showAnnouncements: true })).status).toBe(200);
    const draft = (await p.post('/api/settings/announcements', { title: 'Draft news', body: 'not yet' })).body.data;
    const live = (await p.post('/api/settings/announcements', { title: 'Sports day', body: 'Friday', publishedAt: new Date(Date.now() - 60_000).toISOString(), pinned: true })).body.data;
    expect((await p.get('/api/settings/announcements')).body.data).toHaveLength(2);
    invalidateSettings();
    let site = (await request(w.app).get('/api/public/website')).body.data;
    expect(site.heroTitle).toBe('Welcome');
    expect(site.announcements.map((a: { title: string }) => a.title)).toEqual(['Sports day']);
    expect((await p.patch(`/api/settings/announcements/${draft._id}`, { publishedAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(200);
    expect((await p.patch(`/api/settings/announcements/${live._id}`, { title: 'Sports day (moved)' })).status).toBe(200);
    expect((await p.del(`/api/settings/announcements/${draft._id}`)).status).toBe(200);
    expect((await p.del(`/api/settings/announcements/not-a-uuid`)).status).toBe(400);
    site = (await request(w.app).get('/api/public/website')).body.data;
    expect(site.announcements.map((a: { title: string }) => a.title)).toEqual(['Sports day (moved)']);
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/settings/announcements', { title: 'x', body: 'y' })).status).toBe(403);
  });
});

describe('SMS administration', () => {
  it('templates: defaults, save, reject unknown placeholders', async () => {
    const p = await login(w.app, 'principal');
    const before = (await p.get('/api/sms/templates')).body.data;
    expect(before.defaults.absent.en).toMatch(/ABSENT/);
    expect((await p.put('/api/sms/templates', { event: 'absent', language: 'en', body: 'Hi {{guardianName}}, {{nope}}' })).status).toBe(400);
    expect((await p.put('/api/sms/templates', { event: 'absent', language: 'en', body: '{{studentName}} absent today' })).status).toBe(200);
    expect((await p.put('/api/sms/templates', { event: 'absent', language: 'en', body: '{{studentName}} absent on {{date}}' })).status).toBe(200); // update, not duplicate
    const saved = (await p.get('/api/sms/templates')).body.data.saved.filter((x: { event: string; language: string }) => x.event === 'absent' && x.language === 'en');
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe('{{studentName}} absent on {{date}}');
  });

  it('automation settings and provider settings (secrets are write-only)', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/sms/automation', { enabled: true, events: ['absent', 'late'], quietHoursStart: '21:00', quietHoursEnd: '07:00' })).status).toBe(200);
    expect((await p.patch('/api/sms/automation', { quietHoursStart: '25:00' })).status).toBe(400);
    expect((await SchoolSettings.findById('school').lean())!.smsAutomation).toMatchObject({ enabled: true, events: ['absent', 'late'], quietHoursStart: '21:00' });
    expect((await p.put('/api/sms/provider', { provider: 'twilio', accountSid: 'AC' + 'a'.repeat(32), authToken: 'secret-token-0123456789', from: '+15550001111' })).status).toBe(200);
    const prov = (await p.get('/api/sms/provider')).body.data;
    expect(prov).toMatchObject({ provider: 'twilio', source: 'dashboard', configured: true, twilio: { accountSidSet: true, authTokenSet: true, from: '+15550001111' } });
    expect(JSON.stringify(prov)).not.toContain('secret-token-0123456789');
    // blank secret = keep the stored one
    expect((await p.put('/api/sms/provider', { provider: 'twilio', accountSid: '', authToken: '', from: '+15550002222' })).status).toBe(200);
    expect((await p.get('/api/sms/provider')).body.data.twilio).toMatchObject({ authTokenSet: true, from: '+15550002222' });
    expect((await p.put('/api/sms/provider', { provider: 'http', url: '', method: 'POST', webhookToken: '' })).status).toBe(400); // incomplete
    expect((await p.del('/api/sms/provider')).status).toBe(200);
    expect((await p.get('/api/sms/provider')).body.data.source).toBe('environment');
  });

  it('queue actions: test message, logs, retry, cancel, process now, usage', async () => {
    const p = await login(w.app, 'principal');
    const test = await p.post('/api/sms/test', { to: '03001234567' });
    expect(test.status).toBe(200);
    expect(test.body.data.accepted).toBe(false); // no provider configured: reported honestly, never "sent"
    const base = { event: 'absent', to: '+923001112233', body: 'x', date: today(), version: 1 };
    const failed = await NotificationJob.create({ ...base, dedupeKey: 'f', status: 'failed', attempts: 2 });
    const pending = await NotificationJob.create({ ...base, dedupeKey: 'p', status: 'pending', segments: 2 });
    const sent = await NotificationJob.create({ ...base, dedupeKey: 's', status: 'sent' });
    expect((await p.post(`/api/sms/jobs/${failed._id}/retry`)).status).toBe(200);
    expect((await NotificationJob.findById(failed._id).lean())).toMatchObject({ status: 'pending', attempts: 0 });
    expect((await p.post(`/api/sms/jobs/${sent._id}/retry`)).status).toBe(404); // not retryable
    expect((await p.post(`/api/sms/jobs/${pending._id}/cancel`)).status).toBe(200);
    expect((await p.post(`/api/sms/jobs/${sent._id}/cancel`)).status).toBe(404);
    const logs = (await p.get(`/api/sms/jobs/${failed._id}/logs`)).body.data;
    expect(logs.map((l: { type: string }) => l.type)).toEqual(['retry']);
    const run = (await p.post('/api/sms/process-now')).body.data;
    expect(run).toMatchObject({ processed: 1, sent: 0, blocked: 1 });
    const usage = (await p.get(`/api/sms/usage?from=${today()}&to=${today()}`)).body.data as { _id: string; messages: number; segments: number }[];
    expect(Object.fromEntries(usage.map((u) => [u._id, u.messages]))).toEqual({ blocked_config: 1, cancelled: 1, sent: 1 });
    expect(usage.find((u) => u._id === 'cancelled')!.segments).toBe(2);
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/sms/jobs')).status).toBe(403);
  });

  it('delivery receipts: Twilio signature verified; generic gateway token verified', async () => {
    const p = await login(w.app, 'principal');
    const token = 'tw-auth-token-0123456789';
    await p.put('/api/sms/provider', { provider: 'twilio', accountSid: 'AC' + 'b'.repeat(32), authToken: token, from: '+15550001111' });
    const job = await NotificationJob.create({ dedupeKey: 'r1', event: 'absent', to: '+923001112233', body: 'x', status: 'sent', providerMessageId: 'SM1', version: 1 });
    const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
    const url = `${env.APP_URL}/api/webhooks/sms/twilio`;
    const sig = createHmac('sha1', token).update(url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join('')).digest('base64');
    expect((await request(w.app).post('/api/webhooks/sms/twilio').type('form').set('x-twilio-signature', 'forged').send(params)).status).toBe(401);
    expect((await request(w.app).post('/api/webhooks/sms/twilio').type('form').set('x-twilio-signature', sig).send(params)).status).toBe(204);
    expect((await NotificationJob.findById(job._id).lean())!.status).toBe('delivered');
    expect(await NotificationLog.countDocuments({ jobId: job._id, type: 'receipt' })).toBe(1);

    const hook = 'gateway-hook-token-123';
    await p.put('/api/sms/provider', { provider: 'http', url: 'https://gw.example/send', method: 'POST', headers: {}, bodyTemplate: '{"to":"{{to}}"}', from: 'SCHOOL', idPath: 'id', webhookToken: hook });
    const j2 = await NotificationJob.create({ dedupeKey: 'r2', event: 'absent', to: '+923001112233', body: 'x', status: 'sent', providerMessageId: 'GW-9', version: 1 });
    expect((await request(w.app).get('/api/webhooks/sms/http?token=wrong&id=GW-9&status=failed')).status).toBe(401);
    expect((await request(w.app).get(`/api/webhooks/sms/http?token=${hook}&id=GW-9&status=failed&error=blocked`)).status).toBe(204);
    expect((await NotificationJob.findById(j2._id).lean())).toMatchObject({ status: 'undelivered', lastError: 'blocked' });
  });
});

describe('backups', () => {
  it('verify and download an existing backup; tampering is detected', async () => {
    const p = await login(w.app, 'principal');
    const b = (await p.post('/api/backups')).body.data;
    expect(b.status).toBe('verified');
    expect((await p.post(`/api/backups/${b._id}/verify`)).body.data.verified).toBe(true);
    const dl = await p.agent.get(`/api/backups/${b._id}/download`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (x: Buffer) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).subarray(0, 2).toString('hex')).toBe('1f8b'); // gzip
    await BackupRecord.updateOne({ _id: b._id }, { sha256: '0'.repeat(64) });
    const v = (await p.post(`/api/backups/${b._id}/verify`)).body.data;
    expect(v.verified).toBe(false);
    expect(v.record).toMatchObject({ status: 'verify_failed', error: 'checksum mismatch' });
    const t = await login(w.app, 'teacher1');
    expect((await t.get(`/api/backups/${b._id}/download`)).status).toBe(403);
  });
});

describe('account security administration', () => {
  it('unlock, sessions, revoke everywhere, login history, dismiss reset requests', async () => {
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i++) await request(w.app).post('/api/auth/login').send({ username: 'teacher2', password: 'wrong' });
    expect((await User.findById(w.otherTeacher).lean())!.lockedUntil).toBeTruthy();
    const p = await login(w.app, 'principal');
    expect((await p.post(`/api/users/${w.otherTeacher}/unlock`)).status).toBe(200);
    const t2 = await login(w.app, 'teacher2'); // works again
    const sessions = (await p.get(`/api/users/${w.otherTeacher}/sessions`)).body.data;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).not.toHaveProperty('csrfToken');
    expect(sessions[0]._id).toHaveLength(12); // truncated, never the full session id
    const history = (await p.get(`/api/users/${w.otherTeacher}/login-history`)).body.data;
    expect(history.filter((h: { success: boolean }) => !h.success)).toHaveLength(env.LOGIN_MAX_ATTEMPTS);
    expect((await p.post(`/api/users/${w.otherTeacher}/revoke-sessions`)).status).toBe(200);
    expect((await t2.get('/api/auth/me')).status).toBe(401);
    expect(await Session.countDocuments({ userId: w.otherTeacher, revokedAt: null })).toBe(0);

    await request(w.app).post('/api/auth/reset/request').send({ username: 'teacher1' });
    const reqs = (await p.get('/api/system/security')).body.data.resetRequests;
    expect(reqs).toHaveLength(1);
    expect((await p.post(`/api/system/security/reset-requests/${reqs[0]._id}/dismiss`)).status).toBe(200);
    expect((await PasswordResetRequest.findById(reqs[0]._id).lean())!.status).toBe('dismissed');
    expect(await LoginHistory.countDocuments({ username: 'teacher2', success: true })).toBe(1);
    const a = await login(w.app, 'admin1');
    expect((await a.get(`/api/users/${w.principal}/sessions`)).status).toBe(200);
    const t = await login(w.app, 'teacher1');
    expect((await t.post(`/api/users/${w.otherTeacher}/unlock`)).status).toBe(403);
  });
});

describe('health and synchronisation administration', () => {
  it('liveness probe is public and reveals nothing sensitive', async () => {
    const r = await request(w.app).get('/api/health');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['db', 'ok', 'version']);
  });

  it('sync page, run (offline reported honestly), retry, resolve and bootstrap fail safely without Atlas', async () => {
    Object.assign(env, { ATLAS_SYNC_URI: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500' });
    await submitToday();
    const p = await login(w.app, 'principal');
    const page = (await p.get('/api/system/sync')).body.data;
    expect(page).toMatchObject({ enabled: true, mode: 'hybrid' });
    expect(page.operations.length).toBeGreaterThan(0);
    const run = (await p.post('/api/system/sync/run')).body.data;
    expect(run.state).toBe('offline');
    expect(run.lastSuccessAt).toBeNull();
    expect((await p.post('/api/system/sync/retry-failed')).body.data).toEqual({ requeued: 0 });
    const resolve = await p.post(`/api/system/sync/conflicts/${uuid()}/resolve`, { resolution: 'keep_local' });
    expect(resolve.status).toBe(409);
    expect((await p.post('/api/system/sync/bootstrap', { direction: 'sideways' })).status).toBe(400);
    const boot = await p.post('/api/system/sync/bootstrap', { direction: 'push_all' });
    expect(boot.status).toBe(409);
    expect(await AttendanceRecord.countDocuments()).toBe(3); // nothing lost locally
    const t = await login(w.app, 'teacher1');
    expect((await t.post('/api/system/sync/run')).status).toBe(403);
  });
});

describe('referential checks on create', () => {
  it('classrooms need a section of the same class and an existing session', async () => {
    const p = await login(w.app, 'principal');
    const cls = await SchoolClass.findOne().lean();
    const other = await createVersioned(SchoolClass, { name: 'Grade 6', order: 6 });
    const secOther = await createVersioned(Section, { classId: other._id, name: 'A' });
    expect((await p.post('/api/academic/classrooms', { classId: cls!._id, sectionId: secOther._id, sessionId: w.sessionId, name: 'Mismatch' })).status).toBe(400);
    expect((await p.post('/api/academic/classrooms', { classId: other._id, sectionId: secOther._id, sessionId: uuid(), name: 'No session' })).status).toBe(400);
    expect((await p.post('/api/academic/classrooms', { classId: other._id, sectionId: secOther._id, sessionId: w.sessionId, name: '6-A' })).status).toBe(201);
    expect((await p.post('/api/academic/classrooms', { classId: other._id, sectionId: secOther._id, sessionId: w.sessionId, name: '6-A again' })).status).toBe(409);
  });

  it('wrong password on restore is refused and changes nothing', async () => {
    const p = await login(w.app, 'principal');
    const b = (await p.post('/api/backups')).body.data;
    await createVersioned(Student, { admissionNumber: 'NEW-1', admissionNumberLower: 'new-1', fullName: 'Added Later', nameNormalized: 'added later', classroomId: w.classroomId, classId: (await Classroom.findById(w.classroomId).lean())!.classId, sectionId: (await Classroom.findById(w.classroomId).lean())!.sectionId, sessionId: w.sessionId, status: 'active' });
    expect((await p.post('/api/backups/restore', { backupId: b._id, confirmPhrase: 'RESTORE', password: 'not-it' })).status).toBe(400);
    expect((await p.post('/api/backups/restore', { backupId: b._id, confirmPhrase: 'restore', password: PW })).status).toBe(400);
    expect(await Student.countDocuments()).toBe(4);
  });
});
