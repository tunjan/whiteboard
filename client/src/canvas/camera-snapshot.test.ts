import { describe, expect, it } from 'vitest';
import { cameraTranslation, type Camera } from './camera';
import {
  captureGeometry,
  snapshotCovers,
  snapshotTransform,
  type SnapshotPlacement,
} from './camera-snapshot';

const W = 1000;
const H = 600;

function placementAt(camera: Camera): SnapshotPlacement {
  const { marginX, marginY } = captureGeometry(W, H, 2);
  return {
    camera,
    marginX,
    marginY,
    viewportWidth: W,
    viewportHeight: H,
  };
}

/** Parse the transform back into the two numbers it encodes. */
function parse(transform: string): { tx: number; ty: number; k: number } {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.e]+)\)/.exec(
    transform,
  );
  if (!m) throw new Error(`unparsable transform: ${transform}`);
  return { tx: +m[1]!, ty: +m[2]!, k: +m[3]! };
}

/** Where the live shape layer puts the world point `p`, in viewport px. */
function live(camera: Camera, p: { x: number; y: number }) {
  const { e, f } = cameraTranslation(camera);
  return { x: p.x * camera.z + e, y: p.y * camera.z + f };
}

/** Where the moved snapshot puts the same world point. */
function viaSnapshot(
  placement: SnapshotPlacement,
  camera: Camera,
  p: { x: number; y: number },
) {
  const { tx, ty, k } = parse(snapshotTransform(placement, camera));
  const { e, f } = cameraTranslation(placement.camera);
  // Where the point sits inside the bitmap, in the canvas's own CSS pixels.
  const localX = p.x * placement.camera.z + e + placement.marginX;
  const localY = p.y * placement.camera.z + f + placement.marginY;
  return { x: k * localX + tx, y: k * localY + ty };
}

describe('snapshotTransform', () => {
  const captured: Camera = { x: 120, y: -40, z: 0.75 };
  const placement = placementAt(captured);
  const probes = [
    { x: 0, y: 0 },
    { x: 512, y: 384 },
    { x: -900.25, y: 61.5 },
  ];

  // The whole point of the layer: while it is up, the pixels must sit exactly
  // where the vectors would have. Anything else reads as a jump into and out
  // of every gesture.
  it.each([
    ['unmoved', captured],
    ['panned', { x: 300, y: 90, z: 0.75 }],
    ['zoomed in', { x: 120, y: -40, z: 1.5 }],
    ['zoomed out', { x: 120, y: -40, z: 0.4 }],
    ['panned and zoomed', { x: -55.5, y: 210.25, z: 1.1 }],
  ] satisfies [string, Camera][])(
    'places world points where the live layer would (%s)',
    (_label, camera) => {
      for (const p of probes) {
        const expected = live(camera, p);
        const actual = viaSnapshot(placement, camera, p);
        expect(actual.x).toBeCloseTo(expected.x, 6);
        expect(actual.y).toBeCloseTo(expected.y, 6);
      }
    },
  );

  it('parks the bitmap over its own margin when nothing has moved', () => {
    const { tx, ty, k } = parse(snapshotTransform(placement, captured));
    expect(k).toBe(1);
    expect(tx).toBeCloseTo(-placement.marginX, 6);
    expect(ty).toBeCloseTo(-placement.marginY, 6);
  });

  it('scales by the ratio of the zooms', () => {
    const { k } = parse(
      snapshotTransform(placement, { ...captured, z: captured.z * 2 }),
    );
    expect(k).toBeCloseTo(2, 6);
  });
});

describe('snapshotCovers', () => {
  const captured: Camera = { x: 0, y: 0, z: 1 };
  const placement = placementAt(captured);
  // captureGeometry overscans by a quarter of the viewport on each side.
  const marginWorld = placement.marginX / captured.z;

  it('covers the viewport it was captured for', () => {
    expect(snapshotCovers(placement, captured, W, H)).toBe(true);
  });

  it('covers a pan that stays inside the overscan', () => {
    const camera = { ...captured, x: marginWorld - 1, y: 0 };
    expect(snapshotCovers(placement, camera, W, H)).toBe(true);
  });

  it('does not cover a pan past the overscan', () => {
    const camera = { ...captured, x: marginWorld + 1, y: 0 };
    expect(snapshotCovers(placement, camera, W, H)).toBe(false);
    const up = { ...captured, y: -(placement.marginY + 1) };
    expect(snapshotCovers(placement, up, W, H)).toBe(false);
  });

  it('does not cover a zoom out that reveals more world than was captured', () => {
    expect(snapshotCovers(placement, { ...captured, z: 0.5 }, W, H)).toBe(
      false,
    );
  });

  // Past a point the resampling stops reading as motion and starts reading as
  // a broken render, so a deep zoom re-captures rather than magnifying on.
  it('does not cover a zoom in beyond the magnification cap', () => {
    expect(snapshotCovers(placement, { ...captured, z: 2 }, W, H)).toBe(true);
    expect(snapshotCovers(placement, { ...captured, z: 2.01 }, W, H)).toBe(
      false,
    );
  });
});

describe('captureGeometry', () => {
  it('overscans a quarter of the viewport on each side', () => {
    const { marginX, marginY } = captureGeometry(1000, 600, 2);
    expect(marginX).toBe(250);
    expect(marginY).toBe(150);
  });

  it('captures at half the device pixel ratio', () => {
    expect(captureGeometry(1000, 600, 2).pixelScale).toBeCloseTo(1, 6);
    expect(captureGeometry(1000, 600, 1).pixelScale).toBeCloseTo(0.5, 6);
  });

  it('drops the resolution rather than allocating an unbounded bitmap', () => {
    const { marginX, marginY, pixelScale } = captureGeometry(7680, 4320, 3);
    const pixels =
      (7680 + marginX * 2) * (4320 + marginY * 2) * pixelScale ** 2;
    expect(pixelScale).toBeLessThan(3 * 0.5);
    expect(pixels).toBeLessThanOrEqual(16e6 + 1);
  });
});
