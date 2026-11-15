import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './uuid';
import { dateRangePreset } from '../admin/shared';
import { shiftIso, todayIso } from '../teacher/common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('newId', () => {
  it('uses crypto.randomUUID when available', () => {
    expect(newId()).toMatch(UUID_V4);
  });

  it('still produces RFC 4122 v4 ids without randomUUID (plain-HTTP LAN = insecure context)', () => {
    const c = globalThis.crypto as { randomUUID?: unknown };
    const saved = c.randomUUID;
    try {
      Object.defineProperty(c, 'randomUUID', { value: undefined, configurable: true });
      const ids = new Set(Array.from({ length: 200 }, () => newId()));
      expect(ids.size).toBe(200);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(c, 'randomUUID', { value: saved, configurable: true });
    }
  });
});

describe('school-calendar dates', () => {
  it('shiftIso does calendar arithmetic across month and year ends', () => {
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIso('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftIso('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('presets follow the school time zone, not the UTC date', () => {
    vi.useFakeTimers();
    // 2026-11-01 01:30 in Karachi (UTC+5) is still 2026-10-31 in UTC.
    vi.setSystemTime(new Date('2026-10-31T20:30:00Z'));
    expect(todayIso('Asia/Karachi')).toBe('2026-11-01');
    expect(dateRangePreset('today', 'Asia/Karachi')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    expect(dateRangePreset('month', 'Asia/Karachi')).toEqual({ from: '2026-11-01', to: '2026-11-01' });
    // 2026-11-01 is a Sunday, so the week (Monday start) began on 2026-10-26.
    expect(dateRangePreset('week', 'Asia/Karachi')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(dateRangePreset('today', 'UTC')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
  });
});
