import { describe, expect, it } from 'vitest';
import { shiftedSortableIndex } from './sortable-list-geometry';

describe('shiftedSortableIndex', () => {
  it('opens a gap when an item moves toward the start', () => {
    expect(shiftedSortableIndex(0, 3, 1)).toBe(0);
    expect(shiftedSortableIndex(1, 3, 1)).toBe(2);
    expect(shiftedSortableIndex(2, 3, 1)).toBe(3);
    expect(shiftedSortableIndex(3, 3, 1)).toBe(3);
  });

  it('opens a gap when an item moves toward the end', () => {
    expect(shiftedSortableIndex(0, 1, 3)).toBe(0);
    expect(shiftedSortableIndex(1, 1, 3)).toBe(1);
    expect(shiftedSortableIndex(2, 1, 3)).toBe(1);
    expect(shiftedSortableIndex(3, 1, 3)).toBe(2);
  });

  it('keeps every row in place before the threshold changes the target', () => {
    expect(shiftedSortableIndex(0, 1, 1)).toBe(0);
    expect(shiftedSortableIndex(1, 1, 1)).toBe(1);
    expect(shiftedSortableIndex(2, 1, 1)).toBe(2);
  });
});
