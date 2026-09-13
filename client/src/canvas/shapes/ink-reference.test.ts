import { describe, expect, it } from 'vitest';
import { buildInkCenterline } from './ink-engine';
import { getInkPathData } from './ink';
import { buildInkRender, drawUtil } from './draw';

const dynamics = {
  inkAlgorithm: 'reference' as const,
  streamline: 0,
  thinning: 0.5,
  pressureEasing: 'linear' as const,
};

describe('reference ink pipeline', () => {
  it('keeps the live tip filtered and pins it only at completion, including dashes', () => {
    const points = [0, 20, 40, 60].map((x) => ({ x, y: 0, pressure: 0.5 }));
    for (const dash of ['solid', 'dashed'] as const) {
      const props = { ...drawUtil.getDefaultProps(), ...dynamics, points, streamline: 0.5, dash, isComplete: false };
      const live = buildInkRender(props, points, true, 0);
      const remote = buildInkRender(props, points, false, 0);
      const done = buildInkRender({ ...props, isComplete: true }, points, false, 0);
      expect(live.d).toBe(remote.d);
      expect(done.d).not.toBe(live.d);
      expect(done.d).toBe(buildInkRender({ ...props, isComplete: undefined }, points, false, 0).d);
    }
  });

  it('uses constant-width centerlines for highlights and retains tap dots', () => {
    const points = [0, 20, 40, 60].map((x) => ({ x, y: 0 }));
    const props = { ...drawUtil.getDefaultProps(), ...dynamics, points, inkKind: 'highlight' as const, thinning: 0 };
    expect(buildInkRender(props, points, false, 0).stroked).toBe(true);
    const dot = buildInkRender(props, points.slice(0, 1), false, 0);
    expect(dot.stroked).toBe(false);
    expect(dot.d).toMatch(/^M /);
  });

  it('does not reshape legacy ink when a completion flag is absent', () => {
    const points = [0, 20, 40, 60].map((x) => ({ x, y: 0 }));
    const props = { ...drawUtil.getDefaultProps(), points };
    expect(buildInkRender(props, points, true, 0).d).toBe(buildInkRender(props, points, false, 0).d);
  });
  it('applies the specified per-sample IIR weight and pins the completed endpoint', () => {
    const points = [0, 20, 40, 60].map((x) => ({ x, y: 0, pressure: 0.5 }));
    const line = buildInkCenterline(points, 1, 0.5, true, 'reference');
    expect(line.count).toBe(4);
    expect(line.x[1]).toBeCloseTo(20 * 0.575);
    expect(line.x[2]).toBeCloseTo(40 * 0.575 + 20 * 0.575 * 0.425);
    expect(line.x[3]).toBe(60);
  });

  it('culls endpoint noise using a third of the brush diameter', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 1 },
      { x: 40, y: 0 },
    ];
    const line = buildInkCenterline(points, 30, 0, true, 'reference');
    expect(line.count).toBe(2);
    expect(Array.from(line.x.slice(0, line.count))).toEqual([0, 40]);
  });

  it('splits dense bends by radius while leaving a sparse bend continuous', () => {
    const path = (spacing: number) =>
      getInkPathData(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40 + spacing, y: 0 },
          { x: 40 + spacing, y: spacing },
          { x: 40 + spacing, y: 50 },
        ],
        8,
        true,
        dynamics,
      );
    expect(path(2).match(/M /g)!.length).toBeGreaterThan(1);
    expect(path(20).match(/M /g)).toHaveLength(1);
  });

  it('produces finite closed paths for dots, hairpins, tapers, and buffer growth', () => {
    const dot = getInkPathData([{ x: 0, y: 0 }], 8, true, dynamics);
    for (const count of [1, 2, 600, 1400]) {
      const points = Array.from({ length: count }, (_, i) => ({
        x: i * 3,
        y: i % 3 === 0 ? 20 : 0,
        pressure: (i % 10) / 10,
      }));
      const path = getInkPathData(points, 8, true, {
        ...dynamics,
        simulatePressure: true,
        startTaper: 4,
        endTaper: 8,
      });
      expect(path).toMatch(/^M /);
      expect(path.endsWith(' Z')).toBe(true);
      expect(path).not.toMatch(/NaN|Infinity/);
      // A subsequent small stroke must not inherit any shared-buffer state.
      expect(getInkPathData([{ x: 0, y: 0 }], 8, true, dynamics)).toBe(dot);
    }
  });

  it('warms simulated pressure from the opening travel', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i * 8, y: 0 }));
    const simulated = getInkPathData(points, 8, true, {
      ...dynamics,
      simulatePressure: true,
    });
    const neutral = getInkPathData(points, 8, true, dynamics);
    expect(simulated).not.toBe(neutral);
    const opening = (path: string) => Math.abs(Number(path.split(' ')[2]));
    expect(opening(simulated)).toBeLessThan(opening(neutral));
  });
});
