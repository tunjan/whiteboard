import type { Point } from '@whiteboard/shared';

export interface DragBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Box from a drag between `start` and `point`. With `lockAspect` (Shift), the
 * box is squared — drawing a square / circle / regular polygon.
 */
export function boxFromDrag(
  start: Point,
  point: Point,
  lockAspect: boolean,
): DragBox {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  if (lockAspect) {
    const s = Math.max(w, h);
    w = s;
    h = s;
  }
  return {
    x: dx < 0 ? start.x - w : start.x,
    y: dy < 0 ? start.y - h : start.y,
    w,
    h,
  };
}
