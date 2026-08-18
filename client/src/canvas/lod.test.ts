import { describe, expect, it } from 'vitest';
import { isBelowPatternDetail } from './lod';

describe('isBelowPatternDetail', () => {
  it('keeps a pattern at 1:1 however fine the stroke', () => {
    expect(isBelowPatternDetail(1, 1)).toBe(false);
    expect(isBelowPatternDetail(1, 0.5)).toBe(false);
  });

  it('keeps a pattern on a thick stroke seen from far out', () => {
    // 10 world units at 0.25x is still 2.5 screen pixels wide.
    expect(isBelowPatternDetail(0.25, 10)).toBe(false);
  });

  it('drops a pattern only when the stroke is far out and sub-pixel', () => {
    expect(isBelowPatternDetail(0.25, 2)).toBe(true);
    // Same on-screen width, but close enough that the dashes are the detail
    // the user zoomed in for.
    expect(isBelowPatternDetail(0.6, 0.8)).toBe(false);
  });
});
