import { describe, expect, it } from 'vitest';
import { safeNext } from './Auth';

describe('safeNext (post-login redirect target)', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/admin/students')).toBe('/admin/students');
    expect(safeNext('/teacher/mark/abc?date=2026-11-12')).toBe('/teacher/mark/abc?date=2026-11-12');
  });

  it('rejects anything that could leave the site', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'evil.example', 'javascript:alert(1)', '/ok\u0000', '/\t/evil.example', '']) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(safeNext(null)).toBeNull();
  });
});
