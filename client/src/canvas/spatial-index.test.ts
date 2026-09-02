import { describe, expect, it, vi } from 'vitest';
import RBush from 'rbush';
import { SpatialIndex } from './spatial-index';

const box = (minX: number, minY: number, maxX: number, maxY: number) => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('SpatialIndex', () => {
  it('re-indexes a shape whose bounds changed', () => {
    const index = new SpatialIndex();
    index.insert('a', box(0, 0, 10, 10));
    index.insert('a', box(100, 100, 110, 110));

    expect(index.size).toBe(1);
    expect(index.getBounds('a')).toMatchObject(box(100, 100, 110, 110));
    expect(index.search(box(0, 0, 50, 50))).toEqual([]);
    expect(index.search(box(90, 90, 120, 120))).toEqual(['a']);
  });

  it('leaves the entry intact when re-inserted at identical bounds', () => {
    const index = new SpatialIndex();
    index.insert('a', box(0, 0, 10, 10));
    // A fresh object with equal values — callers pass a newly derived AABB
    // every time, never the stored instance.
    index.insert('a', box(0, 0, 10, 10));

    expect(index.size).toBe(1);
    expect(index.search(box(5, 5, 6, 6))).toEqual(['a']);
  });

  it('skips R-tree work when bounds are unchanged', () => {
    const index = new SpatialIndex();
    index.insert('a', box(0, 0, 10, 10));

    const remove = vi.spyOn(RBush.prototype, 'remove');
    const insert = vi.spyOn(RBush.prototype, 'insert');
    try {
      // Non-spatial mutations (colour, z-order, text) re-derive the same AABB.
      index.insert('a', box(0, 0, 10, 10));
      expect(remove).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();

      index.insert('a', box(0, 0, 10, 11));
      expect(remove).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
    } finally {
      remove.mockRestore();
      insert.mockRestore();
    }
  });

  it('replaces the whole index in one bulk load', () => {
    const index = new SpatialIndex();
    index.insert('stale', box(0, 0, 5, 5));

    index.loadAll([
      { ...box(0, 0, 10, 10), id: 'a' },
      { ...box(20, 20, 30, 30), id: 'b' },
    ]);

    expect(index.size).toBe(2);
    expect(index.has('stale')).toBe(false);
    expect(index.search(box(5, 5, 6, 6))).toEqual(['a']);
    expect(index.search(box(0, 0, 100, 100)).sort()).toEqual(['a', 'b']);
    // A bulk-loaded entry is a normal one: removable, and re-insertable.
    index.remove('a');
    expect(index.search(box(5, 5, 6, 6))).toEqual([]);
  });

  it('does not alias the caller\'s items when bulk loading', () => {
    const index = new SpatialIndex();
    const item = { ...box(0, 0, 10, 10), id: 'a' };
    index.loadAll([item]);

    // `getBounds` hands out the live tree entry; mutating the array the caller
    // passed in must not move what is indexed.
    item.maxX = 999;
    expect(index.getBounds('a')).toMatchObject(box(0, 0, 10, 10));
  });

  it('takes over another index and leaves it empty', () => {
    const parked = new SpatialIndex();
    parked.insert('a', box(0, 0, 10, 10));
    parked.insert('b', box(20, 20, 30, 30));

    const live = new SpatialIndex();
    live.insert('old', box(50, 50, 60, 60));
    live.adopt(parked);

    expect(live.size).toBe(2);
    expect(live.search(box(5, 5, 6, 6))).toEqual(['a']);
    expect(live.has('old')).toBe(false);
    expect(parked.size).toBe(0);
    expect(parked.search(box(0, 0, 100, 100))).toEqual([]);

    // The emptied index is still usable, not a husk sharing the other's tree.
    parked.insert('c', box(0, 0, 10, 10));
    expect(parked.search(box(5, 5, 6, 6))).toEqual(['c']);
    expect(live.size).toBe(2);
  });

  it('still removes and clears', () => {
    const index = new SpatialIndex();
    index.insert('a', box(0, 0, 10, 10));
    index.insert('b', box(20, 20, 30, 30));

    index.remove('a');
    expect(index.has('a')).toBe(false);
    expect(index.size).toBe(1);

    // Re-inserting a removed id must index it again, not hit the skip path.
    index.insert('a', box(0, 0, 10, 10));
    expect(index.search(box(5, 5, 6, 6))).toEqual(['a']);

    index.clear();
    expect(index.size).toBe(0);
    expect(index.totalBounds()).toBeNull();
  });
});
