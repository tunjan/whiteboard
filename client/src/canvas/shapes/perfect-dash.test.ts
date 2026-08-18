import { describe, expect, it } from 'vitest';
import {
  ellipsePerimeter,
  getPerfectDashProps,
  polylineLength,
} from './perfect-dash';

/** `[dashLength, gapLength]` parsed back out of a `stroke-dasharray`. */
function pattern(props: { strokeDasharray?: string }): [number, number] {
  const parts = props.strokeDasharray!.split(' ').map(Number);
  return [parts[0]!, parts[1]!];
}

function offset(props: { strokeDashoffset?: string }): number {
  return Number(props.strokeDashoffset);
}

/**
 * Assert that `count` periods of the pattern span `length`.
 *
 * Dash and gap are quantized to 1/100th of a unit on their way to the DOM, so
 * the span is only recoverable to within that much per period — an error that
 * stays sub-pixel until a stroke carries thousands of dashes.
 */
function expectSpan(span: number, length: number, count: number): void {
  expect(Math.abs(span - length)).toBeLessThanOrEqual(0.01 * count + 1e-9);
}

describe('getPerfectDashProps', () => {
  it('leaves a solid stroke undashed', () => {
    expect(getPerfectDashProps(100, 4, { style: 'solid' })).toEqual({
      strokeDasharray: undefined,
      strokeDashoffset: undefined,
    });
  });

  it('leaves hand-drawn synthesis undashed as a safe path fallback', () => {
    expect(getPerfectDashProps(100, 4, { style: 'draw' })).toEqual({
      strokeDasharray: undefined,
      strokeDashoffset: undefined,
    });
  });

  it('can force a dashed style to render solid', () => {
    expect(
      getPerfectDashProps(100, 4, {
        style: 'dashed',
        forceSolid: true,
      }),
    ).toEqual({
      strokeDasharray: undefined,
      strokeDashoffset: undefined,
    });
  });

  it.each([
    ['zero length', 0, 4],
    ['negative length', -10, 4],
    ['zero width', 100, 0],
    ['non-finite length', Number.NaN, 4],
  ])('falls back to solid for %s', (_label, length, width) => {
    expect(
      getPerfectDashProps(length, width, { style: 'dashed' }).strokeDasharray,
    ).toBeUndefined();
  });

  // The whole point of the engine: the pattern has to divide the path exactly,
  // so no dash is clipped and none of the length is left over.
  it.each([120, 137.5, 200, 1000, 33.3])(
    'spans a length of %d exactly with whole dashes',
    (length) => {
      const props = getPerfectDashProps(length, 4, {
        style: 'dashed',
        start: 'none',
        end: 'none',
      });
      const [dash, gap] = pattern(props);
      const count = Math.round((length + gap) / (dash + gap));
      expectSpan(count * dash + (count - 1) * gap, length, count);
    },
  );

  it('outsets both ends by half a dash', () => {
    const length = 200;
    const width = 4;
    const outset = getPerfectDashProps(length, width, { style: 'dashed' });
    const flush = getPerfectDashProps(length, width, {
      style: 'dashed',
      start: 'none',
      end: 'none',
    });

    // Half a dash hangs off each end, so the fitted span is one dash longer...
    const [dash, gap] = pattern(outset);
    const count = Math.round((length + dash + gap) / (dash + gap));
    expectSpan(count * dash + (count - 1) * gap, length + dash, count);
    // ...and the pattern is pulled back so the path still starts mid-dash.
    expect(offset(outset)).toBeCloseTo(dash / 2, 2);
    expect(offset(flush)).toBe(0);
  });

  it('retracts a skipped terminal by a full dash', () => {
    const props = getPerfectDashProps(200, 4, {
      style: 'dashed',
      start: 'skip',
      end: 'none',
    });
    expect(offset(props)).toBeLessThan(0);
  });

  it('survives terminals that retract more than the path is long', () => {
    const [dash, gap] = pattern(
      getPerfectDashProps(2, 8, {
        style: 'dashed',
        start: 'skip',
        end: 'skip',
      }),
    );
    expect(Number.isFinite(dash)).toBe(true);
    expect(Number.isFinite(gap)).toBe(true);
    expect(dash).toBeGreaterThanOrEqual(0);
  });

  it('draws a path too short to dash as a solid run', () => {
    // Under four stroke widths there is no room for a dash and a gap.
    const [dash, gap] = pattern(
      getPerfectDashProps(10, 8, { style: 'dashed' }),
    );
    expect(gap).toBe(0);
    expect(dash).toBeGreaterThan(0);
  });

  it('splits a merely short path into three equal parts', () => {
    const [dash, gap] = pattern(
      getPerfectDashProps(40, 8, {
        style: 'dashed',
        start: 'none',
        end: 'none',
      }),
    );
    expect(dash).toBeCloseTo(40 / 3, 1);
    expect(gap).toBeCloseTo(40 / 3, 1);
  });

  it('centres a dash on the seam of a closed loop', () => {
    const props = getPerfectDashProps(300, 4, {
      style: 'dashed',
      closed: true,
    });
    const [dash, gap] = pattern(props);
    // A loop has no ends, so the period must divide the perimeter a whole
    // number of times or the seam shows as a long or short gap.
    const count = Math.round(300 / (dash + gap));
    expectSpan(count * (dash + gap), 300, count);
    expect(offset(props)).toBeCloseTo(dash / 2, 2);
  });

  it('ignores terminals on a closed loop', () => {
    expect(
      getPerfectDashProps(300, 4, {
        style: 'dashed',
        closed: true,
        start: 'skip',
      }),
    ).toEqual(
      getPerfectDashProps(300, 4, {
        style: 'dashed',
        closed: true,
        start: 'none',
      }),
    );
  });

  it('snaps the dash count down to a multiple', () => {
    const snapped = pattern(
      getPerfectDashProps(300, 4, { style: 'dashed', closed: true, snap: 4 }),
    );
    const [dash, gap] = snapped;
    const count = Math.round(300 / (dash + gap));
    expect(count % 4).toBe(0);
  });

  it('spaces dots about two stroke widths apart', () => {
    const [dash, gap] = pattern(
      getPerfectDashProps(200, 4, { style: 'dotted' }),
    );
    // The dot itself is painted by the round linecap, not by the dash length.
    expect(dash).toBeLessThan(1);
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(12);
  });

  it('never divides by a dash count of zero on a very short dotted path', () => {
    const [dash, gap] = pattern(getPerfectDashProps(1, 8, { style: 'dotted' }));
    expect(Number.isFinite(dash)).toBe(true);
    expect(Number.isFinite(gap)).toBe(true);
  });

  it('lengthens sub-pixel dots out of the gap, keeping the period', () => {
    const plain = pattern(getPerfectDashProps(200, 16, { style: 'dotted' }));
    const lifted = pattern(
      getPerfectDashProps(200, 16, { style: 'dotted', minDashLength: 9 }),
    );
    expect(lifted[0]).toBe(9);
    expect(lifted[0] + lifted[1]).toBeCloseTo(plain[0] + plain[1], 2);
  });

  describe('while the stroke is still being drawn', () => {
    // The bug this guards: fitting to a length that grows every frame moves
    // every dash already on screen, so the drawn part of the stroke crawls
    // along behind the pen.
    it.each(['dashed', 'dotted'] as const)(
      'holds the %s pattern still as the path grows',
      (style) => {
        const frames = [5, 23, 60, 61, 140, 999].map((length) =>
          getPerfectDashProps(length, 4, { style, inProgress: true }),
        );
        for (const frame of frames) expect(frame).toEqual(frames[0]);
      },
    );

    it('ignores the length entirely, even a nonsensical one', () => {
      const props = getPerfectDashProps(200, 4, {
        style: 'dashed',
        inProgress: true,
      });
      expect(
        getPerfectDashProps(0, 4, { style: 'dashed', inProgress: true }),
      ).toEqual(props);
      expect(
        getPerfectDashProps(Number.NaN, 4, {
          style: 'dashed',
          inProgress: true,
        }),
      ).toEqual(props);
    });

    // Finishing re-fits the pattern. The offset is anchored at the start, so
    // the correction accumulates toward the far end — where the pen just was,
    // and where a sub-period settle goes unnoticed — and not at the start,
    // which the user has been looking at for the whole stroke.
    it('does not move the start of the stroke when it finishes', () => {
      const drawing = getPerfectDashProps(400, 4, {
        style: 'dashed',
        inProgress: true,
      });
      const finished = getPerfectDashProps(400, 4, { style: 'dashed' });
      expect(offset(finished)).toBeCloseTo(offset(drawing), 2);

      const [liveDash] = pattern(drawing);
      const [finalDash, finalGap] = pattern(finished);
      // The first dash keeps its length to within a fraction of a dash...
      expect(Math.abs(finalDash - liveDash)).toBeLessThan(liveDash / 4);
      // ...and the total correction over the whole stroke stays under one
      // period, so no dash anywhere jumps to where its neighbour was.
      const count = Math.round(400 / (finalDash + finalGap));
      const livePeriod = liveDash * 2;
      expect(
        Math.abs(count * (finalDash + finalGap) - count * livePeriod),
      ).toBeLessThan(livePeriod);
    });

    it('still lifts sub-pixel dots to the minimum', () => {
      const [dash] = pattern(
        getPerfectDashProps(200, 4, {
          style: 'dotted',
          inProgress: true,
          minDashLength: 9,
        }),
      );
      expect(dash).toBe(9);
    });

    it('leaves a solid stroke solid', () => {
      expect(
        getPerfectDashProps(200, 4, { style: 'solid', inProgress: true })
          .strokeDasharray,
      ).toBeUndefined();
    });
  });

  it('keeps a gap when a dot minimum outgrows the whole period', () => {
    // Far enough out that the dots would otherwise be asked to overlap; the
    // stroke has to keep reading as dotted rather than collapsing to solid.
    const [dash, gap] = pattern(
      getPerfectDashProps(200, 4, { style: 'dotted', minDashLength: 9 }),
    );
    expect(dash).toBe(9);
    expect(gap).toBeGreaterThanOrEqual(9);
  });
});

describe('polylineLength', () => {
  it('sums the segments of an open path', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 10 },
      ]),
    ).toBe(11);
  });

  it('adds the closing segment of a loop', () => {
    expect(
      polylineLength(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
        ],
        true,
      ),
    ).toBe(12);
  });

  it('is zero for a degenerate path', () => {
    expect(polylineLength([])).toBe(0);
    expect(polylineLength([{ x: 1, y: 1 }], true)).toBe(0);
  });
});

describe('ellipsePerimeter', () => {
  it('matches a circle exactly', () => {
    expect(ellipsePerimeter(10, 10)).toBeCloseTo(2 * Math.PI * 10, 9);
  });

  it('approximates an eccentric ellipse', () => {
    // Reference value of the exact elliptic integral for a = 10, b = 1.
    expect(ellipsePerimeter(10, 1)).toBeCloseTo(40.6396, 3);
  });

  it('is zero for a degenerate ellipse', () => {
    expect(ellipsePerimeter(0, 0)).toBe(0);
  });
});
