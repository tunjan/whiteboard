import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';

/** Longest the trail ever gets, in points. Past this the tail is dropped. */
export const ERASER_TRAIL_MAX = 8;

interface EraserTrailStore {
  /** World-space trail points, oldest first. */
  points: Point[];
  /** True between pointer down and up: a lifted stroke drains and disappears. */
  active: boolean;
  /**
   * Bumped on every {@link extend}. The trail layer compares it against the
   * previous frame's value to tell "the pointer moved" from "the pointer is
   * sitting still", which is the difference between a trail that follows and one
   * that eats itself.
   */
  seq: number;
  begin: (p: Point) => void;
  extend: (p: Point) => void;
  /** Drop the oldest point. Driven one per frame by the trail layer. */
  consume: () => void;
  end: () => void;
}

/**
 * The eraser's self-consuming trail — a short ribbon of where the swipe has just
 * been.
 *
 * The cursor ring says how much the eraser takes; it does not say what the last
 * few hundred milliseconds of a fast swipe actually crossed, and a swipe that
 * outruns the frame rate is exactly when that is in doubt. The trail is a fixed
 * few points long and continuously eats its own tail, so it reads as motion
 * rather than as a stroke: stop moving and it shrinks into the cursor, lift and
 * it drains away.
 *
 * Purely local and transient, like the erase highlight and cut preview — never
 * part of the CRDT, never seen by peers.
 */
export const useEraserTrailStore = create<EraserTrailStore>((set, get) => ({
  points: [],
  active: false,
  seq: 0,
  begin: (p) => set({ points: [p], active: true, seq: get().seq + 1 }),
  extend: (p) => {
    const { points, seq } = get();
    const last = points[points.length - 1];
    // Coalesced samples land many points on one spot; a repeat is not movement.
    if (last && last.x === p.x && last.y === p.y) return;
    const next = points.length >= ERASER_TRAIL_MAX ? points.slice(1) : points.slice();
    next.push(p);
    set({ points: next, seq: seq + 1 });
  },
  consume: () => {
    const { points } = get();
    if (points.length === 0) return;
    set({ points: points.slice(1) });
  },
  end: () => {
    if (!get().active) return;
    set({ active: false });
  },
}));
