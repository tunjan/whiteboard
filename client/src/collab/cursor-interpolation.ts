import type { Point } from '@whiteboard/shared';

/**
 * How often a peer's cursor is published. Shared by the sender's throttle and
 * the receiver's playback, which spends one interval on each segment.
 */
export const CURSOR_INTERVAL_MS = 200;

interface Segment {
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
}

/** Uniform Catmull-Rom between `p1` and `p2`, `t` in [0, 1]. */
function catmullRom(s: Segment, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  const at = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (c - a) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (3 * b - a - 3 * c + d) * t3);
  return {
    x: at(s.p0.x, s.p1.x, s.p2.x, s.p3.x),
    y: at(s.p0.y, s.p1.y, s.p2.y, s.p3.y),
  };
}

/**
 * Plays a peer's 5 Hz cursor back as a smooth curve through the received
 * positions instead of jumping between them.
 *
 * Each new position queues one spline segment from the previous one, played
 * over one publish interval, so the cursor trails the peer by about that much.
 * A segment's far tangent needs the position after it; it is aimed at its own
 * end until that position arrives and patched then, provided the segment has
 * not started playing — patching one mid-play would move the cursor sideways.
 * When positions arrive faster than they play (network bunching), playback
 * speeds up in proportion to the backlog rather than falling further behind.
 */
export class CursorInterpolator {
  private readonly received: Point[];
  private readonly queue: Segment[] = [];
  private progress = 0;
  private lastSample: number | null = null;
  private current: Point;

  constructor(start: Point) {
    this.received = [start];
    this.current = start;
  }

  /** Whether `sample` still has motion to play. */
  get animating(): boolean {
    return this.queue.length > 0;
  }

  push(point: Point): void {
    const prev = this.received[this.received.length - 1]!;
    if (prev.x === point.x && prev.y === point.y) return;
    const before = this.received[this.received.length - 2] ?? prev;
    const pending = this.queue[this.queue.length - 1];
    const unstarted = this.queue.length > 1 || this.progress === 0;
    if (pending && unstarted) pending.p3 = point;
    this.queue.push({ p0: before, p1: prev, p2: point, p3: point });
    this.received.push(point);
    if (this.received.length > 3) this.received.shift();
  }

  /** Jump straight to `point`, dropping any motion still queued. */
  snap(point: Point): void {
    this.queue.length = 0;
    this.progress = 0;
    this.received.length = 0;
    this.received.push(point);
    this.current = point;
  }

  /** The position to draw at `now` (ms, same clock across calls). */
  sample(now: number): Point {
    const dt = this.lastSample === null ? 0 : now - this.lastSample;
    this.lastSample = now;
    if (this.queue.length === 0) return this.current;
    this.progress += (dt * this.queue.length) / CURSOR_INTERVAL_MS;
    while (this.progress >= 1 && this.queue.length > 0) {
      this.current = this.queue.shift()!.p2;
      this.progress = this.queue.length > 0 ? this.progress - 1 : 0;
    }
    if (this.queue.length === 0) {
      this.lastSample = null;
      return this.current;
    }
    this.current = catmullRom(this.queue[0]!, this.progress);
    return this.current;
  }
}
