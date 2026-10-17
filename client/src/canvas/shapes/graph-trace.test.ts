import { expect, it } from 'vitest';
import { nearestOnCurves } from './graph-trace';

const curves = [
  { color: 'red', screens: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]] },
  { color: 'blue', screens: [[{ x: 0, y: 20 }, { x: 100, y: 20 }]] },
];

it('traces the nearest curve, between its vertices', () => {
  expect(nearestOnCurves(curves, { x: 50, y: 6 }, 8)).toEqual({
    point: { x: 50, y: 0 },
    color: 'red',
  });
  expect(nearestOnCurves(curves, { x: 30, y: 15 }, 8)?.color).toBe('blue');
});

it('traces nothing out of reach', () => {
  expect(nearestOnCurves(curves, { x: 50, y: 10 }, 8)).toBeNull();
});
