import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PENCIL_DYNAMICS,
  getInkCenterlinePath,
  getInkPathData,
} from './ink';
import { buildInkCenterline } from './ink-engine';

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
    const path = getInkPathData(
      points,
      6,
      true,
      { ...dynamics, startTaper: true, endTaper: true },
    );
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
  let greatest = Number.NEGATIVE_INFINITY;
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++]!;
    if (command === 'M') {
      x = Number(tokens[i++]);
      y = Number(tokens[i++]);
    } else if (command === 'q') {
      const controlX = x + Number(tokens[i++]);
      const controlY = y + Number(tokens[i++]);
      greatest = Math.max(greatest, measure(controlX, controlY));
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    } else if (command === 't') {
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    } else if (command === 'a') {
      i += 5;
      x += Number(tokens[i++]);
      y += Number(tokens[i++]);
    }
    greatest = Math.max(greatest, measure(x, y));
  }
  return greatest;
}

/** Walk a path's command endpoints, returning the greatest `measure`. */
function walkPath(d: string, measure: (x: number, y: number) => number): number {
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

  /** The same line every time; only the sample spacing changes. */
  const ramp = (spacing: number, length = 80) => {
    const steps = Math.round(length / spacing);
    return Array.from({ length: steps + 1 }, (_, index) => ({
      x: (index * length) / steps,
      y: 0,
      pressure: 0.5,
    }));
  };

  it('trails the pointer when the endpoint is left unpinned', () => {
    // The unpinned form the engine still supports: every point, including the
    // tip, sits on the filter. Documented so the contrast stays visible.
    const points = ramp(1);
    const pinned = maxPathX(getInkPathData(points, 10, true, stabilized));
    const trailing = maxPathX(getInkPathData(points, 10, false, stabilized));

    expect(trailing).toBeLessThan(pinned - 2);
  });

  it('lags by the same distance however fast the line was drawn', () => {
    // Sample spacing is a record of hand speed, not of the line's shape.
    // Filtering once per sample rather than per unit travelled put the tip of
    // this 120-unit line at 107 when it was drawn slowly and at 55 when it was
    // drawn quickly — and rounded off fast corners to match.
    const careful = maxPathX(getInkPathData(ramp(4, 120), 10, false, stabilized));
    const quick = maxPathX(getInkPathData(ramp(20, 120), 10, false, stabilized));

    expect(Math.abs(quick - careful)).toBeLessThan(3);
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

  it('follows the raw samples when stabilization is off', () => {
    expect(getInkCenterlinePath(wobble, 6, 0)).toBe(
      'M 0.00 0.00 Q 10.00 6.00 15.00 3.00 L 20.00 0.00',
    );
  });

  it('stabilizes dashed ink like the solid engine does', () => {
    // Dashed strokes used to render straight off the raw points, so the
    // pencil-stabilization setting silently did nothing for them.
    expect(getInkCenterlinePath(wobble, 6, 0.9)).not.toBe(
      getInkCenterlinePath(wobble, 6, 0),
    );
  });

  it('still ends on the raw lift point at any stabilization', () => {
    expect(getInkCenterlinePath(wobble, 6, 0.9).endsWith('L 20.00 0.00')).toBe(
      true,
    );
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
