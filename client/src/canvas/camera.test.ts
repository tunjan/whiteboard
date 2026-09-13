import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cameraToTransform,
  cameraTranslation,
  nextDiscreteZoom,
  interpolateCameraViewport,
  screenToWorld,
  worldToScreen,
  zoomCameraAtScreen,
  zoomCameraAtScreenWithPan,
} from './camera';

describe('camera zoom math', () => {
  it('keeps the screen anchor pinned when zooming', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const anchor = { x: 320, y: 180 };
    const before = screenToWorld(anchor, camera);
    const next = zoomCameraAtScreen(camera, anchor, 4);
    const after = screenToWorld(anchor, next);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('combines pinch zooming with midpoint panning', () => {
    const camera = { x: 20, y: 60, z: 2 };
    const previousMidpoint = { x: 100, y: 140 };
    const midpoint = { x: 128, y: 124 };
    const panDelta = {
      x: midpoint.x - previousMidpoint.x,
      y: midpoint.y - previousMidpoint.y,
    };
    const worldUnderPreviousMidpoint = screenToWorld(previousMidpoint, camera);

    const next = zoomCameraAtScreenWithPan(camera, midpoint, 3, panDelta);
    const screenAfter = worldToScreen(worldUnderPreviousMidpoint, next);

    expect(screenAfter.x).toBeCloseTo(midpoint.x);
    expect(screenAfter.y).toBeCloseTo(midpoint.y);
  });

  // Same-anchor zooms compose multiplicatively away from the zoom limits.
  it('composes successive zooms about one anchor multiplicatively', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const anchor = { x: 320, y: 180 };
    const factors = [1.05, 0.98, 1.11, 1.02];

    const stepped = factors.reduce(
      (c, f) => zoomCameraAtScreen(c, anchor, c.z * f),
      camera,
    );
    const coalesced = zoomCameraAtScreen(
      camera,
      anchor,
      camera.z * factors.reduce((a, f) => a * f, 1),
    );

    expect(coalesced.z).toBeCloseTo(stepped.z);
    expect(coalesced.x).toBeCloseTo(stepped.x);
    expect(coalesced.y).toBeCloseTo(stepped.y);
  });

  it('composes successive screen pans additively at fixed zoom', () => {
    const camera = { x: 120, y: -40, z: 2 };
    const deltas = [
      { x: 12, y: -4 },
      { x: 3, y: 9 },
      { x: -7, y: 2 },
    ];
    // `panByScreen` is the store's thin wrapper over this world-space step.
    let panned = camera;
    for (const d of deltas) {
      panned = { ...panned, x: panned.x + d.x / panned.z, y: panned.y + d.y / panned.z };
    }
    const total = deltas.reduce(
      (a, d) => ({ x: a.x + d.x, y: a.y + d.y }),
      { x: 0, y: 0 },
    );

    expect(panned.x).toBeCloseTo(camera.x + total.x / camera.z);
    expect(panned.y).toBeCloseTo(camera.y + total.y / camera.z);
  });

  it('chooses discrete zoom targets using midpoint thresholds', () => {
    expect(nextDiscreteZoom(1, 'in')).toBe(2);
    expect(nextDiscreteZoom(1, 'out')).toBe(0.5);
    expect(nextDiscreteZoom(1.4, 'in')).toBe(2);
    expect(nextDiscreteZoom(1.6, 'in')).toBe(4);
    expect(nextDiscreteZoom(1.6, 'out')).toBe(1);
  });
});


describe('viewport animation', () => {
  it('linearly interpolates the visible world bounds', () => {
    const from = { x: -300, y: 150, z: 0.1 };
    const to = { x: 250, y: -40, z: 8 };
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const camera = interpolateCameraViewport(from, to, t);
      for (const screen of [{ x: 0, y: 0 }, { x: 1200, y: 800 }]) {
        const a = screenToWorld(screen, from), b = screenToWorld(screen, to);
        const actual = screenToWorld(screen, camera);
        expect(actual.x).toBeCloseTo(a.x + (b.x - a.x) * t);
        expect(actual.y).toBeCloseTo(a.y + (b.y - a.y) * t);
      }
    }
  });

  it('holds the focal point for the entire animation across extreme zooms', () => {
    const from = { x: 180, y: -55, z: 0.05 };
    const anchor = { x: 920, y: 170 };
    const world = screenToWorld(anchor, from);
    const to = zoomCameraAtScreen(from, anchor, 8);
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      const actual = worldToScreen(world, interpolateCameraViewport(from, to, t));
      expect(actual.x).toBeCloseTo(anchor.x);
      expect(actual.y).toBeCloseTo(anchor.y);
    }
  });
});

describe('cameraTranslation', () => {
  // These tests run without a DOM, and `cameraTranslation` falls back to dpr 1
  // when there is no `window` — which is itself a grid, so a test that did not
  // pin the ratio would be asserting against the fallback.
  const dpr = (value: number) => {
    vi.stubGlobal('window', { devicePixelRatio: value });
    return () => vi.unstubAllGlobals();
  };
  afterEach(() => vi.unstubAllGlobals());

  it('snaps to the device-pixel grid by default', () => {
    const restore = dpr(2);
    // -x*z = -(-10.3) = 10.3 CSS px = 20.6 device px -> 21 -> 10.5 CSS px.
    expect(cameraTranslation({ x: -10.3, y: 0, z: 1 }).e).toBeCloseTo(10.5);
    restore();
  });

  it('leaves the translation exact when snapping is off', () => {
    const restore = dpr(2);
    expect(cameraTranslation({ x: -10.3, y: 0, z: 1 }, false).e).toBeCloseTo(
      10.3,
    );
    restore();
  });

  it('quantizes a slow pan when snapping and not when it is off', () => {
    const restore = dpr(2);
    // A third of a CSS pixel per frame: below the 0.5px snapping quantum, so
    // snapped frames stall and then jump, which is the stepping this exists to
    // avoid during a gesture.
    const steps = (snap: boolean) =>
      Array.from({ length: 6 }, (_, i) =>
        cameraTranslation({ x: -i / 3, y: 0, z: 1 }, snap).e,
      );
    const snapped = steps(true);
    const exact = steps(false);
    expect(new Set(snapped.map((n) => n.toFixed(3))).size).toBeLessThan(
      new Set(exact.map((n) => n.toFixed(3))).size,
    );
    // Consecutive exact frames all advance; snapped ones include a dead frame.
    const advanced = (a: number[]) =>
      a.slice(1).filter((n, i) => n !== a[i]!).length;
    expect(advanced(exact)).toBe(5);
    expect(advanced(snapped)).toBeLessThan(5);
    restore();
  });

  it('agrees with cameraToTransform', () => {
    const camera = { x: -10.3, y: 4.7, z: 1.5 };
    for (const snap of [true, false]) {
      const { e, f } = cameraTranslation(camera, snap);
      expect(cameraToTransform(camera, snap)).toBe(
        `matrix(1.5, 0, 0, 1.5, ${e}, ${f})`,
      );
    }
  });
});
