import { describe, expect, it } from 'vitest';
import type { DrawPoint } from '@whiteboard/shared';
import {
  DEFAULT_PENCIL_DYNAMICS,
  DEFAULT_PENCIL_STABILIZATION,
  LIFT_TAPER_FULL_SPEED,
  LIFT_TAPER_MAX_STROKE_FRACTION,
  LIFT_TAPER_MAX_WIDTHS,
  LIFT_TAPER_MIN_SPEED,
  STROKE_PROFILES,
  getInkCenterlineGeometry,
  getInkCenterlinePath,
  getInkPathData,
  liftTaperFor,
  pencilStabilizationToStreamline,
} from './ink';
import { buildInkCenterline } from './ink-engine';
import { INK_ERROR_SCREEN_PX, inkErrorLimit } from '../use-lod-store';

describe('pencil outlines', () => {
  const dynamics = {
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0,
    startTaper: 0,
    endTaper: false,
  };

  it('renders a single input point as a closed outline', () => {
    const path = getInkPathData(
      [{ x: 10, y: 20, pressure: 0.5 }],
      8,
      true,
      dynamics,
    );

    expect(path).toMatch(/^M /);
    expect(path.match(/\ba /g)).toHaveLength(2);
    expect(path).not.toContain(' q ');
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('uses a closed, quantized variable-width outline', () => {
    const path = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 30, y: 10, pressure: 0.9 },
        { x: 70, y: 10, pressure: 0.6 },
      ],
      10,
      true,
      dynamics,
    );

    expect(path).toContain(' q ');
    expect(path).toContain(' t ');
    expect(path.match(/\ba /g)).toHaveLength(2);
    expect(path).not.toContain('NaN');
    expect(path.endsWith(' Z')).toBe(true);
    for (const number of path.matchAll(/-?\d+\.(\d+)/g)) {
      expect(number[1]!.length).toBeLessThanOrEqual(2);
    }
  });

  it('partitions sharp reversals into independently closed subpaths', () => {
    const path = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 100, y: 0, pressure: 0.5 },
        { x: 30, y: 0, pressure: 0.5 },
      ],
      8,
      true,
      dynamics,
    );

    expect(path).not.toContain('NaN');
    expect(path).not.toContain('Infinity');
    expect(path.match(/\bM /g)).toHaveLength(2);
    expect(path.match(/\bZ\b/g)).toHaveLength(2);
    expect(path.match(/\ba /g)).toHaveLength(4);
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('prunes tiny inner segments beside an elbow boundary', () => {
    const elbowDynamics = {
      ...dynamics,
      thinning: 0,
      smoothing: 0,
    };
    const withTinySegment = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 0, pressure: 0.5 },
        { x: 49.9, y: 0, pressure: 0.5 },
        { x: 20, y: 20, pressure: 0.5 },
      ],
      8,
      true,
      elbowDynamics,
    );
    const cleaned = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 0, pressure: 0.5 },
        { x: 20, y: 20, pressure: 0.5 },
      ],
      8,
      true,
      elbowDynamics,
    );

    expect(withTinySegment).toBe(cleaned);
  });

  it('removes endpoint jitter while preserving peak initial pressure', () => {
    const noisy = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.2 },
        { x: 1, y: 1, pressure: 0.8 },
        { x: 40, y: 5, pressure: 0.5 },
        { x: 79, y: 1, pressure: 0.5 },
        { x: 80, y: 0, pressure: 0.5 },
      ],
      12,
      true,
      dynamics,
    );
    const pruned = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.8 },
        { x: 40, y: 5, pressure: 0.5 },
        { x: 80, y: 0, pressure: 0.5 },
      ],
      12,
      true,
      dynamics,
    );

    expect(noisy).toBe(pruned);
  });

  it('uses velocity-derived pressure when simulation is enabled', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 3, y: 0, pressure: 0.5 },
      { x: 6, y: 0, pressure: 0.5 },
      { x: 60, y: 0, pressure: 0.5 },
      { x: 120, y: 0, pressure: 0.5 },
    ];
    const physical = getInkPathData(points, 12, true, {
      ...dynamics,
      simulatePressure: false,
    });
    const simulated = getInkPathData(points, 12, true, {
      ...dynamics,
      simulatePressure: true,
    });

    expect(simulated).not.toBe(physical);
    expect(simulated).not.toContain('NaN');
  });

  it('uses peak pressure throughout sub-pixel short strokes', () => {
    const mixedPressure = getInkPathData(
      [
        { x: 0, y: 0, pressure: 1 },
        { x: 0.2, y: 0, pressure: 0 },
        { x: 0.4, y: 0, pressure: 0 },
      ],
      0.3,
      true,
      { ...dynamics, simulatePressure: false },
    );
    const peakPressure = getInkPathData(
      [
        { x: 0, y: 0, pressure: 1 },
        { x: 0.2, y: 0, pressure: 1 },
        { x: 0.4, y: 0, pressure: 1 },
      ],
      0.3,
      true,
      { ...dynamics, simulatePressure: false },
    );

    expect(mixedPressure).toBe(peakPressure);
  });

  it('applies start and end taper geometry', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 30, y: 10, pressure: 0.5 },
      { x: 70, y: 0, pressure: 0.5 },
    ];
    const round = getInkPathData(points, 10, true, dynamics);
    const tapered = getInkPathData(points, 10, true, {
      ...dynamics,
      startTaper: 20,
      endTaper: true,
    });

    expect(tapered).not.toBe(round);
    expect(tapered.endsWith(' Z')).toBe(true);
  });

  it('compacts dense tracks in place using the smoothing threshold', () => {
    const points = Array.from({ length: 100 }, (_, index) => ({
      x: index * 2,
      y: 0,
      pressure: 0.5,
    }));
    const path = getInkPathData(points, 8, true, dynamics);

    expect(path.match(/\bt /g)?.length ?? 0).toBeLessThan(120);
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('bounds outline simplification to an eight-sample window', () => {
    const points = Array.from({ length: 65 }, (_, index) => ({
      x: index,
      y: 0,
      pressure: 0.5,
    }));
    const path = getInkPathData(points, 0.3, true, {
      ...dynamics,
      thinning: 0,
      smoothing: 1,
    });

    // Each side of this 65-sample straight track keeps indices
    // 0, 8, 16, ... 64. An unbounded greedy pass would collapse it to the two
    // endpoints and emit no smooth quadratic segments at all.
    expect(path.match(/\bt /g)).toHaveLength(14);
  });

  it('uses the smoothing control as the track error bound', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({
      x: index * 4,
      y: Math.sin(index * 1.7) * 0.7,
      pressure: 0.5,
    }));
    const detailed = getInkPathData(points, 12, true, {
      ...dynamics,
      smoothing: 0,
    });
    const smooth = getInkPathData(points, 12, true, {
      ...dynamics,
      smoothing: 1,
    });

    expect(smooth).not.toBe(detailed);
    expect(smooth.length).toBeLessThan(detailed.length);
  });

  it('answers a pressure change over the same distance at any brush width', () => {
    // Relaxing pressure by a fraction of `distance / size` tied the response to
    // the brush: given 20 units to follow a step from light to full pressure, a
    // size-4 nib got 86% of the way there and a size-24 nib only 39%, so the
    // same hand drew a crisp line with a thin nib and a mushy one with a thick
    // one. Measured as half-width over brush width, which cancels the size.
    const widthFraction = (size: number) => {
      const points = Array.from({ length: 40 }, (_, index) => ({
        x: index,
        y: 0,
        pressure: index < 20 ? 0.1 : 1,
      }));
      const path = getInkPathData(points, size, true, {
        ...dynamics,
        smoothing: 0,
      });
      return maxAbsPathY(path) / size;
    };

    const thin = widthFraction(4);
    const thick = widthFraction(24);
    // Full pressure at thinning 0.5 is three quarters of the brush width; both
    // land just short of it, having covered the same ground.
    expect(thin).toBeCloseTo(thick, 2);
    expect(thin).toBeGreaterThan(0.69);
  });

  it('answers it at the same distance with the current opening model too', () => {
    // The test above never reached the code every stroke drawn today runs:
    // `pressureWarmup` names the five-brush-width opening initialization, but
    // it was also branching the steady-state filter back onto the
    // brush-dependent rate that filter replaced. Past the warmup window, a
    // size-24 nib answered the same 40-unit step at 46% of its own width
    // where a size-4 nib reached 64% of its own.
    const widthFraction = (size: number) => {
      const points = Array.from({ length: 241 }, (_, index) => ({
        x: index,
        y: 0,
        // Past five brush widths for both nibs, so the opening warmup has
        // finished and this is the steady-state response being measured.
        pressure: index < 200 ? 0.2 : 0.8,
      }));
      const path = getInkPathData(points, size, true, {
        ...dynamics,
        smoothing: 0,
        pressureEasing: 'linear',
        pressureWarmup: true,
      });
      return maxAbsPathY(path) / size;
    };

    expect(widthFraction(4)).toBeCloseTo(widthFraction(24), 2);
  });

  it('opens at the speed the hand actually left the press point', () => {
    // The streamline pass drops the first few filtered samples, but kept
    // crediting the surviving one with only the last step into it while its
    // run length counted the whole opening. Simulated pressure reads that step
    // as how fast the hand is moving, so a stroke thrown out of the press point
    // opened as if it had crawled — wider than the neutral press radius rather
    // than narrower.
    const points = Array.from({ length: 40 }, (_, index) => ({
      x: index * 10,
      y: 0,
      pressure: 0.5,
    }));
    const path = getInkPathData(points, 60, true, {
      ...dynamics,
      smoothing: 0,
      simulatePressure: true,
      pressureEasing: 'linear',
    });
    // The press point is drawn at neutral pressure, half the brush width. The
    // first vertex after it has to come in from there, not go out past it.
    const [, pressY, firstDy] = /^M \S+ (\S+) q \S+ \S+ \S+ (\S+)/.exec(path)!;
    expect(Math.abs(Number(pressY))).toBeCloseTo(30, 5);
    expect(Math.abs(Number(pressY) + Number(firstDy))).toBeLessThan(30);
  });

  it('carries the previous direction through a step that goes nowhere', () => {
    // A stroke that doubles back onto its own start leaves the streamline pass
    // with two coincident points. That step has no direction, and the fallback
    // used to be `(1, 1)` — not a unit vector at all, so the miter offset came
    // out 41% too wide and locked at -45 degrees, tilting the cap off the line.
    const path = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 3, y: 0, pressure: 0.5 },
        { x: 4, y: 0, pressure: 0.5 },
        { x: 3, y: 0, pressure: 0.5 },
        { x: 0, y: 0, pressure: 0.5 },
        { x: 10, y: 0, pressure: 0.5 },
      ],
      10,
      true,
      { ...dynamics, thinning: 0 },
    );

    // Every offset on a stroke drawn along x is one radius straight up or
    // down. `(1, 1)` tilted the first one to (-5, 5): still 5 tall, but 5 wide
    // as well, so the cap started a whole radius behind the press point.
    expect(path).toMatch(/^M 0 -?5 /);
    expect(maxAbsPathY(path)).toBeCloseTo(5, 2);
  });

  it('spends outline points on curvature rather than on distance', () => {
    // A minimum-spacing rule decimated both of these identically, because it
    // only ever looked at how far apart neighbouring points were. Bounding the
    // perpendicular error instead keeps the points that carry a tight bend and
    // drops the ones strung along a lazy one.
    const arc = (radius: number) =>
      Array.from({ length: 41 }, (_, index) => {
        const angle = (index * 2) / radius;
        return {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
          pressure: 0.5,
        };
      });
    const count = (radius: number) =>
      (getInkPathData(arc(radius), 16, true, dynamics).match(/ t /g) ?? [])
        .length;

    expect(count(15)).toBeGreaterThan(count(60));
  });

  it('reuses typed buffers without leaking a previous longer stroke', () => {
    const shortPoints = [
      { x: 0, y: 0, pressure: 0.4 },
      { x: 20, y: 5, pressure: 0.7 },
      { x: 40, y: 0, pressure: 0.5 },
    ];
    const before = getInkPathData(shortPoints, 8, true, dynamics);
    getInkPathData(
      Array.from({ length: 500 }, (_, index) => ({
        x: index,
        y: Math.sin(index / 10) * 20,
        pressure: (index % 10) / 10,
      })),
      16,
      true,
      { ...dynamics, simulatePressure: true },
    );

    expect(getInkPathData(shortPoints, 8, true, dynamics)).toBe(before);
  });

  it('keeps degenerate and repeated samples finite', () => {
    const points = Array.from({ length: 20 }, () => ({
      x: 4,
      y: 9,
      pressure: 0,
    }));
    const path = getInkPathData(points, 6, true, {
      ...dynamics,
      startTaper: true,
      endTaper: true,
    });
    const untapered = getInkPathData(points, 6, true, dynamics);

    expect(path).toMatch(/^M /);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path.endsWith(' Z')).toBe(true);
    expect(path).toBe(untapered);
  });

  it('sanitizes malformed persisted coordinates and pressure', () => {
    const path = getInkPathData(
      [
        { x: Number.NaN, y: 0, pressure: Number.NaN },
        { x: 30, y: Number.POSITIVE_INFINITY, pressure: 0.5 },
      ],
      8,
      true,
      dynamics,
    );

    expect(path).toMatch(/^M /);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(getInkPathData([], Number.NaN, true, dynamics)).toBe('');
  });

  it('splits a corner on its angle, not on how fast it was drawn', () => {
    // The elbow test divided the neighbouring segment lengths by the brush
    // radius, and sample spacing is a record of hand speed, not of the line's
    // shape: one and the same corner split cleanly into round-capped subpaths
    // when drawn slowly and was left to grow a spike when drawn quickly.
    const subpaths = (turnDegrees: number, spacing: number) => {
      const arm = 120;
      const steps = arm / spacing;
      const points = [];
      for (let i = 0; i <= steps; i++) {
        points.push({ x: i * spacing, y: 0, pressure: 0.5 });
      }
      const turn = (turnDegrees * Math.PI) / 180;
      for (let i = 1; i <= steps; i++) {
        points.push({
          x: arm + Math.cos(turn) * i * spacing,
          y: Math.sin(turn) * i * spacing,
          pressure: 0.5,
        });
      }
      const path = getInkPathData(points, 16, true, {
        ...dynamics,
        thinning: 0,
      });
      return (path.match(/\bM /g) ?? []).length;
    };

    for (const spacing of [2, 6, 12, 20]) {
      // Past the miter limit the join rounds off into two closed subpaths...
      expect(subpaths(120, spacing)).toBe(2);
      // ...and inside it stays one continuous mitred ribbon.
      expect(subpaths(30, spacing)).toBe(1);
    }
  });

  it('carries a corner out to its miter rather than cutting it short', () => {
    // The offset was an un-normalized lerp between the two segment normals, so
    // its length rode the turn angle in both directions — the ribbon pinched
    // to 0.87x through a 60-degree turn and bulged to 2.1x approaching a
    // reversal. Offsetting along the bisector holds the width exact: a
    // right-angle corner reaches radius / cos(45) past the vertex, so a size-16
    // stroke cornering at x = 120 puts its outer face at 120 + 8.
    const points = [];
    for (let i = 0; i <= 12; i++) {
      points.push({ x: i * 10, y: 0, pressure: 0.5 });
    }
    for (let i = 1; i <= 12; i++) {
      points.push({ x: 120, y: i * 10, pressure: 0.5 });
    }
    const path = getInkPathData(points, 16, true, { ...dynamics, thinning: 0 });

    // A right angle is inside the miter limit, so this is one ribbon.
    expect(path.match(/\bM /g)).toHaveLength(1);
    // Measured along the corner's own bisector, which for this turn points
    // along (1, -1). The apex belongs at (128, -8) — a full radius clear of
    // both arms. The old offset put it at (128, 0), flush with the incoming
    // arm's centerline, cutting the corner off at the diagonal.
    expect(maxOverAllPathPoints(path, (x, y) => x - y)).toBeCloseTo(136, 0);
  });

  it('opens and closes a stroke with the same stub at any brush width', () => {
    // The press/lift jitter window was `size / 3`, and the discarded run is
    // replaced by a single straight segment to the endpoint: a size-32 brush
    // opened and closed every stroke with an ~11-unit straight stub where a
    // size-4 brush used ~1.3, so the same hand tracing the same arc got a
    // visibly stiffer line from the thicker pen. While drawing, that stub is
    // the live tip. Jitter is a property of the hand and the digitizer.
    const arc = Array.from({ length: 120 }, (_, index) => ({
      x: 100 * Math.cos(index * 0.01),
      y: 100 * Math.sin(index * 0.01),
      pressure: 0.5,
    }));
    const tailStub = (size: number) => {
      const line = buildInkCenterline(arc, size, 0, true);
      const last = line.count - 1;
      return Math.hypot(
        line.x[last]! - line.x[last - 1]!,
        line.y[last]! - line.y[last - 1]!,
      );
    };

    expect(tailStub(32)).toBeCloseTo(tailStub(8), 5);
    expect(tailStub(32)).toBeLessThan(4);
  });

  it('keeps neutral-pressure width and sharpens the response either side', () => {
    // Smoothstep pins 0, 0.5 and 1 to themselves, so the default pencil's width
    // at neutral pressure is exactly what it was and nothing about an unvarying
    // stroke moves. The slope through the middle is what changes, and that is
    // where a hand actually varies: a quarter of the pressure range either side
    // of neutral now carries more than a quarter of the width range.
    const halfWidth = (pressure: number) =>
      maxAbsPathY(
        getInkPathData(
          Array.from({ length: 60 }, (_, index) => ({
            x: index,
            y: 0,
            pressure,
          })),
          20,
          true,
          { ...dynamics, smoothing: 0 },
        ),
      );

    // thinning 0.5 puts neutral pressure at half the brush width, as before.
    expect(halfWidth(0.5)).toBeCloseTo(10, 1);
    // A linear response would move exactly 2.5 either way.
    expect(halfWidth(0.75) - halfWidth(0.5)).toBeGreaterThan(3);
    expect(halfWidth(0.5) - halfWidth(0.25)).toBeGreaterThan(3);
  });

  it('warms current-profile opening pressure over the first five brush widths', () => {
    const points = Array.from({ length: 61 }, (_, index) => ({
      x: index * 2,
      y: 0,
      pressure: index === 0 ? 1 : 0.1,
    }));
    const openingHalfWidth = (pressureWarmup: boolean) => {
      const path = getInkPathData(points, 10, true, {
        ...dynamics,
        smoothing: 0,
        pressureEasing: 'linear',
        pressureWarmup,
      });
      const match = /^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(path);
      return Math.abs(Number(match?.[2]));
    };

    expect(openingHalfWidth(true)).toBeLessThan(openingHalfWidth(false));
  });

  it('publishes the canonical freehand profile matrix', () => {
    const simulated = STROKE_PROFILES.simulatePressure(10);
    expect(simulated).toMatchObject({
      size: 10,
      thinning: 0.5,
      smoothing: 0.62,
      simulatePressure: true,
      pressureWarmup: true,
    });
    expect(simulated.easing?.(0.5)).toBeCloseTo(Math.SQRT1_2, 12);

    const stylus = STROKE_PROFILES.realPressure(10);
    expect(stylus).toMatchObject({
      size: 13,
      thinning: 0.62,
      smoothing: 0.62,
      streamline: 0.62,
      simulatePressure: false,
      pressureWarmup: true,
    });
    expect(stylus.easing?.(0.5)).toBeCloseTo(
      0.5 * 0.65 + Math.SQRT1_2 * 0.35,
      12,
    );

    expect(STROKE_PROFILES.solid(10)).toMatchObject({
      size: 10,
      thinning: 0,
      smoothing: 0.62,
    });
    expect(STROKE_PROFILES.highlight(10)).toMatchObject({
      size: 11,
      last: false,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
    });
    expect(STROKE_PROFILES.highlight(10, true).last).toBe(true);
  });

  it('defaults to a stable, round-capped pencil', () => {
    expect(DEFAULT_PENCIL_DYNAMICS.simulatePressure).toBe(false);
    expect(DEFAULT_PENCIL_DYNAMICS.endTaper).toBe(false);
  });
});

/** Greatest distance from the x axis reached by a path — a horizontal
 * stroke's widest half-width. Shares `maxPathX`'s command walk. */
function maxAbsPathY(d: string): number {
  return walkPath(d, (_x, y) => Math.abs(y));
}

/**
 * Rightmost absolute x reached by a path. The writer emits one absolute `M`
 * and then relative `q`/`t`/`a` commands, so the current point has to be
 * accumulated to recover real coordinates.
 */
function maxPathX(d: string): number {
  return walkPath(d, (x) => x);
}

/**
 * Greatest `measure` over every point the path names, control points included.
 * A track vertex is emitted as a quadratic's control point and only its
 * midpoints become endpoints, so the endpoint-only walk below steps straight
 * over the apex of a mitred corner.
 */
function maxOverAllPathPoints(
  d: string,
  measure: (x: number, y: number) => number,
): number {
  const tokens = d.match(/[MqtaZ]|-?\d+(?:\.\d+)?/g) ?? [];
  let x = 0;
  let y = 0;
  let controlX = 0;
  let controlY = 0;
  let hasQuadraticControl = false;
  let greatest = Number.NEGATIVE_INFINITY;
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M') {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
      hasQuadraticControl = false;
    } else if (command === 'q') {
      controlX = x + Number(tokens[i++]);
      controlY = y + Number(tokens[i++]);
      greatest = Math.max(greatest, measure(controlX, controlY));
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
      hasQuadraticControl = true;
    } else if (command === 't') {
      controlX = hasQuadraticControl ? 2 * x - controlX : x;
      controlY = hasQuadraticControl ? 2 * y - controlY : y;
      greatest = Math.max(greatest, measure(controlX, controlY));
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
      hasQuadraticControl = true;
    } else if (command === 'a') {
      i += 5;
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
      hasQuadraticControl = false;
    }
    greatest = Math.max(greatest, measure(x, y));
  }
  return greatest;
}

/** Walk a path's command endpoints, returning the greatest `measure`. */
function walkPath(
  d: string,
  measure: (x: number, y: number) => number,
): number {
  const tokens = d.match(/[MqtaZ]|-?\d+(?:\.\d+)?/g) ?? [];
  let x = 0;
  let y = 0;
  let greatest = Number.NEGATIVE_INFINITY;
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M') {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
    } else if (command === 'q') {
      i += 2; // control point, relative to the same current point
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    } else if (command === 't') {
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    } else if (command === 'a') {
      i += 5; // rx ry rotation large-arc sweep
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    }
    greatest = Math.max(greatest, measure(x, y));
  }
  return greatest;
}

describe('finished-stroke endpoint', () => {
  const stabilized = {
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.9,
    startTaper: 0,
    endTaper: false as const,
  };
  const rightward = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 20, y: 0, pressure: 0.5 },
    { x: 40, y: 0, pressure: 0.5 },
    { x: 60, y: 0, pressure: 0.5 },
    { x: 80, y: 0, pressure: 0.5 },
  ];

  it('ends a stroke where the pointer lifted', () => {
    // Heavy stabilization makes the EMA lag by tens of units; pinning the
    // final point to its raw sample stops the ink under the pointer instead
    // of well short of it. The renderer always asks for this, live and
    // committed alike, so a stroke never pops forward at pointer-up.
    const finished = maxPathX(getInkPathData(rightward, 10, true, stabilized));
    expect(finished).toBeGreaterThan(79);
    // Only the round end cap may extend past the lift point.
    expect(finished).toBeLessThanOrEqual(80 + 10);
  });

  /** The conditioned centerline as plain points, copied out of the shared view. */
  const centerlinePoints = (points: DrawPoint[]) => {
    const line = buildInkCenterline(points, 10, stabilized.streamline, true);
    return Array.from({ length: line.count }, (_, i) => ({
      x: line.x[i]!,
      y: line.y[i]!,
    }));
  };

  /** The same line every time; only the sample spacing changes. */
  const ramp = (spacing: number, length = 80) => {
    const steps = Math.round(length / spacing);
    return Array.from({ length: steps + 1 }, (_, index) => ({
      x: (index * length) / steps,
      y: 0,
      pressure: 0.5,
    }));
  };

  /** An arc sampled every unit, the shape the tip pin actually has to correct. */
  const arc = (samples = 90) =>
    Array.from({ length: samples }, (_, i) => {
      const angle = (i / samples) * Math.PI * 0.8;
      return { x: Math.cos(angle) * 40, y: Math.sin(angle) * 40, pressure: 0.5 };
    });

  it('eases the tip onto the pointer instead of snapping it there', () => {
    // The pin has to reach the raw sample, but reaching it in one step makes a
    // discontinuity that moves: while drawing, each frame puts the newest
    // sample on the pointer and the next frame drops it back onto the filtered
    // curve. Every sample behind the tip is bit-stable frame to frame, so that
    // retreat was the whole of the ink's visible unsteadiness, and it sat at
    // exactly the place the eye watches. Spreading it over a run of samples
    // divides it by the number of frames the run spans.
    const points = arc();
    let worst = 0;
    let previous = centerlinePoints(points.slice(0, 20));
    for (let n = 21; n <= points.length; n++) {
      const line = centerlinePoints(points.slice(0, n));
      for (let i = 0; i < Math.min(previous.length, line.length); i++) {
        worst = Math.max(
          worst,
          Math.hypot(previous[i]!.x - line[i]!.x, previous[i]!.y - line[i]!.y),
        );
      }
      previous = line;
    }
    // The single-sample pin moved already-drawn ink by 5.48 units a frame on
    // this arc; the ramp moves it by 1.96. The remainder is not the pin: it is
    // the endpoint-jitter run being collapsed onto a new sample as the stroke
    // grows, which happens with or without stabilization.
    expect(worst).toBeLessThan(3);
  });

  it('still ends exactly on the raw sample while easing', () => {
    // The ease is only in how the tip is reached. Were it to fall short, the
    // stroke would trail the pointer and then pop forward at pointer-up.
    const points = ramp(1);
    const line = centerlinePoints(points);
    expect(line[line.length - 1]).toEqual({ x: 80, y: 0 });
  });

  it('trails the pointer when the endpoint is left unpinned', () => {
    // The unpinned form the engine still supports: every point, including the
    // tip, sits on the filter. Documented so the contrast stays visible.
    const points = ramp(1);
    const pinned = maxPathX(getInkPathData(points, 10, true, stabilized));
    const trailing = maxPathX(getInkPathData(points, 10, false, stabilized));

    expect(trailing).toBeLessThan(pinned - 2);
  });

  /** A corner of `deg`, both arms 60 units long, sampled every `spacing`. */
  const bentLine = (deg: number, spacing: number, arm = 60) => {
    const steps = Math.round(arm / spacing);
    const points = Array.from({ length: steps + 1 }, (_, index) => ({
      x: (index * arm) / steps,
      y: 0,
      pressure: 0.5,
    }));
    const radians = (deg * Math.PI) / 180;
    for (let index = 1; index <= steps; index++) {
      const along = (index * arm) / steps;
      points.push({
        x: arm + along * Math.cos(radians),
        y: along * Math.sin(radians),
        pressure: 0.5,
      });
    }
    return points;
  };

  /** How far inside its true vertex the rendered centerline cuts a corner. */
  const cornerCut = (deg: number, spacing: number, streamline: number) => {
    const line = buildInkCenterline(
      bentLine(deg, spacing),
      10,
      streamline,
      true,
    );
    let nearest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < line.count; index++) {
      nearest = Math.min(
        nearest,
        Math.hypot(line.x[index]! - 60, line.y[index]!),
      );
    }
    return nearest;
  };

  it('keeps a corner in the same place however fast it was drawn', () => {
    // Sample spacing is a record of hand speed, not of the line's shape.
    // Filtering once per sample rather than per unit travelled rounded off
    // corners in proportion to how quickly they were drawn. Stabilization is
    // clamped on long steps so a fast hand cannot outrun it, but the clamp is
    // released where the hand is genuinely turning, so at the setting the
    // pencil actually ships with a corner has to land on its vertex either way.
    const shipped = pencilStabilizationToStreamline(
      DEFAULT_PENCIL_STABILIZATION,
    );
    for (const deg of [45, 60, 90, 135]) {
      expect(cornerCut(deg, 4, shipped)).toBeLessThan(0.5);
      expect(cornerCut(deg, 20, shipped)).toBeLessThan(0.5);
    }
  });

  it('still resolves corners at the top of the stabilization range', () => {
    // Maximum stabilization is a request to be smoothed, and it rounds corners
    // by a couple of units at any speed -- as it did before the clamp existed.
    // The bound is what keeps the clamp's lag from compounding into something
    // that swallows a letterform.
    for (const deg of [45, 60, 90, 135]) {
      expect(cornerCut(deg, 4, 0.9)).toBeLessThan(3);
      expect(cornerCut(deg, 20, 0.9)).toBeLessThan(3);
    }
  });

  /**
   * Excess turning in the rendered centerline over the turning the ideal curve
   * makes, in radians. This is what "wobbly" is: a path that oscillates turns
   * far more than the curve it is meant to be. Lag that merely cuts the curve
   * short does not register here, which is what separates the two.
   */
  const wobble = (spacing: number, amplitude: number) => {
    let seed = 12345;
    const noise = () =>
      ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const arc = Math.PI * 2 * 2.2;
    const steps = Math.round(((20 + 120) / 2) * arc) / spacing;
    const points = Array.from({ length: Math.round(steps) + 1 }, (_, index) => {
      const along = index / Math.round(steps);
      const angle = along * arc;
      const radius = 20 + 100 * along;
      return {
        x: radius * Math.cos(angle) + noise() * amplitude,
        y: radius * Math.sin(angle) + noise() * amplitude,
        pressure: 0.5,
      };
    });

    const line = buildInkCenterline(points, 10, 0.4735, true);
    let turning = 0;
    for (let index = 2; index < line.count; index++) {
      const ax = line.x[index - 1]! - line.x[index - 2]!;
      const ay = line.y[index - 1]! - line.y[index - 2]!;
      const bx = line.x[index]! - line.x[index - 1]!;
      const by = line.y[index]! - line.y[index - 1]!;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la === 0 || lb === 0) continue;
      const cosine = (ax * bx + ay * by) / (la * lb);
      turning += Math.abs(Math.acos(Math.max(-1, Math.min(1, cosine))));
    }
    return Math.max(0, turning - arc);
  };

  it('steadies a fast curve carrying hand tremor', () => {
    // The reason the clamp exists. Filtering purely on distance let a hand
    // moving five units a sample close 99% of the gap, so stabilization
    // switched itself off on exactly the quick sweeping strokes whose tremor
    // is most visible; this spiral wobbled by 98 radians of excess turning
    // where it now wobbles by 65. The bounds sit between the two, so a change
    // that quietly restores the old behaviour fails here.
    expect(wobble(5, 2)).toBeLessThan(80);
    expect(wobble(10, 2)).toBeLessThan(10);
  });

  it('stabilizes a fast straight line rather than passing it through raw', () => {
    // The other half of that clamp: with no turn to protect, a long step is
    // credited at most `MAX_FILTER_STEP` of travel, so the filter still lags a
    // quick line. Unpinned, which is the only form that exposes the filter --
    // every caller in the app pins the final point to the raw lift position.
    const quick = maxPathX(
      getInkPathData(ramp(20, 120), 10, false, stabilized),
    );

    expect(quick).toBeLessThan(120);
  });

  it('is a no-op without stabilization, where the EMA is the identity', () => {
    const unstabilized = { ...stabilized, streamline: 0 };
    expect(getInkPathData(rightward, 10, true, unstabilized)).toBe(
      getInkPathData(rightward, 10, false, unstabilized),
    );
  });
});

describe('dashed centerline', () => {
  const wobble = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 10, y: 6, pressure: 0.5 },
    { x: 20, y: 0, pressure: 0.5 },
  ];

  /**
   * Final absolute point of a centerline path. The engine's writer emits
   * relative commands, so the endpoint is the running sum rather than the last
   * pair of numbers in the string.
   */
  const pathEndpoint = (path: string): { x: number; y: number } => {
    const tokens = path.split(' ');
    let x = 0;
    let y = 0;
    let i = 0;
    while (i < tokens.length) {
      const command = tokens[i++]!;
      if (command === 'M') {
        x = Number(tokens[i++]);
        y = Number(tokens[i++]);
      } else if (command === 'q') {
        i += 2; // control point
        x += Number(tokens[i++]);
        y += Number(tokens[i++]);
      } else if (command === 't') {
        x += Number(tokens[i++]);
        y += Number(tokens[i++]);
      }
    }
    return { x, y };
  };

  it('follows the raw samples when stabilization is off', () => {
    // Relative commands through the sample midpoints: `q` ends at (15, 3) with
    // control (10, 6), and the closing `t` reflects that control to (20, 0),
    // which lands the segment on the lift point as a straight run.
    expect(getInkCenterlinePath(wobble, 6, 0)).toBe('M 0 0 q 10 6 15 3 t 5 -3');
  });

  it('stabilizes dashed ink like the solid engine does', () => {
    // Dashed strokes used to render straight off the raw points, so the
    // pencil-stabilization setting silently did nothing for them.
    expect(getInkCenterlinePath(wobble, 6, 0.9)).not.toBe(
      getInkCenterlinePath(wobble, 6, 0),
    );
  });

  it('still ends on the raw lift point at any stabilization', () => {
    expect(pathEndpoint(getInkCenterlinePath(wobble, 6, 0.9))).toEqual({
      x: 20,
      y: 0,
    });
  });

  it('drops the same start jitter the solid outline does', () => {
    // Both forms now run on one conditioned centerline, so a dashed stroke can
    // no longer sit beside the solid stroke drawn from the very same points.
    const start = { x: 0.4, y: 0.3, pressure: 0.5 };
    const jittered = [start, ...wobble];

    expect(getInkCenterlinePath(jittered, 6, 0.4)).toBe(
      getInkCenterlinePath([start, ...wobble.slice(1)], 6, 0.4),
    );
  });
});

describe('stabilization against the camera', () => {
  const sliders = [0, 0.2, 0.35, 0.5, 0.75, 1];

  it('is unchanged at 1:1 and above', () => {
    // The correction only ever adds smoothing. Applied symmetrically it would
    // also strip it when zoomed in — at zoom 4 the 0.35 default falls to about
    // 0.03, effectively no stabilization at all.
    for (const slider of sliders) {
      const atOne = pencilStabilizationToStreamline(slider);
      expect(pencilStabilizationToStreamline(slider, 1)).toBe(atOne);
      expect(pencilStabilizationToStreamline(slider, 4)).toBe(atOne);
    }
  });

  it('steadies the line further the further out the camera is', () => {
    // The engine filters in world units, so the same tremor in the hand covers
    // more of them zoomed out and came back a visibly shakier line.
    for (const slider of [0.2, 0.35, 0.5]) {
      const half = pencilStabilizationToStreamline(slider, 0.5);
      const quarter = pencilStabilizationToStreamline(slider, 0.25);
      expect(half).toBeGreaterThan(pencilStabilizationToStreamline(slider, 1));
      expect(quarter).toBeGreaterThan(half);
      expect(quarter).toBeLessThanOrEqual(1);
    }
  });

  it('saturates rather than running off the end of the range', () => {
    // `streamline` bottoms out at a raw weight of 0.15, so past roughly zoom
    // 0.18 the filter is already as slow as the engine can make it.
    expect(pencilStabilizationToStreamline(0.35, 0.01)).toBe(1);
    expect(pencilStabilizationToStreamline(0.35, 0)).toBe(
      pencilStabilizationToStreamline(0.35),
    );
  });

  it('actually smooths more, measured on a stroke', () => {
    // A slider value only matters through what the engine does with it, and at
    // `streamline: 0` the filter is the identity — a difference the settings
    // produce has to show up in the ink to count.
    const jitter = Array.from({ length: 60 }, (_, i) => ({
      x: i,
      y: i % 2 === 0 ? 0 : 2,
      pressure: 0.5,
    }));
    // Total vertical travel of the conditioned centerline. The raw zig-zag
    // covers 2 units per sample; the more the filter absorbs, the less is left.
    // (Not peak deviation: the filter starts pinned to the raw first point, so
    // that one sample's error is the same however slow the filter is.)
    const wobble = (zoom: number): number => {
      const line = buildInkCenterline(
        jitter,
        4,
        pencilStabilizationToStreamline(0.35, zoom),
        true,
      );
      let total = 0;
      for (let i = 1; i < line.count; i++) {
        total += Math.abs(line.y[i]! - line.y[i - 1]!);
      }
      return total;
    };
    expect(wobble(0.25)).toBeLessThan(wobble(1));
  });
});

describe('stylus tilt', () => {
  const dynamics = {
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0,
    startTaper: 0,
    endTaper: false as const,
  };

  /** A straight horizontal stroke, every sample leaning the same way. */
  function stroke(tiltX: number, tiltY: number): DrawPoint[] {
    return Array.from({ length: 40 }, (_, i) => ({
      x: i * 2,
      y: 0,
      pressure: 0.5,
      tiltX,
      tiltY,
    }));
  }

  /** Widest half-width of that stroke, as drawn. */
  function halfWidth(points: DrawPoint[], tiltAmount: number): number {
    return maxAbsPathY(
      getInkPathData(points, 10, true, { ...dynamics, tiltAmount }),
    );
  }

  it('broadens a stroke drawn across the lean and not one drawn along it', () => {
    // The nib is an ellipse laid along the barrel: crossing it presents the
    // flat, following it presents the same edge an upright pen has. A model
    // that widened on any tilt at all would fail the second of these.
    const upright = halfWidth(stroke(0, 0), 1);
    const along = halfWidth(stroke(1, 0), 1);
    const across = halfWidth(stroke(0, 1), 1);

    expect(along).toBeCloseTo(upright, 5);
    expect(across / upright).toBeGreaterThan(2);
    expect(across / upright).toBeLessThan(2.3);
  });

  it('scales with the setting and vanishes at zero', () => {
    const upright = halfWidth(stroke(0, 0), 1);
    expect(halfWidth(stroke(0, 1), 0)).toBeCloseTo(upright, 5);
    const half = halfWidth(stroke(0, 1), 0.5);
    expect(half).toBeGreaterThan(upright);
    expect(half).toBeLessThan(halfWidth(stroke(0, 1), 1));
  });

  it('leaves strokes saved without tilt exactly as they were', () => {
    // Absent channels are not zero-tilt samples that happen to agree; they are
    // strokes drawn before tilt was read, and must render identically whatever
    // the current preference is.
    const legacy: DrawPoint[] = Array.from({ length: 40 }, (_, i) => ({
      x: i * 2,
      y: 0,
      pressure: 0.5,
    }));
    expect(getInkPathData(legacy, 10, true, { ...dynamics, tiltAmount: 1 })).toBe(
      getInkPathData(legacy, 10, true, { ...dynamics, tiltAmount: 0 }),
    );
  });
});

describe('pressure response curves', () => {
  const points: DrawPoint[] = Array.from({ length: 40 }, (_, i) => ({
    x: i * 2,
    y: 0,
    pressure: 0.5,
  }));
  const width = (pressureEasing: 'soft' | 'smoothstep' | 'firm'): number =>
    maxAbsPathY(
      getInkPathData(points, 10, true, {
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0,
        startTaper: 0,
        endTaper: false,
        pressureEasing,
      }),
    );

  it('orders soft, medium and firm by how readily they give width', () => {
    // The point of the preference is that the same hand gets a different line,
    // so the three have to be separated by something a person would notice —
    // not by a percent that only a test can see.
    expect(width('soft')).toBeGreaterThan(width('smoothstep') * 1.2);
    expect(width('firm')).toBeLessThan(width('smoothstep') * 0.8);
  });
});

describe('lift taper', () => {
  it('gives a slow lift no taper and a flick a long one', () => {
    // A hand that stops and lifts has drawn a stroke that ends; only one still
    // moving has drawn one that trails off.
    expect(liftTaperFor(0.05, 10, 1000)).toBe(0);
    expect(liftTaperFor(LIFT_TAPER_MIN_SPEED, 10, 1000)).toBe(0);
    expect(liftTaperFor(LIFT_TAPER_FULL_SPEED, 10, 1000)).toBe(
      10 * LIFT_TAPER_MAX_WIDTHS,
    );
    expect(liftTaperFor(99, 10, 1000)).toBe(10 * LIFT_TAPER_MAX_WIDTHS);
  });

  it('scales the taper with the brush', () => {
    const fast = LIFT_TAPER_FULL_SPEED;
    expect(liftTaperFor(fast, 20, 1000)).toBe(2 * liftTaperFor(fast, 10, 1000));
  });

  it('never lets a short tick be swallowed by its own taper', () => {
    // A decimal point flicked off at speed is shorter than the taper the speed
    // earns; without the cap it comes out a sliver pointed at both ends.
    expect(liftTaperFor(99, 10, 8)).toBe(8 * LIFT_TAPER_MAX_STROKE_FRACTION);
  });

  it('reads a broken speed as no lift at all', () => {
    expect(liftTaperFor(Number.NaN, 10, 100)).toBe(0);
  });
});

/**
 * Points along the curve a path actually draws — the quadratics evaluated,
 * not the control net they are steered by.
 *
 * The net is the wrong thing to measure a simplification against: it is the
 * hull the curve sits inside, so it reads high where the curve bulges past a
 * dropped vertex and low where the curve cuts a corner the net still turns.
 * The second is the case this bound exists for.
 */
function curveSamples(d: string, per = 6): { x: number; y: number }[] {
  const tokens = d.match(/[Mqta]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let controlX = 0;
  let controlY = 0;
  let hasControl = false;
  let i = 0;
  const quadratic = (
    x0: number,
    y0: number,
    qx: number,
    qy: number,
    x1: number,
    y1: number,
  ) => {
    for (let step = 1; step <= per; step++) {
      const t = step / per;
      const u = 1 - t;
      points.push({
        x: u * u * x0 + 2 * u * t * qx + t * t * x1,
        y: u * u * y0 + 2 * u * t * qy + t * t * y1,
      });
    }
  };
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M') {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
      points.push({ x, y });
      hasControl = false;
    } else if (command === 'q' || command === 't') {
      const qx =
        command === 'q'
          ? x + Number(tokens[i++])
          : hasControl
            ? 2 * x - controlX
            : x;
      const qy =
        command === 'q'
          ? y + Number(tokens[i++])
          : hasControl
            ? 2 * y - controlY
            : y;
      const nextX = x + Number(tokens[i++]);
      const nextY = y + Number(tokens[i++]);
      quadratic(x, y, qx, qy, nextX, nextY);
      controlX = qx;
      controlY = qy;
      x = nextX;
      y = nextY;
      hasControl = true;
    } else if (command === 'a') {
      i += 5;
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
      points.push({ x, y });
      hasControl = false;
    }
  }
  return points;
}

/** Greatest distance from any point of `exact` to the polyline `simplified`. */
function maxDeviation(
  exact: { x: number; y: number }[],
  simplified: { x: number; y: number }[],
): number {
  let worst = 0;
  for (const point of exact) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 1; i < simplified.length; i++) {
      const a = simplified[i - 1]!;
      const b = simplified[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      let t =
        lengthSquared > 0
          ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
          : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const offsetX = point.x - (a.x + t * dx);
      const offsetY = point.y - (a.y + t * dy);
      nearest = Math.min(nearest, Math.hypot(offsetX, offsetY));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

const commandCount = (d: string) => (d.match(/[Mqta]/g) ?? []).length;

describe('screen-referenced simplification', () => {
  const dynamics = {
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
    startTaper: 0,
    endTaper: false as const,
  };
  // A spiral, not a straight run or a single corner: a straight run coarsens
  // under any rule at all, so it cannot tell a bounded perpendicular error
  // apart from a minimum-spacing one. Curvature everywhere is the case the
  // bound has to hold on.
  const spiral = Array.from({ length: 160 }, (_, index) => {
    const angle = index / 7;
    const radius = 12 + index / 3;
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      pressure: 0.5,
    };
  });

  /**
   * Wandering walks at the spacing a hand actually leaves, which is where the
   * bound is hardest to hold: a coarsely sampled stroke gives the simplifier
   * long runs to collapse, and the curve drawn through what survives cuts the
   * corner by several times what the dropped points were allowed. The spiral
   * above never puts it under half that strain.
   */
  const walks = (() => {
    let seed = 987654321;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return Array.from({ length: 24 }, () => {
      let x = 0;
      let y = 0;
      let angle = random() * 6.28;
      return Array.from({ length: 30 }, () => {
        angle += (random() - 0.5) * 1.2;
        x += Math.cos(angle) * 6;
        y += Math.sin(angle) * 6;
        return { x, y, pressure: 0.4 + 0.4 * random() };
      });
    });
  })();

  it('renders exactly the same outline when no error is allowed', () => {
    expect(getInkPathData(spiral, 8, true, dynamics, 0)).toBe(
      getInkPathData(spiral, 8, true, dynamics),
    );
  });

  it('spends fewer path commands as the error budget grows', () => {
    const exact = commandCount(getInkPathData(spiral, 8, true, dynamics));
    const loose = commandCount(getInkPathData(spiral, 8, true, dynamics, 0.8));
    const looser = commandCount(getInkPathData(spiral, 8, true, dynamics, 3.2));

    expect(loose).toBeLessThan(exact);
    expect(looser).toBeLessThan(loose);
  });

  it('holds the drawn outline inside its on-screen budget at every band', () => {
    // The end-to-end promise, in the units it is made in — and the only thing
    // that says `CURVE_SAG_FACTOR` is big enough, since the tolerance the
    // simplifier is handed is not the distance the drawn ink ends up moving.
    //
    // The ceiling carries a quarter-pixel of headroom over the budget and that
    // headroom is load-bearing: one wandering fixture reaches 0.40px, and it
    // does so at every factor tried between 3 and 4, so the last of it is not
    // the budget at all — it is a stroke whose caps and endpoint run get
    // rebuilt the moment any simplification happens. Tightening the divisor
    // does not move it; only the tail beneath it moves.
    const CEILING = INK_ERROR_SCREEN_PX + 0.1;
    for (const stroke of [spiral, ...walks]) {
      for (const size of [2, 8, 32]) {
        const exact = curveSamples(getInkPathData(stroke, size, true, dynamics));
        for (const zoom of [0.49, 0.3, 0.24, 0.12, 0.06]) {
          const simplified = curveSamples(
            getInkPathData(stroke, size, true, dynamics, inkErrorLimit(zoom)),
          );
          expect(maxDeviation(exact, simplified) * zoom).toBeLessThanOrEqual(
            CEILING,
          );
        }
      }
    }
  });

  it('coarsens the painted centerline without moving the dash spacing', () => {
    const exact = getInkCenterlineGeometry(spiral, 8, 0.5, undefined, true, 0);
    const simplified = getInkCenterlineGeometry(
      spiral,
      8,
      0.5,
      undefined,
      true,
      inkErrorLimit(0.12),
    );

    expect(commandCount(simplified.path)).toBeLessThan(
      commandCount(exact.path),
    );
    // Dashes are distributed along the conditioned samples, which the budget
    // must not touch: a dashed stroke may not re-space itself on a zoom.
    expect(simplified.length).toBe(exact.length);
    expect(
      maxDeviation(curveSamples(exact.path), curveSamples(simplified.path)) *
        0.12,
    ).toBeLessThanOrEqual(INK_ERROR_SCREEN_PX);
  });
});
