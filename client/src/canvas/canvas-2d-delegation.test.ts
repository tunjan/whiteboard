import { describe, expect, it } from 'vitest';
import {
  boundsOverlap,
  delegatedShapeIds,
  type StackedShape,
} from './canvas-2d-delegation';

const box = (id: string, z: number, x: number, w = 10): StackedShape => ({
  id,
  z,
  bounds: { minX: x, minY: 0, maxX: x + w, maxY: 10 },
});

/** Every shape overlaps every other one in `all`; the index does this for real. */
const neighbours = (all: StackedShape[]) => (shape: StackedShape) =>
  all.filter((candidate) => boundsOverlap(candidate.bounds, shape.bounds));

describe('delegating shapes the canvas cannot stack correctly', () => {
  it('delegates nothing when the page owns no DOM shapes', () => {
    expect(delegatedShapeIds([], () => [])).toEqual(new Set());
  });

  it('delegates the DOM shape itself', () => {
    const bookmark = box('bookmark', 5, 0);
    expect(delegatedShapeIds([bookmark], neighbours([bookmark]))).toEqual(
      new Set(['bookmark']),
    );
  });

  // The whole point: a stroke over a bookmark has to stay above it.
  it('delegates a painted shape stacked above one it overlaps', () => {
    const bookmark = box('bookmark', 5, 0);
    const ink = box('ink', 9, 5);
    expect(delegatedShapeIds([bookmark], neighbours([bookmark, ink]))).toEqual(
      new Set(['bookmark', 'ink']),
    );
  });

  it('leaves a shape stacked below it on the canvas', () => {
    const bookmark = box('bookmark', 5, 0);
    const ink = box('ink', 1, 5);
    expect(delegatedShapeIds([bookmark], neighbours([bookmark, ink]))).toEqual(
      new Set(['bookmark']),
    );
  });

  it('leaves a shape above it that it does not overlap', () => {
    const bookmark = box('bookmark', 5, 0);
    const ink = box('ink', 9, 100);
    expect(delegatedShapeIds([bookmark], neighbours([bookmark, ink]))).toEqual(
      new Set(['bookmark']),
    );
  });

  // A delegated shape is DOM-owned in its turn, so the question reopens above
  // it — even for something that never came near the bookmark.
  it('follows the stack transitively', () => {
    const bookmark = box('bookmark', 1, 0);
    const middle = box('middle', 2, 8);
    const top = box('top', 3, 16);
    expect(
      delegatedShapeIds([bookmark], neighbours([bookmark, middle, top])),
    ).toEqual(new Set(['bookmark', 'middle', 'top']));
  });

  it('stops where the chain does', () => {
    const bookmark = box('bookmark', 1, 0);
    const middle = box('middle', 2, 8);
    // Above the bookmark, but only touching `middle` — which is below it.
    const beside = box('beside', 3, 16);
    const below = box('below', 0, 16);
    expect(
      delegatedShapeIds(
        [bookmark],
        neighbours([bookmark, middle, beside, below]),
      ),
    ).toEqual(new Set(['bookmark', 'middle', 'beside']));
  });

  it('terminates when two DOM shapes overlap each other', () => {
    const a = box('a', 1, 0);
    const b = box('b', 2, 5);
    expect(delegatedShapeIds([a, b], neighbours([a, b]))).toEqual(
      new Set(['a', 'b']),
    );
  });
});

describe('bounds overlap', () => {
  it('counts a shared edge as overlapping', () => {
    expect(boundsOverlap(box('a', 0, 0).bounds, box('b', 0, 10).bounds)).toBe(
      true,
    );
  });

  it('separates boxes with a gap between them', () => {
    expect(boundsOverlap(box('a', 0, 0).bounds, box('b', 0, 10.5).bounds)).toBe(
      false,
    );
  });
});
