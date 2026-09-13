import { describe, expect, it } from 'vitest';
import { cameraFitZoom, constrainCamera, type CameraConstraints } from './camera-constraints';
import { screenToWorld, worldToScreen } from './camera';

const viewport = { width: 1000, height: 600 };
const bounds = { minX: 100, minY: 200, maxX: 500, maxY: 400 };
const base: CameraConstraints = { bounds, padding: { x: 50, y: 50 }, behavior: 'contain' };

describe('camera constraints', () => {
  it('computes natural fit zooms with pixel padding', () => {
    expect(cameraFitZoom(base, viewport, 'fit-x')).toBe(2.25);
    expect(cameraFitZoom(base, viewport, 'fit-y')).toBe(2.5);
    expect(cameraFitZoom(base, viewport, 'fit-min')).toBe(2.25);
    expect(cameraFitZoom(base, viewport, 'fit-max')).toBe(2.5);
  });

  it('contains small content at its origin and clamps a zoomed-in viewport', () => {
    expect(constrainCamera({ x: 999, y: 999, z: 1 }, undefined, base, viewport)).toEqual({ x: -200, y: 0, z: 1 });
    expect(constrainCamera({ x: 999, y: 999, z: 4 }, undefined, base, viewport)).toEqual({ x: 262.5, y: 262.5, z: 4 });
    expect(constrainCamera({ x: -999, y: -999, z: 4 }, undefined, base, viewport)).toEqual({ x: 87.5, y: 187.5, z: 4 });
  });

  it('supports independent axes and a fixed leading origin', () => {
    const constraints: CameraConstraints = { ...base, behavior: { x: 'fixed', y: 'free' }, origin: { x: 0, y: 1 } };
    expect(constrainCamera({ x: 999, y: 999, z: 1 }, undefined, constraints, viewport)).toEqual({ x: 50, y: 999, z: 1 });
  });

  it('allows small content to move inside the viewport', () => {
    const constraints = { ...base, behavior: 'inside' as const };
    expect(constrainCamera({ x: -999, y: 999, z: 1 }, undefined, constraints, viewport)).toEqual({ x: -450, y: 150, z: 1 });
  });

  it('keeps an edge of the document visible in outside mode', () => {
    const constraints = { ...base, behavior: 'outside' as const };
    expect(constrainCamera({ x: -999, y: 999, z: 1 }, undefined, constraints, viewport)).toEqual({ x: -850, y: 350, z: 1 });
  });

  it('preserves the inferred focal point when a raw camera request is clamped', () => {
    const current = { x: 100, y: -40, z: 1 };
    const anchor = { x: 530, y: 175 };
    const world = screenToWorld(anchor, current);
    for (const requestedZoom of [0.001, 40]) {
      const requested = { x: world.x - anchor.x / requestedZoom, y: world.y - anchor.y / requestedZoom, z: requestedZoom };
      const result = constrainCamera(requested, current);
      const actual = worldToScreen(world, result);
      expect(actual.x).toBeCloseTo(anchor.x);
      expect(actual.y).toBeCloseTo(anchor.y);
    }
  });

  it('sanitizes invalid input without poisoning the live viewport', () => {
    const current = { x: 30, y: -20, z: 2 };
    expect(constrainCamera({ x: NaN, y: Infinity, z: NaN }, current)).toEqual(current);
    expect(constrainCamera({ x: 0, y: 0, z: -3 }, current).z).toBe(0.05);
  });
});
