import { describe, expect, it } from 'vitest';
import type { DrawPoint } from '@whiteboard/shared';
import { refineLine, smoothStroke } from './handwriting-refine';

const H = 40;

let seed = 1;
const noise = (amp: number) => {
  seed = (seed * 16807) % 2147483647;
  return ((seed / 2147483647) * 2 - 1) * amp;
};

/** A "u" between x and x + w, sitting on y = 0 (y grows down). */
function u(x: number, w = H * 0.6): DrawPoint[] {
  const pts: DrawPoint[] = [];
  for (let t = 0; t <= 1; t += 0.02) {
    const a = Math.PI * t;
    pts.push({ x: x + w / 2 - (w / 2) * Math.cos(a), y: -H + H * Math.sin(a) ** 0.3 });
  }
  return pts;
}

/** An "l" stem at x. */
const stem = (x: number): DrawPoint[] =>
  Array.from({ length: 30 }, (_, i) => ({ x, y: -H * 1.5 + (H * 1.5 * i) / 29 }));

const transform = (strokes: DrawPoint[][], f: (p: DrawPoint) => DrawPoint) =>
  strokes.map((s) => s.map(f));

const bottom = (s: DrawPoint[]) => Math.max(...s.map((p) => p.y));
const centreX = (s: DrawPoint[]) => (Math.min(...s.map((p) => p.x)) + Math.max(...s.map((p) => p.x))) / 2;

describe('refineLine', () => {
  it('levels a tilted line', () => {
    const angle = (8 * Math.PI) / 180;
    const word = Array.from({ length: 6 }, (_, i) => u(i * H));
    const tilted = transform(word, (p) => ({
      x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
    }));
    const out = refineLine(tilted);
    const first = out[0]!;
    const last = out.at(-1)!;
    const slope = (bottom(last) - bottom(first)) / (centreX(last) - centreX(first));
    expect(Math.abs(Math.atan(slope))).toBeLessThan((1 * Math.PI) / 180);
  });

  it('stands a slanted line upright', () => {
    const shear = Math.tan((15 * Math.PI) / 180);
    const word = [stem(0), u(H * 0.5), stem(H * 1.5), u(H * 2), stem(H * 3)];
    const slanted = transform(word, (p) => ({
      x: p.x - p.y * shear + noise(H * 0.04),
      y: p.y + noise(H * 0.04),
    }));
    const out = refineLine(slanted);
    for (const s of [out[0]!, out[2]!, out[4]!]) {
      expect(Math.abs(s[0]!.x - s.at(-1)!.x)).toBeLessThan(H * 0.06);
    }
  });

  it('sits letters on the baseline but leaves a superscript raised', () => {
    const word = [u(0), u(H), u(2 * H), u(3 * H), u(4 * H)];
    word[1] = word[1]!.map((p) => ({ ...p, y: p.y + H * 0.15 }));
    const sup = u(5 * H, H * 0.3).map((p) => ({ x: p.x, y: p.y * 0.6 - H * 0.6 }));
    const out = refineLine([...word, sup]);
    expect(bottom(out[1]!)).toBeCloseTo(bottom(out[0]!), 0);
    expect(bottom(out[0]!) - bottom(out[5]!)).toBeGreaterThan(H * 0.5);
  });

  it('leaves a stroke that is drawing, not writing, untouched', () => {
    const tall = Array.from({ length: 20 }, (_, i) => ({ x: 7 * H, y: -6 * H + i * 0.3 * H }));
    const out = refineLine([u(0), u(H), u(2 * H), tall]);
    expect(out[3]).toEqual(tall);
  });
});

describe('smoothStroke', () => {
  it('removes jitter without growing the stroke', () => {
    const jittery = Array.from({ length: 120 }, (_, i) => ({
      x: i * H * 0.03,
      y: noise(H * 0.04),
    }));
    const out = smoothStroke(jittery, H);
    // Mean distance from the true line, along the length (not per point: the
    // simplified result keeps few, extreme points).
    const deviation = (s: DrawPoint[]) => {
      let area = 0;
      let length = 0;
      for (let i = 1; i < s.length; i++) {
        const dx = s[i]!.x - s[i - 1]!.x;
        area += (dx * (Math.abs(s[i]!.y) + Math.abs(s[i - 1]!.y))) / 2;
        length += dx;
      }
      return area / length;
    };
    const before = deviation(jittery);
    const after = deviation(out);
    expect(after).toBeLessThan(before / 2);
    expect(out.length).toBeLessThanOrEqual(jittery.length);
  });

  it('keeps a corner sharp', () => {
    const v: DrawPoint[] = [];
    for (let i = 0; i <= 20; i++) v.push({ x: (i / 20) * H * 0.5, y: -H + (i / 20) * H });
    for (let i = 1; i <= 20; i++) v.push({ x: H * 0.5 + (i / 20) * H * 0.5, y: -(i / 20) * H });
    const out = smoothStroke(v, H);
    expect(bottom(out)).toBeGreaterThan(-H * 0.03);
  });

  it('does not shrink an o', () => {
    const r = H * 0.3;
    const o = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 2;
      return { x: r * Math.cos(a) + noise(1), y: r * Math.sin(a) + noise(1) };
    });
    const out = smoothStroke(o, H);
    const height = Math.max(...out.map((p) => p.y)) - Math.min(...out.map((p) => p.y));
    expect(height).toBeGreaterThan(2 * r * 0.95);
  });

  it('carries pressure through', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: noise(1), pressure: 0.3 }));
    expect(smoothStroke(pts, H).every((p) => p.pressure === 0.3)).toBe(true);
  });
});
