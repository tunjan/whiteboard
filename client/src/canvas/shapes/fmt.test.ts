import { describe, expect, it } from 'vitest';
import { CentiPixelPathWriter, SVG_PATH_BUFFER_SIZE, toCenti } from './fmt';

describe('CentiPixelPathWriter', () => {
  it('rounds to integer hundredths and emits compact relative commands', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset();
    writer.moveTo(toCenti(10.125), toCenti(-2.004));
    writer.lineTo(toCenti(12.5), toCenti(-1));
    writer.quadraticTo(toCenti(13), toCenti(2), toCenti(15), toCenti(3));
    writer.close();

    expect(writer.finish()).toBe('M 10.13 -2 l 2.37 1 q 0.5 3 2.5 4 Z');
  });

  it('serializes cubic and elliptical arc fields at centi precision', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset();
    writer.moveTo(0, 0);
    writer.cubicTo(100, 200, 300, 400, 500, 600);
    writer.ellipticArcTo(250, 125, 4500, true, false, 800, 900);

    expect(writer.finish()).toBe('M 0 0 c 1 2 3 4 5 6 a 2.5 1.25 45 1 0 3 3');
  });

  it('grows past the reusable 64 KB starting buffer without truncating', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset(SVG_PATH_BUFFER_SIZE + 1);
    writer.moveTo(0, 0);
    for (let index = 1; index <= 12_000; index++) {
      writer.lineTo(index * 100, index % 2 === 0 ? 0 : 100);
    }

    const result = writer.finish();
    expect(result.length).toBeGreaterThan(SVG_PATH_BUFFER_SIZE);
    expect(result.endsWith(' l 1 -1')).toBe(true);
  });

  it('keeps reflected t controls on target however long the chain', () => {
    // Controls a quadratic B-spline wants, in unrounded hundredths.
    const controls = Array.from({ length: 4000 }, (_, k) => ({
      x: k * 71.23 + 0.37,
      y: Math.sin(k * 0.05) * 4000 + k * 0.37,
    }));
    const writer = new CentiPixelPathWriter();
    writer.reset();
    writer.moveTo(0, 0);
    const first = controls[0]!;
    writer.quadraticTo(Math.round(first.x), Math.round(first.y), 0, 0);
    // Replay the renderer: each `t` reflects the previous control about the
    // current point.
    let cx = Math.round(first.x);
    let cy = Math.round(first.y);
    let px = 0;
    let py = 0;
    let worst = 0;
    for (let k = 1; k < controls.length; k++) {
      const next = controls[k]!;
      const reflectedX = 2 * px - cx;
      const reflectedY = 2 * py - cy;
      writer.smoothToward(next.x, next.y);
      px = Math.round((reflectedX + next.x) / 2);
      py = Math.round((reflectedY + next.y) / 2);
      cx = reflectedX;
      cy = reflectedY;
      worst = Math.max(worst, Math.hypot(2 * px - cx - next.x, 2 * py - cy - next.y));
    }
    // One hundredth, plus the half-unit rounding of the coordinates themselves.
    expect(worst).toBeLessThanOrEqual(Math.SQRT2);
  });
});
