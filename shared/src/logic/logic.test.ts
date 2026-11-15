import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideApply, backoffMs, stableEqual, type SyncOperation } from './sync.js';
import { effectivePermissions, hasPermission, packageHasFeature } from './permissions.js';
import { countStatuses, attendancePercent, canSubmitForDate, workingDatesBetween, schoolDate } from './attendance.js';
import { renderTemplate, unknownPlaceholders, normalizePhone, smsSegments, smsDedupeKey } from './sms.js';
import { matchDuplicate } from './students.js';

const op = (o: Partial<SyncOperation> = {}): SyncOperation => ({
  opId: 'op-1', collection: 'students', docId: 'd1', kind: 'upsert', baseVersion: 1, newVersion: 2,
  snapshot: { _id: 'd1', version: 2, fullName: 'Ali' }, nodeId: 'local-1', createdAt: new Date().toISOString(), ...o
});

describe('sync.decideApply', () => {
  test('idempotent: already-applied op is skipped', () => {
    assert.equal(decideApply(op(), { _id: 'd1', version: 1 }, true).action, 'skip_already_applied');
  });
  test('insert when target missing', () => {
    assert.equal(decideApply(op({ baseVersion: 0, newVersion: 1 }), null, false).action, 'insert');
  });
  test('replace when versions line up', () => {
    assert.equal(decideApply(op(), { _id: 'd1', version: 1, fullName: 'A' }, false).action, 'replace');
  });
  test('conflict when target is newer — never overwrite newer with older', () => {
    const d = decideApply(op({ baseVersion: 1, newVersion: 2 }), { _id: 'd1', version: 3, fullName: 'Changed' }, false);
    assert.equal(d.action, 'conflict');
  });
  test('conflict when target has its own pending change', () => {
    assert.equal(decideApply(op(), { _id: 'd1', version: 1, fullName: 'X' }, false, true).action, 'conflict');
  });
  test('identical content already present is skipped (lost-ack retry)', () => {
    const d = decideApply(op(), { _id: 'd1', version: 2, fullName: 'Ali', updatedAt: 'x' }, false);
    assert.equal(d.action, 'skip_already_applied');
  });
  test('delete of missing doc is a no-op', () => {
    assert.equal(decideApply(op({ kind: 'delete', snapshot: null }), null, false).action, 'skip_already_applied');
  });
  test('stableEqual ignores key order and volatile fields', () => {
    assert.ok(stableEqual({ a: 1, b: { c: 2 }, updatedAt: 1 }, { b: { c: 2 }, a: 1, updatedAt: 2 }));
    assert.ok(!stableEqual({ a: 1 }, { a: 2 }));
  });
  test('backoff grows and is capped', () => {
    const r = () => 1;
    assert.equal(backoffMs(1, 1000, 60_000, r), 1000);
    assert.equal(backoffMs(3, 1000, 60_000, r), 4000);
    assert.equal(backoffMs(30, 1000, 60_000, r), 60_000);
  });
});

describe('permissions and packages', () => {
  test('teacher cannot manage users or review corrections', () => {
    const p = effectivePermissions('teacher', 'standard');
    assert.ok(!hasPermission(p, 'users.manage'));
    assert.ok(!hasPermission(p, 'corrections.review'));
    assert.ok(hasPermission(p, 'attendance.mark'));
  });
  test('starter strips standard-only permissions even for principal', () => {
    const p = effectivePermissions('principal', 'starter');
    assert.ok(!hasPermission(p, 'sms.manage'));
    assert.ok(!hasPermission(p, 'guardians.view'));
    assert.ok(hasPermission(p, 'backups.restore'));
  });
  test('admin cannot restore backups; principal can', () => {
    assert.ok(!hasPermission(effectivePermissions('admin', 'standard'), 'backups.restore'));
    assert.ok(hasPermission(effectivePermissions('principal', 'standard'), 'backups.restore'));
  });
  test('revoked permissions are removed', () => {
    assert.ok(!hasPermission(effectivePermissions('admin', 'standard', [], ['students.delete']), 'students.delete'));
  });
  test('package features', () => {
    assert.ok(!packageHasFeature('starter', 'sms_alerts'));
    assert.ok(packageHasFeature('standard', 'sms_alerts'));
    assert.ok(packageHasFeature('standard', 'attendance'));
  });
});

describe('attendance logic', () => {
  test('counts and percentage (late counts, leave excluded)', () => {
    const c = countStatuses(['present', 'present', 'absent', 'late', 'leave']);
    assert.deepEqual(c, { present: 2, absent: 1, late: 1, leave: 1, total: 5 });
    assert.equal(attendancePercent(c), 75);
    assert.equal(attendancePercent(c, { lateCountsAsPresent: false, excludeLeaveFromTotal: false }), 40);
    assert.equal(attendancePercent({ present: 0, absent: 0, late: 0, leave: 3 }), null);
  });
  const base = { timeZone: 'Asia/Karachi', workingDays: [1, 2, 3, 4, 5, 6], holidays: ['2026-11-09'], allowBackdatedDays: 3 };
  test('rejects future, non-working days, holidays, cutoff', () => {
    const now = new Date('2026-11-11T05:00:00Z'); // 10:00 PKT Wednesday
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-12', now }), { ok: false, reason: 'future_date' });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-08', now }), { ok: false, reason: 'not_working_day' });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-09', now }), { ok: false, reason: 'holiday' });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-11', now, cutoffTime: '09:30' }), { ok: false, reason: 'after_cutoff' });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-11', now, cutoffTime: '11:00' }), { ok: true });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-10', now }), { ok: true });
    assert.deepEqual(canSubmitForDate({ ...base, date: '2026-11-02', now }), { ok: false, reason: 'after_cutoff' });
  });
  test('school date respects time zone', () => {
    assert.equal(schoolDate(new Date('2026-11-11T20:30:00Z'), 'Asia/Karachi'), '2026-11-12');
  });
  test('working dates between', () => {
    assert.deepEqual(workingDatesBetween('2026-11-07', '2026-11-11', [1, 2, 3, 4, 5, 6], ['2026-11-09']),
      ['2026-11-07', '2026-11-10', '2026-11-11']);
  });
});

describe('sms logic', () => {
  test('renders templates, keeps unknowns visible', () => {
    assert.equal(renderTemplate('{{studentName}} was {{status}} on {{date}} {{x}}', { studentName: 'Ali', status: 'absent', date: '2026-11-11' }),
      'Ali was absent on 2026-11-11 {{x}}');
    assert.deepEqual(unknownPlaceholders('{{studentName}} {{foo}}'), ['foo']);
  });
  test('phone normalisation', () => {
    assert.equal(normalizePhone('0300-1234567'), '+923001234567');
    assert.equal(normalizePhone('+92 300 1234567'), '+923001234567');
    assert.equal(normalizePhone('00923001234567'), '+923001234567');
    assert.equal(normalizePhone('12'), null);
  });
  test('segments: Urdu uses UCS-2', () => {
    assert.equal(smsSegments('Hello').encoding, 'GSM-7');
    assert.equal(smsSegments('آج غیر حاضر').encoding, 'UCS-2');
    assert.equal(smsSegments('a'.repeat(161)).segments, 2);
  });
  test('dedupe key stable', () => {
    assert.equal(smsDedupeKey('s', '2026-11-11', 'absent', '+92'), 's:2026-11-11:absent:+92');
  });
});

describe('duplicate students', () => {
  test('exact on admission number, likely on name+dob', () => {
    assert.deepEqual(matchDuplicate({ fullName: 'A', admissionNumber: 'ad-1' }, { fullName: 'B', admissionNumber: 'AD-1' }), { level: 'exact', field: 'admissionNumber' });
    assert.equal(matchDuplicate({ fullName: 'Ali  Khan', dateOfBirth: '2015-01-01' }, { fullName: 'ali khan', dateOfBirth: '2015-01-01' })?.level, 'likely');
    assert.equal(matchDuplicate({ fullName: 'Ali' }, { fullName: 'Sara' }), null);
  });
});
