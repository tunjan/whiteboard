import { create } from 'zustand';
import { LOD_ZOOM_THRESHOLD, type Camera } from './camera';
import { useCameraStore } from './use-camera-store';

/**
 * The camera, reduced to the only things level-of-detail actually depends on.
 *
 * Every mounted shape reads LOD, so whatever LOD subscribes to is subscribed
 * to once per shape on the board. Subscribing them all to the camera store
 * makes a pan — which cannot change any LOD answer, because LOD depends on
 * zoom alone — cost a snapshot check per mounted shape. At 50k shapes that was
 * ~18ms per camera event, and a `setState({})` that changed nothing at all
 * cost the same as a real pan: the work was the notification, not the camera.
 *
 * So the camera is watched once, here, and republished into this store only
 * when a value below actually changes. Pans publish nothing.
 */
export interface LodState {
  /** Stroke sizes strictly below this, in world units, have lost their
   *  sub-pixel detail; 0 keeps every stroke's detail. See
   *  {@link patternCutoff}. */
  patternCutoff: number;
  /** Whether expensive sub-pixel effects (drop shadows) are worth compositing. */
  detail: 'high' | 'low';
  /** World-unit length to give the dots of a dotted stroke; 0 uses round caps. */
  dotLength: number;
  /** Perpendicular error, in world units, an ink path may carry because it is
   *  sub-pixel on screen; 0 renders the exact geometry. See
   *  {@link inkErrorLimit}. */
  inkErrorLimit: number;
}

/** Zoom below which a zero-length dot is too small for the browser to draw. */
const DOT_ZOOM_THRESHOLD = 0.2;

/** Zoom below which a patterned stroke is no longer worth distinguishing. */
const SOLID_LOD_ZOOM = 0.5;

/** On-screen stroke width, in CSS pixels, below which a pattern stops reading. */
const SOLID_LOD_SCREEN_WIDTH = 1.5;

/**
 * The stroke size, in world units, at which sub-pixel detail stops reading at
 * `zoom` — strokes finer than this lose their pattern and width profile.
 *
 * Quantized to whole world units, and that quantization is the whole point of
 * the function existing: the exact cutoff is `1.5 / zoom`, which changes on
 * every frame of a pinch, and a value that changes every frame is a value this
 * store has to publish every frame. Whole units change a dozen times across the
 * entire zoom range instead, so an ordinary zoom publishes nothing at all. The
 * price is that a stroke whose size falls between two whole units flips a
 * little further out than the exact rule would put it — at most one world unit
 * of cutoff, on a threshold that is a 1.5-pixel judgement call to begin with.
 */
export function patternCutoff(zoom: number): number {
  return zoom < SOLID_LOD_ZOOM ? Math.floor(SOLID_LOD_SCREEN_WIDTH / zoom) : 0;
}

/**
 * On-screen perpendicular error, in CSS pixels, an ink path may carry.
 *
 * Sized against what the engine already accepts at 1:1 — `TRACK_ERROR_LIMIT`
 * lets a default size-8 pencil's outline wander 0.2 world units — so this is
 * the same order of deviation, held constant on screen instead of in the
 * document.
 */
export const INK_ERROR_SCREEN_PX = 0.4;

/**
 * How much further the drawn curve moves than the points the simplifier
 * measures.
 *
 * The bound is enforced on the outline's vertices, but the path is drawn as
 * quadratics through their midpoints, and dropping a vertex lets that curve cut
 * the corner by more than the vertex itself was allowed to move.
 *
 * How much more depends on how coarsely the stroke was sampled, so the factor
 * comes from the fixture that behaves worst rather than from the smoothest
 * one: wandering 30-point walks at 6-unit spacing — the shape of real
 * handwriting, and what the scale bench seeds — put the drawn deviation at a
 * p99 of 2.67x the tolerance their vertices were held to, against 1.40x for
 * dense spirals. Three is that, rounded up.
 *
 * It is a p99 and not a maximum on purpose. The far tail does not scale with
 * the budget — a stroke whose caps and endpoint run get rebuilt the moment any
 * simplification happens sits at ~0.4px whether this is 3 or 4 — so chasing it
 * with the divisor costs simplification everywhere and buys nothing. See the
 * ceiling in `ink.test.ts`, which is where that residual is pinned.
 */
const CURVE_SAG_FACTOR = 3;

/**
 * The perpendicular error, in world units, an ink path may carry at `zoom`.
 *
 * Zoomed out, a stroke is handed to the rasterizer carrying every command it
 * was drawn with: at zoom 0.4 a measured page put ~57 path commands into each
 * stroke's 72 on-screen pixels, and the browser re-rasterizes all of them on
 * every frame of a zoom. None of that detail can survive into pixels — so this
 * is the budget for dropping it, quoted on screen and converted to the world
 * units the engine measures in.
 *
 * Quantized to zoom octaves for the reason {@link patternCutoff} is quantized
 * to whole units: `INK_ERROR_SCREEN_PX / zoom` changes on every frame of a
 * pinch, and a value that changes every frame is a value this store publishes
 * every frame. Six values cover the whole zoom-out range instead.
 *
 * The band's *upper* edge sets the budget, so the error a stroke actually
 * carries is at most `INK_ERROR_SCREEN_PX` and usually less — the conservative
 * direction.
 *
 * It starts at {@link SOLID_LOD_ZOOM} rather than at 1:1, and shares that
 * threshold for the same reason it exists: below it a stroke's sub-pixel
 * detail has stopped reading. Above it there is nothing to win — the engine's
 * own brush-relative bound already allows a default pencil 0.2 world units,
 * which is most of this budget — and a boundary at 1:1 would sit exactly where
 * an ordinary pinch hovers, flipping the whole page's geometry back and forth
 * across it. Returning 0 there also leaves PNG export at full fidelity, since
 * it renders from the initial camera (see the note on the hooks in `lod.ts`).
 */
export function inkErrorLimit(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom >= SOLID_LOD_ZOOM) return 0;
  return (
    INK_ERROR_SCREEN_PX / CURVE_SAG_FACTOR / 2 ** Math.ceil(Math.log2(zoom))
  );
}

function lodFor(camera: Camera): LodState {
  return {
    patternCutoff: patternCutoff(camera.z),
    detail: camera.z >= LOD_ZOOM_THRESHOLD ? 'high' : 'low',
    dotLength: camera.z < DOT_ZOOM_THRESHOLD ? 9 : 0,
    inkErrorLimit: inkErrorLimit(camera.z),
  };
}

export const useLodStore = create<LodState>(() =>
  lodFor(useCameraStore.getState().camera),
);

// One listener on the camera store for the whole board, instead of one per
// mounted shape. The guard is what makes a camera move free: zustand notifies
// every listener on every `setState`, and it is that broadcast — not the
// selector, and not the camera math — that the shape count multiplies.
//
// Guarding on the published values rather than on the camera is what makes a
// ZOOM free too. Every value above is discrete, so a pinch crosses a handful of
// them across the whole zoom range and publishes nothing in between; measured
// at 50k shapes, one publish costs ~21ms and used to happen on every zoom
// frame.
let last = lodFor(useCameraStore.getState().camera);
useCameraStore.subscribe((state) => {
  const next = lodFor(state.camera);
  if (
    next.patternCutoff === last.patternCutoff &&
    next.detail === last.detail &&
    next.dotLength === last.dotLength &&
    next.inkErrorLimit === last.inkErrorLimit
  )
    return;
  last = next;
  useLodStore.setState(next);
});
