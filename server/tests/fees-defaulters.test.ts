import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, login, resetDb, startDb, stopDb, today, uuid, type World } from './helpers.js';
import { Guardian, Student, StudentGuardian } from '../src/models/index.js';
import { createVersioned } from '../src/services/repo.js';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => { await resetDb(); w = await buildWorld(); });

const voucher = (studentId: string, amountMinor: number, period = '2026-11', dueDate = today()) =>
  ({ studentId, title: 'Tuition', period, dueDate, items: [{ label: 'Tuition', amountMinor }] });

describe('unpaid fees list and free WhatsApp reminders', () => {
  it('lists only students who still owe money, with the parent\'s WhatsApp number', async () => {
    const p = await login(w.app, 'principal');
    const [ali, sara, omar] = w.studentIds as [string, string, string];
    // Ali: guardian with a local-format number. Sara: phone only on the student record. Omar: paid in full.
    const g = await createVersioned(Guardian, { fullName: 'Ayesha Khan', relation: 'mother', phone: '0300 1234567' });
    await createVersioned(StudentGuardian, { studentId: ali, guardianId: g._id, isPrimary: true });
    await Student.updateOne({ _id: sara }, { primaryGuardianPhone: '+923219876543' });
    const v1 = (await p.post('/api/fees/vouchers', voucher(ali, 500000))).body.data;
    await p.post('/api/fees/vouchers', voucher(ali, 300000, '2026-10', '2026-10-10'));
    await p.post('/api/fees/vouchers', voucher(sara, 200000));
    const vo = (await p.post('/api/fees/vouchers', voucher(omar, 100000))).body.data;
    expect((await p.post(`/api/fees/vouchers/${vo._id}/payments`, { amountMinor: 100000, method: 'cash' }, { 'Idempotency-Key': uuid() })).status).toBe(201);
    // Part payment keeps Ali on the list with the remaining balance.
    expect((await p.post(`/api/fees/vouchers/${v1._id}/payments`, { amountMinor: 100000, method: 'cash' }, { 'Idempotency-Key': uuid() })).status).toBe(400);

    const r = await p.get('/api/fees/defaulters');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.rows.map((x: { fullName: string }) => x.fullName)).toEqual(['Ali', 'Sara']);
    const a = d.rows[0];
    expect(a.balanceMinor).toBe(800000);
    expect(a.vouchers).toHaveLength(2);
    expect(a.overdue).toBe(true);
    expect(a.parentName).toBe('Ayesha Khan');
    expect(a.whatsapp).toBe('923001234567');
    expect(d.rows[1].whatsapp).toBe('923219876543');
    expect(d.totals).toEqual(expect.objectContaining({ students: 2, balanceMinor: 1000000, noPhone: 0 }));

    // Filters: overdue only, search.
    expect((await p.get('/api/fees/defaulters?overdue=true')).body.data.rows.map((x: { fullName: string }) => x.fullName)).toEqual(['Ali']);
    const sq = await p.get('/api/fees/defaulters?q=sar');
    expect(sq.body.data.rows.map((x: { fullName: string }) => x.fullName)).toEqual(['Sara']);

    // Recording a reminder shows when it was sent.
    expect(a.lastRemindedAt).toBeNull();
    expect((await p.post(`/api/fees/defaulters/${ali}/whatsapp`)).status).toBe(200);
    const again = (await p.get('/api/fees/defaulters')).body.data.rows[0];
    expect(again.lastRemindedAt).not.toBeNull();
    expect((await p.post(`/api/fees/defaulters/${uuid()}/whatsapp`)).status).toBe(404);
  });

  it('the WhatsApp message template is saved in fee settings', async () => {
    const p = await login(w.app, 'principal');
    expect((await p.patch('/api/fees/settings', { whatsappTemplate: 'Dear {parent}, {student} owes {amount}.' })).status).toBe(200);
    expect((await p.get('/api/fees/defaulters')).body.data.template).toBe('Dear {parent}, {student} owes {amount}.');
  });

  it('teachers cannot see the list or record reminders', async () => {
    const t = await login(w.app, 'teacher1');
    expect((await t.get('/api/fees/defaulters')).status).toBe(403);
    expect((await t.post(`/api/fees/defaulters/${w.studentIds[0]}/whatsapp`)).status).toBe(403);
  });
});

describe('parent WhatsApp number on the student form', () => {
  it('is validated, saved, and used before any guardian number', async () => {
    const p = await login(w.app, 'principal');
    const base = { fullName: 'Bilal Ahmed', classroomId: w.classroomId };
    expect((await p.post('/api/students', { ...base, admissionNumber: 'W-1', whatsappNumber: '12345' })).status).toBe(400);
    const created = await p.post('/api/students', { ...base, admissionNumber: 'W-2', parentName: 'Mr. Ahmed', whatsappNumber: '0333 5556677' });
    expect(created.status).toBe(201);
    const id = created.body.data._id as string;
    // A guardian with another number is linked too: the number typed on the student form wins.
    const g = await createVersioned(Guardian, { fullName: 'Uncle', relation: 'uncle', phone: '0300 1111111' });
    await createVersioned(StudentGuardian, { studentId: id, guardianId: g._id, isPrimary: true });
    await p.post('/api/fees/vouchers', voucher(id, 100000));
    const row = (await p.get('/api/fees/defaulters')).body.data.rows.find((r: { studentId: string }) => r.studentId === id);
    expect(row).toEqual(expect.objectContaining({ parentName: 'Mr. Ahmed', whatsapp: '923335556677' }));
    // Editing the number changes where messages go.
    expect((await p.patch(`/api/students/${id}`, { whatsappNumber: '+92 345 0001122' })).status).toBe(200);
    expect((await p.get('/api/fees/defaulters')).body.data.rows.find((r: { studentId: string }) => r.studentId === id).whatsapp).toBe('923450001122');
  });

  it('can be imported from Excel/CSV, including numbers that lost their leading 0', async () => {
    const p = await login(w.app, 'principal');
    const csv = 'admissionNumber,fullName,class,section,parentName,whatsappNumber\nI-1,Imported One,Grade 5,A,Mrs. One,3001234567\nI-2,Imported Two,Grade 5,A,,abc\n';
    const r = await p.agent.post(`/api/students/import?dryRun=false&sessionId=${w.sessionId}`).set('x-csrf-token', p.csrf).attach('file', Buffer.from(csv), 'students.csv');
    expect(r.status).toBe(200);
    expect(r.body.data.imported).toBe(1);
    expect(r.body.data.report[0].errors.join(' ')).toMatch(/whatsappNumber/);
    expect((await Student.findOne({ admissionNumber: 'I-1' }).lean())).toEqual(expect.objectContaining({ parentName: 'Mrs. One', whatsappNumber: '03001234567' }));
  });
});
