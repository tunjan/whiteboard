import { describe, expect, it } from 'vitest';
import type { Bounds } from '@whiteboard/shared';
import {
  CORNER_BL,
  CORNER_BR,
  CORNER_TL,
  CORNER_TR,
  mergedRectPath,
  squaredCorners,
} from './image-merge';

const box = (x: number, y: number, w: number, h: number): Bounds => ({
  minX: x,
  minY: y,
  maxX: x + w,
  maxY: y + h,
});

describe('squaredCorners', () => {
  it('squares both corners of a shared edge between equal neighbours', () => {
    const left = box(0, 0, 100, 100);
    const right = box(100, 0, 100, 100);
    expect(squaredCorners(left, [right])).toBe(CORNER_TR | CORNER_BR);
    expect(squaredCorners(right, [left])).toBe(CORNER_TL | CORNER_BL);
  });

  it('squares a stacked pair along the horizontal seam', () => {
    const top = box(0, 0, 100, 100);
    const bottom = box(0, 100, 100, 100);
    expect(squaredCorners(top, [bottom])).toBe(CORNER_BL | CORNER_BR);
    expect(squaredCorners(bottom, [top])).toBe(CORNER_TL | CORNER_TR);
  });

  it('only squares the covered side when the neighbour is smaller', () => {
    const big = box(0, 0, 200, 200);
    const small = box(200, 80, 40, 40);
    // The small image's left corners both sit against the big one's flat edge.
    expect(squaredCorners(small, [big])).toBe(CORNER_TL | CORNER_BL);
    // The big image's own corners are nowhere near it, so they stay rounded.
    expect(squaredCorners(big, [small])).toBe(0);
  });

  it('leaves diagonal neighbours that touch at a point alone', () => {
    const a = box(0, 0, 100, 100);
    const b = box(100, 100, 100, 100);
    expect(squaredCorners(a, [b])).toBe(0);
    expect(squaredCorners(b, [a])).toBe(0);
  });

  it('ignores neighbours separated by a gap', () => {
    const a = box(0, 0, 100, 100);
    expect(squaredCorners(a, [box(104, 0, 100, 100)])).toBe(0);
  });

  it('tolerates a sub-unit seam left by dragging', () => {
    const a = box(0, 0, 100, 100);
    expect(squaredCorners(a, [box(100.4, 0, 100, 100)])).toBe(
      CORNER_TR | CORNER_BR,
    );
  });

  it('keeps only the outer corner of a cell in a 2x2 grid', () => {
    const topLeft = box(0, 0, 100, 100);
    const rest = [
      box(100, 0, 100, 100),
      box(0, 100, 100, 100),
      box(100, 100, 100, 100),
    ];
    expect(squaredCorners(topLeft, rest)).toBe(
      CORNER_TR | CORNER_BR | CORNER_BL,
    );
  });
});

describe('mergedRectPath', () => {
  it('rounds every corner when nothing is touching', () => {
    const d = mergedRectPath(0, 0, 100, 50, 10, 0);
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d).not.toContain('L');
  });

  it('replaces a squared corner with a straight join', () => {
    const d = mergedRectPath(0, 0, 100, 50, 10, CORNER_TR | CORNER_BR);
    expect(d.match(/A/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(2);
    // The right edge now runs the full height of the box.
    expect(d).toContain('H100');
    expect(d).toContain('V50');
  });
});
