import { describe, expect, it } from 'vitest';
import { Mat } from './mat';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

function expectPointsClose(a: { x: number; y: number }, b: { x: number; y: number }) {
  close(a.x, b.x);
  close(a.y, b.y);
}

describe('Mat', () => {
  it('identity leaves points untouched', () => {
    expectPointsClose(Mat.Identity().applyToPoint({ x: 3, y: -7 }), { x: 3, y: -7 });
  });

  it('translates, scales, and rotates points', () => {
    expectPointsClose(Mat.Translate(10, 5).applyToPoint({ x: 1, y: 2 }), { x: 11, y: 7 });
    expectPointsClose(Mat.Scale(2, 3).applyToPoint({ x: 4, y: 5 }), { x: 8, y: 15 });
    // +90 degrees maps (1, 0) onto (0, 1) in a y-down screen space.
    expectPointsClose(Mat.Rotate(Math.PI / 2).applyToPoint({ x: 1, y: 0 }), { x: 0, y: 1 });
  });

  it('rotates about a center without moving that center', () => {
    const center = { x: 30, y: 40 };
    expectPointsClose(Mat.Rotate(0.7, center).applyToPoint(center), center);
  });

  it('composes right-to-left: the last matrix is applied to the point first', () => {
    const scaleThenTranslate = Mat.Compose(Mat.Translate(100, 0), Mat.Scale(2));
    // Scale first (5 -> 10), then translate (+100).
    expectPointsClose(scaleThenTranslate.applyToPoint({ x: 5, y: 0 }), { x: 110, y: 0 });

    const translateThenScale = Mat.Compose(Mat.Scale(2), Mat.Translate(100, 0));
    // Translate first (5 -> 105), then scale (x2).
    expectPointsClose(translateThenScale.applyToPoint({ x: 5, y: 0 }), { x: 210, y: 0 });
  });

  it('matches manual composition of a rotate/scale/translate chain', () => {
    const m = Mat.Compose(Mat.Translate(12, -3), Mat.Rotate(0.4), Mat.Scale(2, 5));
    const p = { x: 7, y: 11 };

    const scaled = { x: p.x * 2, y: p.y * 5 };
    const rotated = {
      x: scaled.x * Math.cos(0.4) - scaled.y * Math.sin(0.4),
      y: scaled.x * Math.sin(0.4) + scaled.y * Math.cos(0.4),
    };
    expectPointsClose(m.applyToPoint(p), { x: rotated.x + 12, y: rotated.y - 3 });
  });

  it('inverts back to the original point', () => {
    const m = Mat.Compose(Mat.Translate(-40, 90), Mat.Rotate(1.2), Mat.Scale(3, 0.5));
    const p = { x: 13, y: -22 };
    expectPointsClose(m.invert().applyToPoint(m.applyToPoint(p)), p);
  });

  it('inverse composed with itself is the identity', () => {
    const m = Mat.Compose(Mat.Translate(5, 6), Mat.Rotate(-0.9), Mat.Scale(1.5, 4));
    const i = m.multiply(m.invert());
    close(i.a, 1);
    close(i.b, 0);
    close(i.c, 0);
    close(i.d, 1);
    close(i.e, 0);
    close(i.f, 0);
  });

  it('throws instead of producing garbage for a singular matrix', () => {
    expect(() => Mat.Scale(0, 0).invert()).toThrow(/not invertible/);
  });

  it('decomposes a rotate/scale/translate composition', () => {
    const m = Mat.Compose(Mat.Translate(8, -4), Mat.Rotate(0.6), Mat.Scale(3, 7));
    const d = m.decompose();
    close(d.x, 8);
    close(d.y, -4);
    close(d.rotation, 0.6);
    close(d.scaleX, 3);
    close(d.scaleY, 7);
  });

  it('decomposes non-uniform scale correctly (hypot(a,b), not hypot(a,c))', () => {
    // Regression guard: deriving scaleX from (a, c) mixes the two axes and
    // reports sqrt((sx*cos)^2 + (sy*sin)^2) instead of sx.
    const d = Mat.Compose(Mat.Rotate(Math.PI / 4), Mat.Scale(2, 10)).decompose();
    close(d.scaleX, 2);
    close(d.scaleY, 10);
    close(d.rotation, Math.PI / 4);
  });

  it('round-trips a decomposition back into the same matrix', () => {
    const m = Mat.Compose(Mat.Translate(-11, 2), Mat.Rotate(2.4), Mat.Scale(0.25, 6));
    const d = m.decompose();
    const rebuilt = Mat.Compose(
      Mat.Translate(d.x, d.y),
      Mat.Rotate(d.rotation),
      Mat.Scale(d.scaleX, d.scaleY),
    );
    close(rebuilt.a, m.a);
    close(rebuilt.b, m.b);
    close(rebuilt.c, m.c);
    close(rebuilt.d, m.d);
    close(rebuilt.e, m.e);
    close(rebuilt.f, m.f);
  });

  it('does not mutate its operands', () => {
    const a = Mat.Translate(1, 2);
    const b = Mat.Scale(3);
    a.multiply(b);
    expect(a.toModel()).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 1, f: 2 });
    expect(b.toModel()).toEqual({ a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 });
  });

  it('emits a DOM-compatible matrix string', () => {
    expect(Mat.Translate(4, 5).toCss()).toBe('matrix(1, 0, 0, 1, 4, 5)');
  });
});
