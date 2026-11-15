import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { balanceMinor, checkPaymentAmount, feeStatus, fromMinor, isDueForReminder, toMinor, voucherTotal } from './fees.js';
import { gradeFor, percentOf, summariseMarks } from './exams.js';
import { effectivePermissions, ROLE_PERMISSIONS } from './permissions.js';
import { smsDedupeKey, whatsappRecipient } from './sms.js';
import { analyticsQuerySchema, resultsSaveSchema, voucherCreateSchema } from '../schemas/features.js';
import { userCreateSchema } from '../schemas/index.js';

describe('fees', () => {
  test('minor-unit conversion is exact for currency amounts', () => {
    assert.equal(toMinor(1234.56), 123456);
    assert.equal(toMinor(0.1 + 0.2), 30);
    assert.equal(fromMinor(123456), 1234.56);
    assert.throws(() => toMinor(Number.NaN));
  });
  test('voucher total adds late fee, subtracts discount, never negative', () => {
    assert.equal(voucherTotal([{ label: 'Tuition', amountMinor: 500000 }, { label: 'Lab', amountMinor: 50000 }], 10000, 20000), 540000);
    assert.equal(voucherTotal([{ label: 'X', amountMinor: 100 }], 0, 1000), 0);
  });
  test('status is derived from verified paid amount', () => {
    assert.equal(feeStatus(1000, 0), 'unpaid');
    assert.equal(feeStatus(1000, 400), 'partial');
    assert.equal(feeStatus(1000, 1000), 'paid');
    assert.equal(feeStatus(1000, 1500), 'paid');
    assert.equal(feeStatus(1000, 400, true), 'cancelled');
    assert.equal(balanceMinor(1000, 1500), 0);
  });
  test('payment amount rules: partial only when allowed, never above balance', () => {
    assert.equal(checkPaymentAmount(1000, 1000, 0, false), null);
    assert.match(checkPaymentAmount(500, 1000, 0, false)!, /in full/);
    assert.equal(checkPaymentAmount(500, 1000, 0, true), null);
    assert.match(checkPaymentAmount(600, 1000, 500, true)!, /more than/);
    assert.match(checkPaymentAmount(1, 1000, 1000, true)!, /already fully paid/);
    assert.match(checkPaymentAmount(0, 1000, 0, true)!, /greater than zero/);
    assert.match(checkPaymentAmount(1.5, 1000, 0, true)!, /greater than zero/);
  });
  test('reminder window includes overdue vouchers', () => {
    assert.equal(isDueForReminder('2026-11-20', '2026-11-13', 7), true);
    assert.equal(isDueForReminder('2026-11-21', '2026-11-13', 7), false);
    assert.equal(isDueForReminder('2026-10-01', '2026-11-13', 3), true);
  });
  test('voucher schema requires integer minor amounts and a valid period', () => {
    const base = { studentId: crypto.randomUUID(), title: 'Tuition', period: '2026-11', dueDate: '2026-11-10', items: [{ label: 'Tuition', amountMinor: 100000 }] };
    assert.equal(voucherCreateSchema.safeParse(base).success, true);
    assert.equal(voucherCreateSchema.safeParse({ ...base, period: '2026-13' }).success, false);
    assert.equal(voucherCreateSchema.safeParse({ ...base, items: [{ label: 'x', amountMinor: 10.5 }] }).success, false);
    assert.equal(voucherCreateSchema.safeParse({ ...base, items: [] }).success, false);
  });
});

describe('exams', () => {
  test('grades and percentages', () => {
    assert.equal(percentOf(45, 50), 90);
    assert.equal(percentOf(1, 0), null);
    assert.equal(gradeFor(90), 'A+');
    assert.equal(gradeFor(39.9), 'F');
    assert.equal(gradeFor(null), '—');
  });
  test('report-card summary counts absent subjects as zero and fails any subject below 40%', () => {
    const s = summariseMarks([
      { subject: 'Maths', maxMarks: 100, marksObtained: 80 },
      { subject: 'English', maxMarks: 100, marksObtained: null, absent: true }
    ]);
    assert.equal(s.max, 200); assert.equal(s.obtained, 80); assert.equal(s.percent, 40);
    assert.equal(s.passed, false); assert.equal(s.failedSubjects, 1);
    assert.equal(summariseMarks([]).passed, false);
  });
  test('results schema rejects marks above maximum and missing marks', () => {
    const sid = crypto.randomUUID(); const room = crypto.randomUUID();
    assert.equal(resultsSaveSchema.safeParse({ classroomId: room, subject: 'Maths', maxMarks: 50, entries: [{ studentId: sid, marksObtained: 51 }] }).success, false);
    assert.equal(resultsSaveSchema.safeParse({ classroomId: room, subject: 'Maths', maxMarks: 50, entries: [{ studentId: sid, marksObtained: null }] }).success, false);
    assert.equal(resultsSaveSchema.safeParse({ classroomId: room, subject: 'Maths', maxMarks: 50, entries: [{ studentId: sid, marksObtained: null, absent: true }] }).success, true);
  });
});

describe('parent role & permissions', () => {
  test('parents only ever get parent.portal, even with extra permissions', () => {
    assert.deepEqual(effectivePermissions('parent', 'standard'), ['parent.portal']);
    assert.deepEqual(effectivePermissions('parent', 'standard', ['students.view', 'fees.manage']), ['parent.portal']);
    assert.deepEqual(effectivePermissions('parent', 'starter'), []);
  });
  test('staff never get parent.portal', () => {
    for (const role of ['principal', 'admin', 'teacher', 'staff'] as const) {
      assert.equal(ROLE_PERMISSIONS[role].includes('parent.portal'), false);
      assert.equal(effectivePermissions(role, 'standard', ['parent.portal']).includes('parent.portal'), false);
    }
  });
  test('the Users API cannot create parent accounts directly', () => {
    const r = userCreateSchema.safeParse({ username: 'mum', fullName: 'Mum', role: 'parent', password: 'Abcdefgh12' });
    assert.equal(r.success, false);
  });
  test('teachers can enter results and homework but not manage fees or exams', () => {
    const p = effectivePermissions('teacher', 'standard');
    assert.ok(p.includes('results.enter') && p.includes('homework.manage'));
    assert.ok(!p.includes('fees.manage') && !p.includes('exams.manage') && !p.includes('analytics.view'));
  });
});

describe('notifications', () => {
  test('SMS dedupe keys keep the v1.0 format; WhatsApp keys are distinct', () => {
    assert.equal(smsDedupeKey('s', '2026-01-01', 'absent', '+92300'), 's:2026-01-01:absent:+92300');
    assert.equal(smsDedupeKey('s', '2026-01-01', 'absent', '+92300', 'whatsapp'), 's:2026-01-01:absent:+92300:whatsapp');
    assert.equal(whatsappRecipient('+923001234567'), '923001234567');
  });
});

describe('analytics query', () => {
  test('rejects reversed and over-long ranges', () => {
    assert.equal(analyticsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success, true);
    assert.equal(analyticsQuerySchema.safeParse({ from: '2026-12-31', to: '2026-01-01' }).success, false);
    assert.equal(analyticsQuerySchema.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success, false);
  });
});
