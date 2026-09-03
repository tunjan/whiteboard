import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Camera } from './camera';
import {
  captureShapeLayer,
  snapshotCovers,
  snapshotTransform,
  type CameraSnapshot,
} from './camera-snapshot';

/**
 * Holds a rasterized copy of the shape layer for as long as the camera is
 * moving. See {@link captureShapeLayer} for what that buys and why.
 *
 * The capture is taken in a layout effect, so it reads the shape tree React has
 * just committed and the swap to the bitmap happens before the browser paints —
 * there is no frame where both, or neither, are on screen.
 *
 * `active` is the caller's decision, not just "the camera is moving": a capture
 * is frozen, and freezing the board is only acceptable when the user is the one
 * moving it.
 */
export function useCameraSnapshot({
  worldRef,
  camera,
  width,
  height,
  active,
}: {
  /** The `<g>` carrying the camera transform in the shape layer. */
  worldRef: RefObject<SVGGElement | null>;
  camera: Camera;
  width: number;
  height: number;
  active: boolean;
}): CameraSnapshot | null {
  const [snapshot, setSnapshot] = useState<CameraSnapshot | null>(null);
  // Path2D objects survive across captures: rebuilding them is the expensive
  // half of a capture, and a gesture that re-captures is drawing mostly the
  // same strokes it drew a moment ago.
  const paths = useRef<WeakMap<Element, { key: string; path: Path2D }>>(
    new WeakMap(),
  );

  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!active || !world || width <= 0 || height <= 0) {
      if (snapshot) setSnapshot(null);
      return;
    }
    // A pan that runs off the bitmap's edge, or a zoom that magnifies it past
    // legibility, is re-captured rather than left to show blank or mush.
    if (snapshot && snapshotCovers(snapshot, camera, width, height)) return;
    setSnapshot(captureShapeLayer(world, camera, width, height, paths.current));
  }, [active, camera, width, height, snapshot, worldRef]);

  return snapshot;
}

/**
 * The captured bitmap, laid over the viewport and moved with a compositor
 * transform. The canvas element is owned by the snapshot rather than by React:
 * it is created full of pixels, and re-creating it through JSX would mean
 * re-rasterizing it.
 */
export function CameraSnapshotLayer({
  snapshot,
  camera,
}: {
  snapshot: CameraSnapshot;
  camera: Camera;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.append(snapshot.canvas);
    return () => {
      snapshot.canvas.remove();
    };
  }, [snapshot]);

  useLayoutEffect(() => {
    snapshot.canvas.style.transform = snapshotTransform(snapshot, camera);
  }, [snapshot, camera]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)]"
    />
  );
}
