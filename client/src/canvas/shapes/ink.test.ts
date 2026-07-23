import { describe, expect, it } from 'vitest';
import { DEFAULT_PENCIL_DYNAMICS, getInkPathData } from './ink';

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

  it('defaults to a stable, round-capped pencil', () => {
    expect(DEFAULT_PENCIL_DYNAMICS.simulatePressure).toBe(false);
    expect(DEFAULT_PENCIL_DYNAMICS.endTaper).toBe(false);
  });
});
