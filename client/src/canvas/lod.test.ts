import { describe, expect, it } from 'vitest';
import { isBelowPatternDetail, usesImageThumb } from './lod';

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

describe('usesImageThumb', () => {
  const props = { blobId: 'b', thumbBlobId: 't', w: 400, h: 300, naturalWidth: 2000, naturalHeight: 1500 };

  it('switches once the long side fits the cutoff', () => {
    expect(usesImageThumb(props, 400)).toBe(true);
    expect(usesImageThumb(props, 399)).toBe(false);
  });

  it('never switches without a thumbnail or a cutoff', () => {
    expect(usesImageThumb({ ...props, thumbBlobId: undefined }, 1000)).toBe(false);
    expect(usesImageThumb(props, 0)).toBe(false);
  });

  it('measures a cropped image by the whole source it stretches', () => {
    // Half the width is kept, so the full source is drawn 800 across.
    const cropped = { ...props, crop: { x: 0, y: 0, w: 0.5, h: 1 } };
    expect(usesImageThumb(cropped, 400)).toBe(false);
    expect(usesImageThumb(cropped, 800)).toBe(true);
  });
});
