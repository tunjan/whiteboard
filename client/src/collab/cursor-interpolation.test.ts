import { describe, expect, it } from 'vitest';
import {
  CURSOR_INTERVAL_MS,
  CursorInterpolator,
} from './cursor-interpolation';

const I = CURSOR_INTERVAL_MS;

describe('CursorInterpolator', () => {
  it('starts at its first position, without motion', () => {
    const c = new CursorInterpolator({ x: 5, y: 5 });
    expect(c.sample(0)).toEqual({ x: 5, y: 5 });
    expect(c.animating).toBe(false);
  });

  it('glides to a new position over one interval instead of jumping', () => {
    const c = new CursorInterpolator({ x: 0, y: 0 });
    c.push({ x: 100, y: 0 });
    expect(c.sample(0)).toEqual({ x: 0, y: 0 });
    const mid = c.sample(I / 2);
    expect(mid.x).toBeGreaterThan(20);
    expect(mid.x).toBeLessThan(80);
    expect(c.sample(I)).toEqual({ x: 100, y: 0 });
    expect(c.animating).toBe(false);
  });

  it('curves through a corner rather than cutting straight lines', () => {
    const c = new CursorInterpolator({ x: 0, y: 0 });
    c.push({ x: 100, y: 0 });
    c.push({ x: 100, y: 100 });
    c.sample(0);
    // Two queued segments play at double speed; this is the first one's middle.
    const mid = c.sample(I / 4);
    // The tangent at (100, 0) now leans toward the next point, so the first
    // leg bows off the straight line y = 0.
    expect(mid.y).toBeLessThan(0);
    expect(c.sample(I / 4 + I)).toEqual({ x: 100, y: 100 });
  });

  it('passes through every received position', () => {
    const c = new CursorInterpolator({ x: 0, y: 0 });
    const path = [
      { x: 40, y: 10 },
      { x: 90, y: 60 },
      { x: 30, y: 120 },
    ];
    let now = 0;
    c.sample(now);
    for (const p of path) {
      c.push(p);
      // The playback loop starts its clock when a position arrives.
      c.sample(now);
      now += I;
      expect(c.sample(now)).toEqual(p);
    }
  });

  it('catches up when positions arrive faster than they play', () => {
    const c = new CursorInterpolator({ x: 0, y: 0 });
    c.sample(0);
    for (let i = 1; i <= 5; i++) c.push({ x: i * 10, y: 0 });
    // Five segments at nominal speed would take five intervals.
    let now = 0;
    while (c.animating && now < 10 * I) c.sample((now += 16));
    expect(now).toBeLessThan(3 * I);
    expect(c.sample(now)).toEqual({ x: 50, y: 0 });
  });

  it('ignores a repeat of the last position', () => {
    const c = new CursorInterpolator({ x: 1, y: 1 });
    c.push({ x: 1, y: 1 });
    expect(c.animating).toBe(false);
  });

  it('snaps, dropping queued motion', () => {
    const c = new CursorInterpolator({ x: 0, y: 0 });
    c.push({ x: 100, y: 0 });
    c.snap({ x: 7, y: 7 });
    expect(c.animating).toBe(false);
    expect(c.sample(50)).toEqual({ x: 7, y: 7 });
  });
});
