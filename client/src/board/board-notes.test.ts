import { describe, expect, it } from 'vitest';
import { todayKey } from './board-notes';

describe('todayKey', () => {
  // A session belongs to the day it was taught in the tutor's own calendar —
  // toISOString() would roll a late-evening session forward into the next day.
  it('reads the local calendar date, not UTC', () => {
    expect(todayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 8, 9, 0, 15))).toBe('2026-09-09');
  });
});
