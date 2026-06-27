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
    const path = getInkPathData([{ x: 10, y: 20, pressure: 0.5 }], 8, true, dynamics);

    expect(path).toMatch(/^M /);
    expect(path).toContain(' Q ');
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('uses a closed variable-width outline', () => {
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

    expect(path).toContain(' Q ');
    expect(path).not.toContain('NaN');
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('handles sharp reversals without invalid path data', () => {
    const path = getInkPathData(
      [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 0, pressure: 0.5 },
        { x: 1, y: 0, pressure: 0.5 },
      ],
      8,
      true,
      { ...dynamics, streamline: 0.9 },
    );

    expect(path).not.toContain('NaN');
    expect(path).not.toContain('Infinity');
    expect(path.endsWith(' Z')).toBe(true);
  });

  it('defaults to a stable, round-capped pencil', () => {
    expect(DEFAULT_PENCIL_DYNAMICS.simulatePressure).toBe(false);
    expect(DEFAULT_PENCIL_DYNAMICS.endTaper).toBe(false);
  });
});
