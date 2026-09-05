/**
 * Snapshotting the shape layer for the duration of a camera gesture.
 *
 * Moving the camera today re-rasterizes every visible stroke: the shape layer's
 * world `<g>` carries the camera as a `transform` attribute, and changing that
 * attribute is a content change, so the browser re-fills every path at the new
 * position and scale sixty times a second. That cost is proportional to how
 * much ink is on screen, and it is the whole reason a large page stops holding
 * its frame rate under a pan.
 *
 * A snapshot breaks the link. The visible shapes are rasterized *once*, into a
 * bitmap, and every frame after that moves those pixels with a compositor
 * transform — a fixed cost that doesn't care how many strokes are in them. The
 * shape layer itself is hidden and its transform frozen, so it contributes
 * nothing until the gesture settles and the vectors paint again, sharp.
 *
 * The soft, resampled look of a magnified bitmap is a *consequence* of this,
 * not the mechanism. Blurring or pixelating the live vector content is strictly
 * slower — a filter is an extra pass on top of the rasterization it was
 * supposed to replace.
 */

// TEMPORARY perf harness import — delete with ./zoom-bench.ts.
import { benchCounters, useBenchFlags } from './bench-flags';
import { cameraTranslation, type Camera } from './camera';
import { createCssVarResolver } from './css-vars';
import { CULL_OVERSCAN } from './geometry';
import { paintSvgInto } from './svg-raster';

/**
 * How far past each viewport edge the capture reaches, as a fraction of the
 * viewport, so a pan has somewhere to go before it runs off the bitmap.
 *
 * Tied to the cull overscan rather than chosen freely: the shape layer only
 * mounts shapes within that margin, so capturing wider would capture blank.
 */
const OVERSCAN = CULL_OVERSCAN;

/**
 * Capture resolution as a fraction of the device pixel ratio.
 *
 * This is the dial the resampled look comes off. At 0.5 on a 2x display the
 * bitmap holds one sample per CSS pixel, so the board goes visibly soft the
 * moment it starts moving and snaps back when it stops.
 */
const SUPERSAMPLE = 0.5;

/** Beyond this much magnification of the captured pixels, re-capture instead. */
const MAX_MAGNIFY = 2;

/** Ceiling on the bitmap, so a large display can't allocate an absurd canvas. */
const MAX_PIXELS = 16e6;

/**
 * Visible-shape count below which capturing isn't worth its own cost. A sparse
 * page rasterizes in well under a frame; paying a capture to avoid that would
 * be a net loss, and would put a soft frame on a board that never dropped one.
 */
export const MIN_SNAPSHOT_SHAPES = 200;

/** Everything about where a capture sits, without the pixels themselves. */
export interface SnapshotPlacement {
  /** The camera the capture was rasterized at. */
  camera: Camera;
  /** CSS-pixel overscan on each side. */
  marginX: number;
  marginY: number;
  /** CSS-pixel size of the viewport the capture was taken for. */
  viewportWidth: number;
  viewportHeight: number;
}

/** A rasterized shape layer, and the camera it was rasterized at. */
export interface CameraSnapshot extends SnapshotPlacement {
  canvas: HTMLCanvasElement;
}

/** Bitmap sizing for a viewport: overscan margins and capture resolution. */
export function captureGeometry(
  width: number,
  height: number,
  dpr: number,
): { marginX: number; marginY: number; pixelScale: number } {
  const marginX = Math.round(width * OVERSCAN);
  const marginY = Math.round(height * OVERSCAN);
  const cssWidth = width + marginX * 2;
  const cssHeight = height + marginY * 2;
  const wanted = Math.max(dpr, 0.1) * SUPERSAMPLE;
  const ceiling = Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight));
  return { marginX, marginY, pixelScale: Math.min(wanted, ceiling) };
}

/**
 * The CSS transform that puts a snapshot's pixels where the live shape layer
 * would be at `camera`.
 *
 * A world point `p` sits at canvas-local `p * z0 + e0 + margin`, and belongs on
 * screen at `p * z1 + e1`. Both translations come from
 * {@link cameraTranslation} so the bitmap inherits the same device-pixel snap
 * the shape layer uses — reproducing that snap by hand would leave the capture
 * up to half a pixel out, which reads as a jump at each end of the gesture.
 */
export function snapshotTransform(
  snapshot: SnapshotPlacement,
  camera: Camera,
): string {
  const from = cameraTranslation(snapshot.camera);
  const to = cameraTranslation(camera);
  const k = camera.z / snapshot.camera.z;
  const tx = to.e - k * (from.e + snapshot.marginX);
  const ty = to.f - k * (from.f + snapshot.marginY);
  return `translate(${tx}px, ${ty}px) scale(${k})`;
}

/**
 * Whether `snapshot` still has pixels for everything `camera` shows, and hasn't
 * been magnified past the point where the resampling stops reading as motion.
 */
export function snapshotCovers(
  snapshot: SnapshotPlacement,
  camera: Camera,
  width: number,
  height: number,
): boolean {
  if (camera.z / snapshot.camera.z > MAX_MAGNIFY) return false;
  const { e, f } = cameraTranslation(snapshot.camera);
  const z = snapshot.camera.z;
  // World rect the bitmap holds, from its own camera and margins.
  const heldMinX = (-e - snapshot.marginX) / z;
  const heldMinY = (-f - snapshot.marginY) / z;
  const heldMaxX = (-e + snapshot.viewportWidth + snapshot.marginX) / z;
  const heldMaxY = (-f + snapshot.viewportHeight + snapshot.marginY) / z;
  return (
    camera.x >= heldMinX &&
    camera.y >= heldMinY &&
    camera.x + width / camera.z <= heldMaxX &&
    camera.y + height / camera.z <= heldMaxY
  );
}

/**
 * Rasterize the shape layer's world group into a bitmap for `camera`.
 *
 * `world` is the `<g>` that normally carries the camera transform; its own
 * transform is ignored and applied here instead, so a re-capture mid-gesture
 * isn't stuck with the frozen transform the previous snapshot left on it.
 *
 * Returns null when there is nothing to capture into — a zero-sized viewport,
 * or a context the browser declines to give.
 */
export function captureShapeLayer(
  world: SVGGElement,
  camera: Camera,
  width: number,
  height: number,
  paths: WeakMap<Element, { key: string; path: Path2D }>,
): CameraSnapshot | null {
  if (width <= 0 || height <= 0) return null;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const { marginX, marginY, pixelScale } = captureGeometry(width, height, dpr);
  const cssWidth = width + marginX * 2;
  const cssHeight = height + marginY * 2;

  // TEMPORARY bench instrumentation.
  const __t0 = performance.now();

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cssWidth * pixelScale));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelScale));
  // The bitmap is laid over the viewport at its natural CSS size and moved from
  // its own top-left corner, which is what `snapshotTransform` solves for.
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.transformOrigin = '0 0';
  // TEMPORARY bench flag — delete with ./zoom-bench.ts.
  if (useBenchFlags.getState().willChange) {
    canvas.style.willChange = 'transform';
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { e, f } = cameraTranslation(camera);
  ctx.setTransform(
    pixelScale * camera.z,
    0,
    0,
    pixelScale * camera.z,
    (e + marginX) * pixelScale,
    (f + marginY) * pixelScale,
  );
  paintSvgInto(ctx, world, {
    resolveVar: createCssVarResolver(),
    viewport: { w: cssWidth, h: cssHeight },
    paths,
    // The camera's zoom is applied above, in place of the transform the world
    // group normally carries, so seed the walk with it.
    scale: camera.z,
  });

  // TEMPORARY bench instrumentation.
  benchCounters.caps.push(performance.now() - __t0);

  return {
    canvas,
    camera,
    marginX,
    marginY,
    viewportWidth: width,
    viewportHeight: height,
  };
}
