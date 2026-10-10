import { describe, expect, it } from 'vitest';
import { isDateStr, isFuture, isIsoStamp, safeDate, today } from './dates';
import { isSafeId, newId } from './ids';

describe('dates', () => {
  const now = new Date(2026, 0, 5, 23, 59);

  it('formats the local calendar day', () => {
    expect(today(now)).toBe('2026-01-05');
    expect(today(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('checks real calendar dates', () => {
    expect(isDateStr('2026-02-28')).toBe(true);
    expect(isDateStr('2024-02-29')).toBe(true);
    expect(isDateStr('2026-02-29')).toBe(false);
    expect(isDateStr('2026-13-01')).toBe(false);
    expect(isDateStr('2026-1-01')).toBe(false);
    expect(isDateStr(20260101)).toBe(false);
  });

  it('spots future dates and replaces bad ones with today', () => {
    expect(isFuture('2026-01-06', now)).toBe(true);
    expect(isFuture('2026-01-05', now)).toBe(false);
    expect(safeDate('2025-12-31', now)).toBe('2025-12-31');
    expect(safeDate('2026-01-06', now)).toBe('2026-01-05');
    expect(safeDate('nope', now)).toBe('2026-01-05');
  });

  it('checks timestamps', () => {
    expect(isIsoStamp(now.toISOString())).toBe(true);
    expect(isIsoStamp('yesterday')).toBe(false);
  });
});

describe('ids', () => {
  it('makes unique, safe ids with a prefix', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId('n')));
    expect(ids.size).toBe(2000);
    for (const id of ids) {
      expect(id).toMatch(/^n_[a-z0-9]+$/);
      expect(isSafeId(id)).toBe(true);
    }
    expect(newId('a').startsWith('a_')).toBe(true);
  });

  it('rejects unsafe ids', () => {
    expect(isSafeId('o_start')).toBe(true);
    expect(isSafeId('')).toBe(false);
    expect(isSafeId('a b')).toBe(false);
    expect(isSafeId('__proto__')).toBe(false);
    expect(isSafeId('constructor')).toBe(false);
    expect(isSafeId(5)).toBe(false);
  });
});
