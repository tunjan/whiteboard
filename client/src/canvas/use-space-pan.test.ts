import { describe, expect, it } from 'vitest';
import { RIGHT_DRAG_THRESHOLD, exceedsRightDragThreshold } from './use-space-pan';

describe('exceedsRightDragThreshold', () => {
  it('holds a right press inside the click slop', () => {
    expect(exceedsRightDragThreshold(0, 0)).toBe(false);
    expect(exceedsRightDragThreshold(RIGHT_DRAG_THRESHOLD, 0)).toBe(false);
    expect(exceedsRightDragThreshold(-3, 2)).toBe(false);
  });

  it('reads travel past the slop as a drag, in any direction', () => {
    expect(exceedsRightDragThreshold(RIGHT_DRAG_THRESHOLD + 1, 0)).toBe(true);
    expect(exceedsRightDragThreshold(0, -(RIGHT_DRAG_THRESHOLD + 1))).toBe(true);
    expect(exceedsRightDragThreshold(3, 3)).toBe(true);
  });
});
