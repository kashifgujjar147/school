import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildWorld, login, makeParent, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { NotificationJob, SchoolSettings, Student, User } from '../src/models/index.js';
import { processSmsQueue } from '../src/services/notifications.js';
import { queueFeeReminders } from '../src/services/fees.js';
import { invalidateSettings } from '../src/services/settings.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

async function enableEvents(events: string[], channels: string[] = ['sms']) {
  await SchoolSettings.updateOne({ _id: 'school' }, { smsAutomation: { enabled: true, events, sendAfterSubmission: true, channels } });
  invalidateSettings();
}

describe('notifications: SMS + WhatsApp', () => {
  it('queues homework alerts on both channels; with no providers configured they are blocked, never "sent"', async () => {
    await makeParent(w);
    await enableEvents(['homework'], ['sms', 'whatsapp']);
    const t = await login(w.app, 'teacher1');
    const hw = await t.post('/api/homework', { classroomId: w.classroomId, subject: 'Maths', title: 'Page 12', assignedDate: today(), dueDate: today() });
    expect(hw.status).toBe(201);
    // One guardian linked to two children in this classroom → 2 students × 2 channels.
    expect(hw.body.data.notifications).toMatchObject({ queued: 4 });
    const stats = await processSmsQueue(50);
    expect(stats).toMatchObject({ sent: 0, blocked: 4 });
    const jobs = await NotificationJob.find().lean();
    expect(jobs.every((j) => j.status === 'blocked_config')).toBe(true);
    expect(jobs.map((j) => j.channel).sort()).toEqual(['sms', 'sms', 'whatsapp', 'whatsapp']);
    expect(jobs.find((j) => j.channel === 'whatsapp')!.lastError).toContain('WhatsApp is not enabled');
    // Re-running the same event does not duplicate messages.
    const p = await login(w.app, 'principal');
    expect((await p.get('/api/sms/jobs?channel=whatsapp')).body.meta.total).toBe(2);
    expect((await p.get('/api/sms/jobs?event=homework')).body.meta.total).toBe(4);
  });

  it('disabled events queue nothing', async () => {
    await makeParent(w);
    await enableEvents(['absent']);
    const t = await login(w.app, 'teacher1');
    const hw = await t.post('/api/homework', { classroomId: w.classroomId, subject: 'Maths', title: 'x', assignedDate: today(), dueDate: today() });
    expect(hw.body.data.notifications).toMatchObject({ queued: 0, reason: 'event_disabled' });
    expect(await NotificationJob.countDocuments()).toBe(0);
  });

  it('sends through WhatsApp Cloud API and applies only signed status callbacks', async () => {
    await makeParent(w);
    await enableEvents(['announcement'], ['whatsapp']);
    const p = await login(w.app, 'principal');
    const appSecret = 'meta-app-secret-123456';
    expect((await p.put('/api/sms/whatsapp', { enabled: true, accessToken: 'EAAG' + 'x'.repeat(40), phoneNumberId: '1234567890', appSecret, verifyToken: 'verify-token-123456', templateName: 'school_alert', templateLanguage: 'en' })).status).toBe(200);
    const status = await p.get('/api/sms/whatsapp');
    expect(status.body.data).toMatchObject({ configured: true, accessTokenSet: true, templateName: 'school_alert' });
    expect(JSON.stringify(status.body.data)).not.toContain(appSecret);

    const b = await p.post('/api/sms/broadcast', { title: 'Closed tomorrow', body: 'Rain holiday' });
    expect(b.status).toBe(201);
    expect(b.body.data.queued).toBe(2);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '923001234567', type: 'template', template: { name: 'school_alert' } });
      expect(body.template.components[0].parameters[0].text).toContain('Rain holiday');
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${Math.random()}` }] }), { status: 200 });
    });
    expect(await processSmsQueue(10)).toMatchObject({ sent: 2 });
    fetchMock.mockRestore();
    const job = (await NotificationJob.findOne({ channel: 'whatsapp' }).lean())!;
    expect(job.status).toBe('sent');

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: job.providerMessageId, status: 'delivered' }] } }] }] });
    const bad = await request(w.app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=deadbeef').send(payload);
    expect(bad.status).toBe(401);
    expect((await NotificationJob.findById(job._id).lean())!.status).toBe('sent');
    const sig = 'sha256=' + createHmac('sha256', appSecret).update(payload).digest('hex');
    const good = await request(w.app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(payload);
    expect(good.status).toBe(200);
    expect((await NotificationJob.findById(job._id).lean())!.status).toBe('delivered');
    // Meta verification handshake.
    expect((await request(w.app).get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc')).status).toBe(401);
    expect((await request(w.app).get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-123456&hub.challenge=abc123')).text).toBe('abc123');
    // Parent sees the announcement and the notification in the portal.
    const { parent } = { parent: await login(w.app, 'ayesha.parent', await resetParentPassword()) };
    const dash = await parent.get('/api/parent/dashboard');
    expect(dash.body.data.announcements[0].title).toBe('Closed tomorrow');
    expect(dash.body.data.notifications.length).toBeGreaterThan(0);
  });

  it('fee reminders are queued once per voucher phase', async () => {
    await makeParent(w);
    await enableEvents(['fee_due']);
    const p = await login(w.app, 'principal');
    await p.post('/api/fees/vouchers', { studentId: w.studentIds[0], title: 'Tuition', period: '2026-11', dueDate: today(), items: [{ label: 'Tuition', amountMinor: 100000 }] });
    expect((await p.post('/api/fees/reminders/run', {})).body.data.queued).toBe(1);
    expect((await queueFeeReminders({ force: true })).queued).toBe(0);
    const job = (await NotificationJob.findOne({ event: 'fee_due' }).lean())!;
    expect(job.body).toContain('Rs');
  });
});

/** Sets a known password on the test parent (temporary passwords are random). */
async function resetParentPassword() {
  const { hashPassword } = await import('../src/security/crypto.js');
  await User.updateOne({ username: 'ayesha.parent' }, { passwordHash: await hashPassword('Parent-Pass-123') });
  return 'Parent-Pass-123';
}

describe('student ID cards & QR verification', () => {
  it('generates printable cards with a non-guessable token; public verification is minimal', async () => {
    const p = await login(w.app, 'principal');
    const sid = w.studentIds[0]!;
    const one = await p.get(`/api/id-cards/students/${sid}?layout=card`);
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toBe('application/pdf');
    expect(one.body.subarray(0, 4).toString()).toBe('%PDF');
    const st = (await Student.findById(sid).lean())!;
    expect(st.idCardToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(st.idCardToken).not.toContain(sid.slice(0, 8));
    // Re-printing keeps the same token.
    await p.get(`/api/id-cards/students/${sid}`);
    expect((await Student.findById(sid).lean())!.idCardToken).toBe(st.idCardToken);

    const v = await request(w.app).get(`/api/public/verify/${st.idCardToken}`);
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ valid: true, schoolName: 'Test School', student: { fullName: 'Ali', className: 'Grade 5 · A', enrolled: true } });
    const leaked = JSON.stringify(v.body);
    for (const field of ['admissionNumber', 'A-0', 'dateOfBirth', 'photo', 'guardian', 'phone', sid]) expect(leaked).not.toContain(field);

    expect((await request(w.app).get('/api/public/verify/' + 'x'.repeat(32))).status).toBe(404);
    expect((await request(w.app).get('/api/public/verify/short')).status).toBe(404);

    // Rotation revokes the printed card.
    expect((await p.post(`/api/id-cards/students/${sid}/rotate`, {})).status).toBe(200);
    expect((await request(w.app).get(`/api/public/verify/${st.idCardToken}`)).status).toBe(404);
    // A student who left no longer verifies as enrolled.
    const fresh = (await Student.findById(sid).lean())!.idCardToken!;
    await Student.updateOne({ _id: sid }, { status: 'transferred' });
    expect((await request(w.app).get(`/api/public/verify/${fresh}`)).body.data).toMatchObject({ valid: false, student: { enrolled: false } });
  });

  it('bulk class cards; teachers and parents cannot generate cards', async () => {
    const p = await login(w.app, 'principal');
    const bulk = await p.get(`/api/id-cards/classrooms/${w.classroomId}`);
    expect(bulk.status).toBe(200);
    expect(bulk.headers['content-type']).toBe('application/pdf');
    expect((await Student.find().lean()).filter((s) => s.idCardToken).length).toBe(3);
    const t = await login(w.app, 'teacher1');
    expect((await t.get(`/api/id-cards/classrooms/${w.classroomId}`)).status).toBe(403);
    const { parent } = await makeParent(w);
    expect((await parent.get(`/api/id-cards/students/${w.studentIds[0]}`)).status).toBe(403);
  });
});

describe('analytics from real records', () => {
  it('matches the attendance, fee and exam data in the database', async () => {
    const p = await login(w.app, 'principal');
    const t = await login(w.app, 'teacher1');
    const day = today();
    await t.post('/api/attendance/submit', { classroomId: w.classroomId, date: day, entries: w.studentIds.map((id, i) => ({ studentId: id, status: ['present', 'absent', 'late'][i] })), clientOpId: uuid() }, { 'Idempotency-Key': uuid() });
    const v = await p.post('/api/fees/vouchers', { studentId: w.studentIds[0], title: 'Tuition', period: '2026-11', dueDate: day, issueDate: day, items: [{ label: 'T', amountMinor: 300000 }], allowPartial: true });
    await p.post('/api/fees/vouchers', { studentId: w.studentIds[1], title: 'Tuition', period: '2026-11', dueDate: day, issueDate: day, items: [{ label: 'T', amountMinor: 200000 }] });
    await p.post(`/api/fees/vouchers/${v.body.data._id}/payments`, { amountMinor: 120000, method: 'cash' }, { 'Idempotency-Key': uuid() });
    const exam = await p.post('/api/exams', { name: 'Unit test', startDate: day });
    await t.put(`/api/exams/${exam.body.data._id}/results`, { classroomId: w.classroomId, subject: 'Maths', maxMarks: 50, entries: [{ studentId: w.studentIds[0], marksObtained: 45 }, { studentId: w.studentIds[1], marksObtained: 10 }] });

    const from = `${day.slice(0, 8)}01`;
    const r = await p.get(`/api/analytics/summary?from=${from}&to=${day}`);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.totals).toMatchObject({ activeStudents: 3, teachers: 2, staff: 2, classrooms: 2 });
    expect(d.attendance).toMatchObject({ present: 1, absent: 1, late: 1, total: 3, percent: 66.7 });
    expect(d.attendance.byClassroom).toHaveLength(1);
    expect(d.fees).toMatchObject({ collectedMinor: 120000, issuedMinor: 500000, outstandingMinor: 380000, outstandingVouchers: 2 });
    expect(d.fees.byMethod).toEqual([{ method: 'cash', amountMinor: 120000, payments: 1 }]);
    expect(d.exams[0]).toMatchObject({ name: 'Unit test', students: 2, averagePercent: 55, passRate: 50 });
    expect(d.comparison.current).toMatchObject({ collectedMinor: 120000, attendanceRecords: 3 });
    expect(d.comparison.previous).toMatchObject({ collectedMinor: 0, attendanceRecords: 0 });

    // Class filter: a class with no records shows zeros, not the school totals.
    const { createVersioned } = await import('../src/services/repo.js');
    const { SchoolClass } = await import('../src/models/index.js');
    const other = await createVersioned(SchoolClass, { name: 'Grade 9', order: 9 });
    const f = await p.get(`/api/analytics/summary?from=${from}&to=${day}&classId=${other._id}`);
    expect(f.body.data.totals.activeStudents).toBe(0);
    expect(f.body.data.attendance.total).toBe(0);
    expect(f.body.data.fees).toMatchObject({ collectedMinor: 0, outstandingMinor: 0 });

    expect((await p.get(`/api/analytics/summary?from=${day}&to=${from}`)).status).toBe(400);
    expect((await t.get(`/api/analytics/summary?from=${from}&to=${day}`)).status).toBe(403);
  });
});
