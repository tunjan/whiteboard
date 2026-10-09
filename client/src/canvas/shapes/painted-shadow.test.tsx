import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaintedShadow, roundedRectPath } from './painted-shadow';

/** The rings, as (distance from the outline, alpha), outermost first. */
function rings(blur: number, opacity: number) {
  const markup = renderToStaticMarkup(
    <svg>
      <PaintedShadow d="M0 0 H10 V10 H0 Z" dy={1} blur={blur} opacity={opacity} />
    </svg>,
  );
  return [...markup.matchAll(/stroke-width="([\d.]+)"[^>]*/g)].map((m, i) => ({
    distance: Number(m[1]) / 2,
    alpha: Number(
      [...markup.matchAll(/fill-opacity="([\d.]+)"/g)][i]![1],
    ),
  }));
}

/** Alpha the stack composites to at `distance` outside the outline. */
function composite(stack: { distance: number; alpha: number }[], distance: number) {
  return (
    1 -
    stack
      .filter((r) => r.distance >= distance)
      .reduce((product, r) => product * (1 - r.alpha), 1)
  );
}

describe('PaintedShadow', () => {
  it('darkens to half the peak opacity at the outline, as a blurred edge does', () => {
    // A Gaussian-blurred edge of a solid shape carries exactly half its flood
    // opacity where the edge itself was. The first schedule stopped short of
    // the outline and left a 1-unit blur at 0.005 instead of 0.04.
    for (const [blur, opacity] of [
      [1, 0.08],
      [3, 0.1],
      [6, 0.08],
    ] as const) {
      expect(composite(rings(blur, opacity), 0)).toBeCloseTo(opacity / 2, 3);
    }
  });

  it('falls off with distance and is spent by three standard deviations', () => {
    const stack = rings(6, 0.08);
    expect(composite(stack, 6)).toBeLessThan(composite(stack, 0));
    expect(composite(stack, 12)).toBeLessThan(composite(stack, 6));
    expect(composite(stack, 18)).toBeLessThan(0.002);
  });

  it('spends more rings on a softer shadow, and never more than eight', () => {
    expect(rings(1, 0.08).length).toBeGreaterThanOrEqual(2);
    expect(rings(6, 0.08).length).toBeGreaterThan(rings(1, 0.08).length);
    expect(rings(40, 0.08).length).toBeLessThanOrEqual(8);
  });

  it('closes the rounded rect outline and clamps the radius to the box', () => {
    expect(roundedRectPath(0, 0, 100, 60, 8)).toMatch(/Z$/);
    // A radius wider than half the box would fold the corners through itself.
    expect(roundedRectPath(0, 0, 10, 4, 50)).toContain('A2 2');
  });
});
