import { describe, expect, it } from 'vitest';
import type { RectangleShape } from '@whiteboard/shared';
import './register';
import {
  bindingForPoint,
  orthogonalRoute,
  pointForBinding,
} from './connector-routing';

function rectangle(overrides: Partial<RectangleShape> = {}): RectangleShape {
  return {
    id: 'target',
    type: 'rectangle',
    x: 100,
    y: 100,
    rotation: 0,
    index: 'a0',
    props: {
      w: 200,
      h: 100,
      color: '#000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
    ...overrides,
  };
}

describe('connector binding and elbow routing', () => {
  it('projects an interior terminal to the target perimeter', () => {
    const target = rectangle();
    const result = bindingForPoint(
      target,
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    );
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(100, 5);
    expect(result!.point.y).toBeCloseTo(150, 5);
    expect(result!.binding.anchor.x).toBeCloseTo(0.001, 5);
  });

  it('keeps a normalized binding attached after move and resize', () => {
    const initial = rectangle();
    const result = bindingForPoint(
      initial,
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    )!;
    const moved = rectangle({ x: 300, y: 250, props: { ...initial.props, w: 300 } });
    const point = pointForBinding(result.binding, moved)!;
    expect(point.x).toBeCloseTo(300.3, 4);
    expect(point.y).toBeCloseTo(300, 4);
  });

  it('produces only axis-aligned segments and routes around inflated targets', () => {
    const route = orthogonalRoute(
      { x: 100, y: 40 },
      { x: 280, y: 180 },
      {
        startBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        endBounds: { minX: 280, minY: 120, maxX: 380, maxY: 220 },
        startDirection: { x: 1, y: 0 },
        endDirection: { x: -1, y: 0 },
      },
    );
    expect(route.length).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[index]!;
      const b = route[index + 1]!;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
    }
  });

  it('honors outward terminal directions even when endpoints are aligned', () => {
    const route = orthogonalRoute(
      { x: 0, y: 50 },
      { x: 300, y: 50 },
      {
        startBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        endBounds: { minX: 200, minY: 0, maxX: 300, maxY: 100 },
        startDirection: { x: -1, y: 0 },
        endDirection: { x: 1, y: 0 },
      },
    );
    expect(route[1]!.x).toBeLessThan(0);
    expect(route[route.length - 2]!.x).toBeGreaterThan(300);
  });
});
