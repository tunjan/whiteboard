// Quick Zoom: hold Z and press to pull back far enough to see the whole board,
// frame somewhere with the pointer, release to fly there. Traversing a large
// board without repeatedly zooming out and back in by hand.

import { MIN_ZOOM, clampZoom, type Camera, type Point } from './camera';
import type { Bounds } from './geometry';

/** Leaves a margin around the content rather than fitting it edge to edge. */
export const QUICK_ZOOM_INSET = 0.85;

/**
 * The zoom that pulls back until every edge of `bounds` is on screen *while the
 * world point under the pointer stays put*. Each term is the zoom at which one
 * edge of the content reaches its side of the viewport, measured from the
 * stationary cursor; the smallest of them is the one that fits all four.
 *
 * Never zooms in: an overview that magnified would be a surprise, not an
 * overview.
 */
export function quickZoomOverviewZoom(
  camera: Camera,
  pointer: Point,
  viewportW: number,
  viewportH: number,
  bounds: Bounds,
): number {
  const world = {
    x: pointer.x / camera.z + camera.x,
    y: pointer.y / camera.z + camera.y,
  };
  const limits = [
    { span: world.x - bounds.minX, room: pointer.x },
    { span: bounds.maxX - world.x, room: viewportW - pointer.x },
    { span: world.y - bounds.minY, room: pointer.y },
    { span: bounds.maxY - world.y, room: viewportH - pointer.y },
  ];
  let zoom = camera.z;
  for (const { span, room } of limits) {
    // A negative span means that edge is already behind the cursor, and a zero
    // room means the cursor is flat against that side of the viewport — neither
    // constrains the fit.
    if (span > 0 && room > 0) zoom = Math.min(zoom, room / span);
  }
  return Math.max(MIN_ZOOM, clampZoom(zoom * QUICK_ZOOM_INSET));
}

/**
 * Screen size of the frame drawn under the pointer during the gesture: the
 * region that will fill the viewport once the camera returns to `targetZoom`.
 */
export function quickZoomFrameSize(
  overviewZoom: number,
  targetZoom: number,
  viewportW: number,
  viewportH: number,
): { width: number; height: number } {
  const scale = overviewZoom / targetZoom;
  return { width: viewportW * scale, height: viewportH * scale };
}

/** Union of the visible page bounds with the board's content bounds. */
export function quickZoomBounds(
  viewport: Bounds,
  content: Bounds | null,
): Bounds {
  if (!content) return viewport;
  return {
    minX: Math.min(viewport.minX, content.minX),
    minY: Math.min(viewport.minY, content.minY),
    maxX: Math.max(viewport.maxX, content.maxX),
    maxY: Math.max(viewport.maxY, content.maxY),
  };
}
