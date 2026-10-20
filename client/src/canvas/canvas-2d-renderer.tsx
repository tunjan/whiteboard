// The canvas implementation of the renderer port. `auto` mounts it once a page
// holds `AUTO_CANVAS_2D_SHAPES`; `?renderer=canvas-2d` forces it anywhere.
//
// The camera is a single context transform rather than one element per shape,
// so a pan or zoom costs no per-shape style, layout or paint — and during a
// gesture the existing bitmap is reprojected instead of repainted (`shift`,
// `rescale`). `scale-bench`'s `frame - js` split reads the difference directly.
//
// SCOPE. It is a hybrid, not a full rasterizer. Ink, the geometric shapes,
// text, images, video and frames are painted here from `canvas-2d-paint`'s op
// lists; stickers, equations, graphs and bookmarks stay in the DOM, because
// their content is React artwork, a typeset document, or a live wheel gesture
// rather than geometry (see `DOM_SHAPE_TYPES`). `canvas-2d-delegation` keeps
// the stacking exact across that seam by handing the DOM anything painted that
// sits above DOM-owned content it overlaps; `data-canvas-2d-delegated` reports
// how many shapes that came to.
//
// It reuses `buildInkRender` and the shape geometry helpers rather than
// reimplementing either, so the two renderers cannot disagree about what a
// stroke or an outline looks like — the path data that becomes an SVG `d`
// there becomes a `Path2D` here. Paths are cached per shape and invalidated on
// content, LOD band, and theme, which is the point: a pan must not rebuild
// ink, or this measures the outline builder instead of the renderer.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { atom, react, transact, unsafe__withoutCapture } from '@tldraw/state';
import type { Point, Shape } from '@whiteboard/shared';
import { cameraToTransform, cameraTranslation, type Camera } from './camera';
import {
  ancestorState,
  CanvasScene,
  shapeMatrix,
  type SceneNode,
} from './engine/scene';
import type { Matrix } from './engine/matrix';
import type { ShapeRendererProps } from './engine/renderer';
import { subscribeDocumentChanges } from './engine/document-changes';
import { createCssVarResolver } from './css-vars';
import { paintCounters } from './bench-flags';
import { inkPaint } from './ink-color';
import { buildInkRender, drawUtil } from './shapes/draw';
import {
  highlightPaint,
  HIGHLIGHT_OVERLAY_OPACITY,
  HIGHLIGHT_UNDERLAY_OPACITY,
} from './shapes/highlight';
import { useLodStore } from './use-lod-store';
import { squaredCorners } from './shapes/image-merge';
import { editor, spatialIndex } from './use-document-store';
import { shapeStore } from './engine/shape-store';
import { useCameraStore } from './use-camera-store';
import { useCameraInteraction } from './use-camera-interaction';
import { bindSceneUi } from './scene-ui';
import { useLiveStrokeStore } from './use-live-stroke-store';
import { useEraserCutStore } from './use-eraser-cut-store';
import { shapeRegistry } from './shapes/shape-registry';
import { ShapeList } from './shape-dom-nodes';
import {
  buildPaint,
  compilePaint,
  fillOp,
  paintCompiled,
  DOM_SHAPE_TYPES,
  type CompiledOp,
  type PaintContext,
} from './canvas-2d-paint';
import {
  delegatedShapeIds,
  type StackedShape,
} from './canvas-2d-delegation';

type DrawShape = Extract<Shape, { type: 'draw' }>;

/** One stroke's conditioned geometry, held across camera frames. */
export interface CachedInk {
  revision: number;
  theme: number;
  /** The LOD inputs this path was built from, so a band crossing invalidates
   *  only the strokes whose answer actually moved. `errorLimit` additionally
   *  carries a direction: a path built for a *closer* camera is exact enough
   *  for a further one, so zooming out reuses it. */
  errorLimit: number;
  forceSolid: boolean;
  dashStyle: string;
  dotLength: number;
  stroked: boolean;
  /** Null exactly when `box` is set: an impostor has no geometry to paint. */
  ink: Path2D | null;
  /** Largest world-unit dimension of the shape's bounds. A property of the
   *  geometry, so a cached entry answers the impostor question without
   *  touching the points again. See {@link impostorCutoff}. */
  footprint: number;
  /** Local-space box painted instead of `ink` once the shape's footprint is
   *  too small for its own silhouette to read, and the fraction of that box
   *  the real ink covers. Null when the geometry is painted. */
  box: { x: number; y: number; w: number; h: number } | null;
  coverage: number;
  dash: number[] | null;
  dashOffset: number;
  size: number;
  color: string;
  highlight: boolean;
  /** A closed stroke's interior, painted under the ink; null when unfilled. */
  fill: CompiledOp[] | null;
}

/**
 * Whether `hit` is the same stroke already conditioned at no less detail than
 * the current zoom asks for: a full-width outline where a centerline would do,
 * a pattern where a solid line would do, real geometry where a box would do, or
 * a path simplified for a closer camera than this one.
 *
 * Every LOD term only ever removes detail, so an entry that is too detailed
 * costs fill time and changes nothing on screen. That makes it safe to keep
 * for the length of a gesture and re-condition once the camera settles.
 *
 * The impostor is the sharpest case of that rule — it is the term that removes
 * the most — and it reads the same way round: real geometry answers a request
 * for either, a box answers only a request for a box.
 */
export function isDetailedEnough(
  hit: Pick<CachedInk, 'forceSolid' | 'dashStyle' | 'errorLimit' | 'box'>,
  forceSolid: boolean,
  dash: string,
  errorLimit: number,
  impostor: boolean,
): boolean {
  return (
    (!hit.forceSolid || hit.forceSolid === forceSolid) &&
    (hit.dashStyle === dash ||
      (hit.dashStyle !== 'solid' && dash === 'solid')) &&
    (!hit.box || impostor) &&
    hit.errorLimit <= errorLimit
  );
}

/** The entry this zoom would build right now, term for term. */
export function isExactly(
  hit: Pick<CachedInk, 'forceSolid' | 'dashStyle' | 'errorLimit' | 'box'>,
  forceSolid: boolean,
  dash: string,
  errorLimit: number,
  impostor: boolean,
): boolean {
  return (
    hit.forceSolid === forceSolid &&
    hit.dashStyle === dash &&
    hit.errorLimit === errorLimit &&
    (hit.box !== null) === impostor
  );
}

/**
 * Whether a cached entry can be painted as-is, given whether the camera moved.
 *
 * Moving, an entry carrying MORE detail than this zoom asks for is still
 * correct — every LOD term only ever removes detail, so keeping too much costs
 * fill time and changes nothing on screen. A zoom-out reuses what it has and
 * defers the cheaper representation to settle; a zoom-in, which needs detail
 * the entry does not carry, rebuilds.
 *
 * At rest the entry must match exactly, so the settle pays for the
 * representation this zoom actually wants.
 *
 * An OR of the two, not a ternary on `isDetailedEnough`: an entry that is
 * exactly right is also detailed enough, so a ternary sends it down the moving
 * arm and answers `false` at rest. That is what made every full repaint on a
 * still board rebuild every visible shape — 9.1ms of a 10.0ms repaint at 50k,
 * and invisible to every gesture ramp, which never takes the repaint branch at
 * all. `runRepaintBench` is the table that sees it.
 */
export function reusableInk(
  hit: Pick<CachedInk, 'forceSolid' | 'dashStyle' | 'errorLimit' | 'box'>,
  forceSolid: boolean,
  dash: string,
  errorLimit: number,
  impostor: boolean,
  moving: boolean,
): boolean {
  return moving
    ? isDetailedEnough(hit, forceSolid, dash, errorLimit, impostor)
    : isExactly(hit, forceSolid, dash, errorLimit, impostor);
}

/**
 * The fraction of a `w` x `h` local box that a stroke of `size` running through
 * `points` actually inks.
 *
 * This is the whole content of an impostor. A box filled at the shape's own
 * colour and full alpha would read as a solid blob where the real stroke is a
 * faint diagonal; weighted by coverage it reads as the same smudge the geometry
 * would have left, because at four pixels across that smudge is all the
 * geometry ever resolved to.
 *
 * Centerline length times width is the area of the stroke without its
 * self-overlap at corners, so a tight scribble is under-weighted rather than
 * over — the direction that keeps an impostor from being the thing you notice.
 * The trailing `size * size` is the cap on a stroke with no length at all,
 * which is how a pen dot stays visible.
 */
export function impostorCoverage(
  points: readonly { x: number; y: number }[],
  size: number,
  w: number,
  h: number,
): number {
  if (w <= 0 || h <= 0) return 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return Math.min(1, (length * size + size * size) / (w * h));
}

/** A transform as plain mutable numbers, in `setTransform` argument order. */
type Mat6 = [number, number, number, number, number, number];

/**
 * `world` composed with `shape`'s own transform, written into `out`.
 *
 * The context reaches the same place two ways: `setTransform(world)` followed
 * by `transform(m)`, or one `setTransform` of the product. The second is half
 * the native calls per shape, and an unrotated shape — which is most of them —
 * never reaches `shapeMatrix` at all, so its per-shape matrix allocation goes
 * with it. `out` is reused across the whole pass for the same reason.
 */
export function composeShapeTransform(
  world: Matrix,
  shape: Shape,
  out: Mat6,
): Mat6 {
  const [a, b, c, d, e, f] = world;
  if (!shape.rotation) {
    out[0] = a;
    out[1] = b;
    out[2] = c;
    out[3] = d;
    out[4] = a * shape.x + c * shape.y + e;
    out[5] = b * shape.x + d * shape.y + f;
    return out;
  }
  const [ma, mb, mc, md, me, mf] = shapeMatrix(shape);
  out[0] = a * ma + c * mb;
  out[1] = b * ma + d * mb;
  out[2] = a * mc + c * md;
  out[3] = b * mc + d * md;
  out[4] = a * me + c * mf + e;
  out[5] = b * me + d * mf + f;
  return out;
}

/**
 * How long an image source may go unpainted before its element is released.
 * ponytail: a fixed age, not a decoded-bytes budget; switch to a byte-weighted
 * LRU if boards with many large originals still hit the decode cliff.
 */
const IMAGE_IDLE_MS = 60_000;

/** Device pixels of overlap repainted at the seam between shifted and fresh. */
const SEAM = 2;

/**
 * How far a bitmap may be stretched from the zoom it was painted at before it
 * is repainted instead.
 *
 * One octave's half-step, which is the band the background wallpaper and the
 * shape tile cache already work in — and the same argument in all three places:
 * a factor of root two is one mip step, which is the most resampling a bitmap
 * takes before the softening is the thing you are looking at rather than a
 * property of the gesture. What it buys is that a continuous zoom repaints once
 * per band instead of once per frame; the bench's zoom ramp moves 4% per frame,
 * so that is one repaint every nine.
 */
export const REPROJECT_BAND = Math.SQRT2;

/** Whether pixels painted at `fromZ` may still be stretched to `toZ`. */
export function withinReprojectBand(fromZ: number, toZ: number): boolean {
  const s = toZ / fromZ;
  return s >= 1 / REPROJECT_BAND && s <= REPROJECT_BAND;
}

/**
 * The scale and device-pixel offset that put pixels painted under camera
 * `from` where camera `to` puts the same world points.
 *
 * A pan is the case where `s` is 1 and this is the translation `shift` already
 * does. A zoom is the same reprojection with the scale left in: a device point
 * `p` in the source stands for world `(p / dpr - from.e) / from.z`, which `to`
 * puts at `(world * to.z + to.e) * dpr` — linear in `p`, so the whole bitmap
 * moves under one `drawImage` rather than one draw call per shape.
 */
export function reprojection(
  from: { z: number; e: number; f: number },
  to: { z: number; e: number; f: number },
  dpr: number,
): { s: number; dx: number; dy: number } {
  const s = to.z / from.z;
  return { s, dx: (to.e - from.e * s) * dpr, dy: (to.f - from.f * s) * dpr };
}

/**
 * The viewport rects, in device pixels, that `covered` leaves empty.
 *
 * A translation exposes at most two of them, a zoom-out up to four, and a
 * zoom-in none at all — the magnified bitmap covers more than the viewport, so
 * nothing has to be repainted and the whole frame is one `drawImage`.
 *
 * The strips run the full width and height rather than meeting at the corners:
 * they are cleared before they are redrawn and unioned into one clip, so an
 * overlap repaints rather than double-composites, and squaring them off would
 * only add arithmetic to the hot path.
 *
 * `seam` widens each strip inwards, off the antialiased edge of whatever
 * straddles the boundary.
 */
export function exposedEdges(
  covered: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
  seam: number,
): [number, number, number, number][] {
  const edges: [number, number, number, number][] = [];
  const right = covered.x + covered.w;
  const bottom = covered.y + covered.h;
  if (covered.x > 0) edges.push([0, 0, covered.x + seam, height]);
  if (right < width) edges.push([right - seam, 0, width - right + seam, height]);
  if (covered.y > 0) edges.push([0, 0, width, covered.y + seam]);
  if (bottom < height)
    edges.push([0, bottom - seam, width, height - bottom + seam]);
  return edges;
}

interface Bitmap {
  z: number;
  epoch: number;
  ui: number;
  theme: number;
  pixelWidth: number;
  /** Where the pixels sit, which is the true camera rounded to whole pixels. */
  e: number;
  f: number;
}

/**
 * One shape to paint, with its per-shape signals already read.
 *
 * `collect` and `drawShapes` would otherwise pull `shape` and `presentation`
 * off the same node twice — three times for a highlighter stroke, which paints
 * again in the overlay pass — and `z` once per sort comparison.
 */
interface Drawable {
  node: SceneNode;
  shape: Shape;
  z: number;
  alpha: number;
  /** The frame mask this shape inherits, in page space, or null for none.
   *  An empty polygon means fully clipped and is never painted. */
  mask: Point[] | null;
  /** Eraser cut fragments standing in for the shape while a cut is previewed. */
  fragments?: Shape[];
}

/** One non-ink shape's compiled ops, held across camera frames on the same
 *  terms as {@link CachedInk}: content revision, theme, and the LOD inputs the
 *  ops were built from. `epoch` is read by images alone, whose rounded corners
 *  are a function of their NEIGHBOURS rather than of themselves. */
interface CachedPaint {
  revision: number;
  theme: number;
  patternCutoff: number;
  detail: string;
  imageThumbCutoff: number;
  epoch: number;
  corners: number;
  ops: CompiledOp[];
}

export function Canvas2dShapeLayer({ width, height }: ShapeRendererProps) {
  const scene = useMemo(() => new CanvasScene(spatialIndex, shapeStore), []);
  // TEMPORARY perf harness — delete with ./scale-bench.ts.
  (globalThis as unknown as { __scene?: CanvasScene }).__scene = scene;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const domLayerRef = useRef<HTMLDivElement>(null);
  // The shapes this renderer hands back to the DOM, published for the sublayer
  // below. Atoms rather than React state: the set is recomputed inside the
  // paint path, which must not re-render the component to say so.
  const domIds = useMemo(() => atom<readonly string[]>('canvas2d dom', []), []);
  const domHighlightIds = useMemo(
    () => atom<readonly string[]>('canvas2d dom highlights', []),
    [],
  );
  const containers = useMemo(() => new Map<string, HTMLDivElement>(), []);
  const overlays = useMemo(() => new Map<string, HTMLDivElement>(), []);

  // Without a viewport the scene's `visible` computed short-circuits to every
  // id, and the renderer silently draws the whole document each frame — so
  // this is declared before the paint effect, which runs after it on mount.
  // The size travels through the atom rather than the paint effect's deps:
  // a resize re-running that effect would drop every cached path and image.
  useLayoutEffect(() => {
    scene.viewport.set({ width, height });
  }, [scene, width, height]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cache = new Map<string, CachedInk>();
    const paints = new Map<string, CachedPaint>();
    /** Ink and ops for the eraser's cut fragments, which are transient shapes
     *  with no scene record. Dropped wholesale when the cut changes: a preview
     *  lasts one gesture, so nothing here is worth keying. */
    let cutCache = new Map<string, CachedInk>();
    let cutPaints = new Map<string, CachedPaint>();

    // A theme flip changes every resolved colour at once, so it is the one
    // thing that still clears wholesale. LOD is handled per entry instead:
    // clearing on every band crossing is what made a zoom rebuild the page.
    let themeEpoch = 0;
    let resolve = createCssVarResolver();
    const movingRef = () => useCameraInteraction.getState().isMoving;
    /** What the pixels currently on the canvas represent. Null means they
     *  cannot be reused. */
    let bitmap: Bitmap | null = null;
    /** A pristine copy of a real paint, and the camera its pixels represent.
     *  Every frame of a zoom resamples THIS rather than its own output, so the
     *  canvas is always exactly one resampling away from geometry however long
     *  the gesture runs — resampling a resample is what turns a long pinch into
     *  mush. Null means it has to be captured again, which is how a full
     *  repaint and a pan both hand the next zoom a clean source. */
    let ref: HTMLCanvasElement | null = null;
    let refAt: { z: number; e: number; f: number } | null = null;
    let blits = 0;
    let rescales = 0;
    /** Shapes painted as a box rather than as geometry, this frame. */
    let impostors = 0;
    /** Paths conditioned since mount, published as `data-canvas-2d-built`.
     *  Cumulative on purpose: a per-paint count is overwritten by whatever
     *  paint happens next, so sampling it around a gesture reports zeros that
     *  are not there. Diff it across a sweep instead. */
    let built = 0;

    /** Bitmaps for the image and video sources on screen. A source that has
     *  not arrived yet paints nothing and repaints the frame when it lands, so
     *  a slow blob never blocks the rest of the board. */
    const images = new Map<string, HTMLImageElement | 'failed'>();
    /** When each source was last asked for, so {@link evictImages} can let go
     *  of the ones nothing has drawn in a while. */
    const imageUsed = new Map<string, number>();
    const imageFor = (src: string, load = true): CanvasImageSource | null => {
      imageUsed.set(src, performance.now());
      const hit = images.get(src);
      if (hit === 'failed') return null;
      if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
      if (!load) return null;
      const element = new Image();
      element.onload = () => {
        // The pixels on the canvas are now missing something they should have
        // had, so the bitmap cannot be reprojected into the next frame.
        bitmap = null;
        refAt = null;
        paint();
      };
      element.onerror = () => images.set(src, 'failed');
      element.src = src;
      images.set(src, element);
      return null;
    };

    /** Release sources no paint has asked for in {@link IMAGE_IDLE_MS}. A full
     *  repaint asks for every image on screen, so this only drops ones scrolled
     *  away from or deleted; coming back reloads them, as on first view. */
    const evictImages = () => {
      const cutoff = performance.now() - IMAGE_IDLE_MS;
      for (const [src, used] of imageUsed) {
        if (used > cutoff) continue;
        const element = images.get(src);
        if (element && element !== 'failed') {
          // Detached first: clearing `src` fires `error`, which would
          // otherwise record the source as failed for good.
          element.onload = element.onerror = null;
          element.src = '';
        }
        images.delete(src);
        imageUsed.delete(src);
      }
    };

    /** The DOM-owned shapes on this page, maintained from the change list so
     *  a board with none of them never scans for them. */
    let domNative = new Set<string>();
    /** Everything the canvas skips: `domNative` plus whatever the stacking
     *  drags along with it — see `canvas-2d-delegation`. */
    let delegated: ReadonlySet<string> = new Set();

    const trackDomNative = (
      shapes: ReadonlyMap<string, Shape>,
      ids: ReadonlySet<string> | null,
    ): boolean => {
      if (!ids) {
        const next = new Set<string>();
        for (const [id, shape] of shapes)
          if (DOM_SHAPE_TYPES.has(shape.type)) next.add(id);
        const changed =
          next.size !== domNative.size || [...next].some((id) => !domNative.has(id));
        domNative = next;
        return changed;
      }
      let changed = false;
      for (const id of ids) {
        const shape = shapes.get(id);
        const owned = !!shape && DOM_SHAPE_TYPES.has(shape.type);
        if (owned === domNative.has(id)) continue;
        if (owned) domNative.add(id);
        else domNative.delete(id);
        changed = true;
      }
      return changed;
    };

    const stacked = (id: string) => {
      const shape = shapeStore.peek(id);
      const bounds = shape && shapeRegistry.getFor(shape)?.getBounds(shape);
      return bounds ? { id, z: scene.record(id).z.get(), bounds } : null;
    };

    /**
     * Recompute the delegated set and publish it to the DOM sublayer.
     *
     * Runs on every document change, because a stroke drawn over a bookmark
     * changes the answer — but it returns on the first line for a page with no
     * DOM-owned shapes, which is every board this renderer is measured on.
     */
    const syncDelegation = () => {
      if (!domNative.size && !delegated.size) return;
      const roots: StackedShape[] = [];
      for (const id of domNative) {
        const root = stacked(id);
        if (root) roots.push(root);
      }
      const next = delegatedShapeIds(roots, (shape) => {
        const out: StackedShape[] = [];
        for (const id of scene.index.search(shape.bounds)) {
          const candidate = stacked(id);
          if (candidate) out.push(candidate);
        }
        return out;
      });
      if (
        next.size === delegated.size &&
        [...next].every((id) => delegated.has(id))
      )
        return;
      delegated = next;
      const ids: string[] = [];
      const highlights: string[] = [];
      for (const id of next) {
        ids.push(id);
        const shape = shapeStore.peek(id);
        if (shape?.type === 'draw' && shape.props.inkKind === 'highlight')
          highlights.push(id);
      }
      // Sorted so React sees a stable list; stacking is carried by z-index.
      ids.sort();
      highlights.sort();
      domIds.set(ids);
      domHighlightIds.set(highlights);
      canvas.dataset.canvas2dDelegated = String(next.size);
      // The canvas is now painting a different set of shapes than its pixels
      // hold, so nothing on it can be reprojected into the next frame.
      bitmap = null;
      refAt = null;
    };

    function inkFor(
      shape: DrawShape,
      revision: number,
      store: Map<string, CachedInk>,
    ): CachedInk | null {
      const { points, size } = shape.props;
      if (points.length === 0) return null;
      const lod = useLodStore.getState();
      const forceSolid = size < lod.patternCutoff;
      const dash =
        shape.props.dash && shape.props.dash !== 'solid' && forceSolid
          ? 'solid'
          : (shape.props.dash ?? 'solid');
      // Only a patterned stroke reads `dotLength`; keying solid ink on it would
      // rebuild the whole page every time the dot threshold is crossed.
      const dotLength = dash === 'solid' ? 0 : lod.dotLength;
      const hit = store.get(shape.id);
      // A footprint is a property of the geometry, so a cached entry already
      // knows whether this zoom wants an impostor — the question is answered
      // without touching the points, which is what keeps it off the hit path.
      const impostor = hit ? hit.footprint <= lod.impostorCutoff : false;
      if (
        hit &&
        hit.revision === revision &&
        hit.theme === themeEpoch &&
        hit.dotLength === dotLength &&
        reusableInk(
          hit,
          forceSolid,
          dash,
          lod.inkErrorLimit,
          impostor,
          movingRef(),
        )
      )
        return hit;
      built++;
      // Started after the cache test, so this measures conditioning and not the
      // hit path it shares a function with.
      const conditionStart = performance.now();
      const highlight = shape.props.inkKind === 'highlight';
      const color = resolve(
        inkPaint(
          highlight ? highlightPaint(shape.props.color) : shape.props.color,
        ),
      );
      // The registry's own bounds, so the impostor is exactly the box the
      // spatial index culled against and the geometry cannot paint outside it.
      // They are world bounds of an unrotated model, so subtracting the shape
      // origin lands them in the local space the shape transform expects.
      const b = drawUtil.getBounds(shape);
      const box = {
        x: b.minX - shape.x,
        y: b.minY - shape.y,
        w: b.maxX - b.minX,
        h: b.maxY - b.minY,
      };
      const footprint = Math.max(box.w, box.h);
      if (footprint <= lod.impostorCutoff) {
        const entry: CachedInk = {
          revision,
          theme: themeEpoch,
          errorLimit: lod.inkErrorLimit,
          forceSolid,
          dashStyle: dash,
          dotLength,
          stroked: false,
          ink: null,
          footprint,
          box,
          coverage: impostorCoverage(points, size, box.w, box.h),
          dash: null,
          dashOffset: 0,
          size,
          color,
          highlight,
          fill: null,
        };
        store.set(shape.id, entry);
        paintCounters.conditionMs += performance.now() - conditionStart;
        return entry;
      }
      const render = buildInkRender(
        { ...shape.props, dash },
        points,
        false,
        lod.dotLength,
        forceSolid,
        lod.inkErrorLimit,
      );
      // Every field `draw.tsx` renders must be painted here too, or it shows
      // only while undo hands the stroke to the DOM layer. The rests fail to
      // compile the day `InkRender` or its dash props grow a field this
      // renderer has not ported.
      const { stroked, d, dash: dashAttrs, fillPath, ...unported } = render;
      unported satisfies Record<string, never>;
      const { strokeDasharray, strokeDashoffset, ...unportedDash } =
        dashAttrs ?? {};
      unportedDash satisfies Record<string, never>;
      // Hatch lines are rotated about the local origin, so they have to reach
      // the box's farthest edge from it, not just span its size.
      const fill = fillPath
        ? fillOp(
            fillPath,
            color,
            shape.props.fillStyle!,
            Math.max(Math.abs(box.x), Math.abs(box.x + box.w)),
            Math.max(Math.abs(box.y), Math.abs(box.y + box.h)),
          )
        : null;
      const entry: CachedInk = {
        revision,
        theme: themeEpoch,
        errorLimit: lod.inkErrorLimit,
        forceSolid,
        dashStyle: dash,
        dotLength,
        stroked,
        ink: new Path2D(d),
        footprint,
        box: null,
        coverage: 1,
        dash: strokeDasharray
          ? strokeDasharray.split(/[\s,]+/).map(Number)
          : null,
        dashOffset: Number(strokeDashoffset ?? 0),
        size,
        color,
        highlight,
        fill: fill ? compilePaint([fill]) : null,
      };
      store.set(shape.id, entry);
      paintCounters.conditionMs += performance.now() - conditionStart;
      return entry;
    }

    /**
     * The compiled ops for a shape that is not ink, built on demand.
     *
     * Keyed on the same terms ink is, plus the document epoch for images:
     * their corners are squared off against the images they touch, which is a
     * property of the neighbours and so moves without the shape itself
     * changing. Every other type ignores `epoch` and survives a document change
     * untouched.
     */
    function paintFor(
      shape: Shape,
      revision: number,
      store: Map<string, CachedPaint>,
    ): CompiledOp[] {
      const lod = useLodStore.getState();
      const epoch = scene.documentEpoch.get();
      const hit = store.get(shape.id);
      const fresh =
        !!hit &&
        hit.revision === revision &&
        hit.theme === themeEpoch &&
        hit.patternCutoff === lod.patternCutoff &&
        hit.detail === lod.detail &&
        (shape.type !== 'image' || hit.imageThumbCutoff === lod.imageThumbCutoff);
      // Only an image asks about the epoch, and only to decide whether its
      // corner mask is worth re-testing. Everything else is a function of the
      // shape alone and a document change leaves it exactly as it was.
      if (fresh && (shape.type !== 'image' || hit.epoch === epoch))
        return hit.ops;
      const conditionStart = performance.now();
      const corners = shape.type === 'image' ? imageCorners(shape) : 0;
      if (fresh && hit.corners === corners) {
        hit.epoch = epoch;
        paintCounters.conditionMs += performance.now() - conditionStart;
        return hit.ops;
      }
      built++;
      const ops = compilePaint(
        buildPaint(shape, {
          resolve,
          lod: {
            patternCutoff: lod.patternCutoff,
            detail: lod.detail,
            imageThumbCutoff: lod.imageThumbCutoff,
          },
          corners,
        }),
      );
      store.set(shape.id, {
        revision,
        theme: themeEpoch,
        patternCutoff: lod.patternCutoff,
        detail: lod.detail,
        imageThumbCutoff: lod.imageThumbCutoff,
        epoch,
        corners,
        ops,
      });
      paintCounters.conditionMs += performance.now() - conditionStart;
      return ops;
    }

    /** The corner mask for an image flush against its neighbours — the same
     *  contact test `useMergedCorners` runs, off the same index. */
    function imageCorners(shape: Extract<Shape, { type: 'image' }>): number {
      if (shape.rotation) return 0;
      const bounds = {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.props.w,
        maxY: shape.y + shape.props.h,
      };
      const neighbours = [];
      for (const id of scene.index.search({
        minX: bounds.minX - 1,
        minY: bounds.minY - 1,
        maxX: bounds.maxX + 1,
        maxY: bounds.maxY + 1,
      })) {
        if (id === shape.id) continue;
        const other = shapeStore.peek(id);
        if (!other || other.type !== 'image' || other.rotation) continue;
        neighbours.push({
          minX: other.x,
          minY: other.y,
          maxX: other.x + other.props.w,
          maxY: other.y + other.props.h,
        });
      }
      return squaredCorners(bounds, neighbours);
    }

    /** The context state `stroke` last wrote. Every assignment here crosses
     *  into the context; consecutive strokes usually share colour, width and
     *  alpha, so comparing in JS first removes most of those crossings. Each
     *  `drawShapes` re-establishes these, because `shift` wraps its pass in
     *  save/restore and rolls the real context back underneath them. */
    let appliedAlpha = -1;
    let appliedStroke = '';
    let appliedFill = '';
    let appliedWidth = -1;
    let appliedDash = false;

    function stroke(entry: CachedInk, alpha: number) {
      if (entry.box) {
        // The impostor: one rect at the weight the geometry would have left.
        // Coverage folds into alpha rather than into the colour so a shape's
        // own opacity still multiplies through, and so the state cache below
        // compares the value actually written to the context.
        const a = alpha * entry.coverage;
        if (a !== appliedAlpha) {
          ctx.globalAlpha = a;
          appliedAlpha = a;
        }
        if (entry.color !== appliedFill) {
          ctx.fillStyle = entry.color;
          appliedFill = entry.color;
        }
        ctx.fillRect(entry.box.x, entry.box.y, entry.box.w, entry.box.h);
        impostors++;
        return;
      }
      if (!entry.ink) return;
      if (alpha !== appliedAlpha) {
        ctx.globalAlpha = alpha;
        appliedAlpha = alpha;
      }
      if (entry.stroked) {
        if (entry.color !== appliedStroke) {
          ctx.strokeStyle = entry.color;
          appliedStroke = entry.color;
        }
        if (entry.size !== appliedWidth) {
          ctx.lineWidth = entry.size;
          appliedWidth = entry.size;
        }
        if (entry.dash) {
          ctx.setLineDash(entry.dash);
          ctx.lineDashOffset = entry.dashOffset;
          appliedDash = true;
        } else if (appliedDash) {
          ctx.setLineDash([]);
          appliedDash = false;
        }
        ctx.stroke(entry.ink);
      } else {
        if (entry.color !== appliedFill) {
          ctx.fillStyle = entry.color;
          appliedFill = entry.color;
        }
        ctx.fill(entry.ink);
      }
    }

    /** Frame masks by parent id, for the document epoch they were cut in.
     *  Siblings share one array, which is what lets `drawShapes` keep a clip
     *  open across a run of them by reference alone. */
    let masks = new Map<string, Point[] | null>();
    let masksEpoch = -1;

    /** Collect the drawable shapes for `ids`, in paint order. */
    const collect = (ids: Iterable<string>) => {
      const t0 = performance.now();
      const items: Drawable[] = [];
      const hiddenIds = scene.hidden.get();
      const epoch = scene.documentEpoch.get();
      if (epoch !== masksEpoch) {
        masks = new Map();
        masksEpoch = epoch;
      }
      const cuts = useEraserCutStore.getState().fragments;
      const getShape = (id: string) => scene.record(id).shape.get();
      let handedOver = 0;
      for (const id of ids) {
        // Painted by the DOM sublayer instead; see `canvas-2d-delegation`.
        if (delegated.has(id)) {
          handedOver++;
          continue;
        }
        const node = scene.record(id);
        const shape = node.shape.get();
        if (!shape) continue;
        const presentation = node.presentation.get();
        if (presentation.visibility === 'hidden') continue;
        // Only a parented shape can inherit a frame mask, and most shapes on a
        // board have no parent at all — so the ancestor walk is not entered.
        // An arrow escapes the mask its siblings share, so it walks alone.
        let mask: Point[] | null = null;
        if (shape.parentId && shape.type === 'arrow') {
          mask = ancestorState(shape, getShape, hiddenIds).mask;
        } else if (shape.parentId) {
          let shared = masks.get(shape.parentId);
          if (shared === undefined) {
            shared = ancestorState(shape, getShape, hiddenIds).mask;
            masks.set(shape.parentId, shared);
          }
          mask = shared;
        }
        items.push({
          node,
          shape,
          z: node.z.get(),
          alpha: Number(presentation.opacity),
          mask,
          fragments: cuts[id],
        });
      }
      paintCounters.collectMs += performance.now() - t0;
      const t1 = performance.now();
      items.sort((a, b) => a.z - b.z);
      paintCounters.sortMs += performance.now() - t1;
      return { items, delegated: handedOver };
    };

    /** Paint `items` under the world transform already set on `ctx`. */
    const drawShapes = (items: Drawable[], zoom: number) => {
      const drawStart = performance.now();
      const t = ctx.getTransform();
      // Read out of the DOMMatrix once: each component access is itself a
      // native call, and the per-shape product needs all six.
      const world: Matrix = [t.a, t.b, t.c, t.d, t.e, t.f];
      const local: Mat6 = [1, 0, 0, 1, 0, 0];
      const env: PaintContext = { zoom, image: imageFor };
      const live = useLiveStrokeStore.getState().shapeId;

      resetStrokeState();

      // The second pass a highlighter stroke paints, above everything. It
      // carries its own shape rather than the drawable's, because a cut
      // preview's fragments stand in for their owner and each one paints both
      // passes in its place.
      const highlights: {
        shape: Shape;
        alpha: number;
        entry: CachedInk;
        mask: Point[] | null;
      }[] = [];
      // The clip in force. Consecutive items under the same frame share one
      // mask array, so the clip stays open across the run instead of a
      // save/clip/restore per shape. Only adjacent items merge; z is untouched.
      let open: Point[] | null = null;
      for (const item of items) {
        if (item.mask && item.mask.length < 3) continue; // fully clipped
        if (item.mask !== open) {
          if (open) {
            ctx.restore();
            resetStrokeState();
          }
          if (item.mask) clipTo(item.mask, t);
          open = item.mask;
        }
        // An eraser cut preview stands in for the shape: its fragments are
        // whole shapes in page coordinates, so they are placed like top-level
        // ones rather than inside their owner's transform.
        if (item.fragments) {
          for (const fragment of item.fragments) {
            const entry = paintShape(
              fragment,
              0,
              item.alpha,
              world,
              local,
              env,
              true,
            );
            if (entry?.highlight)
              highlights.push({
                shape: fragment,
                alpha: item.alpha,
                entry,
                mask: item.mask,
              });
          }
        } else {
          const entry = paintShape(
            item.shape,
            item.node.contentRevision.get(),
            item.alpha,
            world,
            local,
            env,
            false,
          );
          // Highlighter ink paints a second time above everything, exactly as
          // the DOM layer's separate overlay element does — except while the
          // live layer owns the stroke, which draws its own overlay pass.
          if (entry && entry.highlight && item.shape.id !== live)
            highlights.push({
              shape: item.shape,
              alpha: item.alpha,
              entry,
              mask: item.mask,
            });
        }
      }
      for (const { shape, alpha, entry, mask } of highlights) {
        // The overlay pass inherits its owner's clip, as the DOM layer's
        // overlay element inherits its owner's `clip-path`.
        if (mask !== open) {
          if (open) {
            ctx.restore();
            resetStrokeState();
          }
          if (mask) clipTo(mask, t);
          open = mask;
        }
        const m = composeShapeTransform(world, shape, local);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        stroke(entry, alpha * HIGHLIGHT_OVERLAY_OPACITY);
      }
      if (open) {
        ctx.restore();
        resetStrokeState();
      }
      ctx.setTransform(t);
      paintCounters.drawMs += performance.now() - drawStart;
    };

    /**
     * Paint one shape at its own place under `world`, and return its ink entry
     * if it was ink.
     *
     * Ink keeps the tuned path — one `setTransform`, one fill, and a JS-side
     * state cache — because that is the case a board is made of. Everything
     * else runs its compiled op list, which restores nothing, so the state
     * cache is invalidated afterwards rather than kept in step with it.
     */
    function paintShape(
      shape: Shape,
      revision: number,
      alpha: number,
      world: Matrix,
      local: Mat6,
      env: PaintContext,
      transient: boolean,
    ): CachedInk | null {
      if (shape.type === 'draw') {
        const entry = inkFor(shape, revision, transient ? cutCache : cache);
        if (!entry) return null;
        const m = composeShapeTransform(world, shape, local);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (entry.fill) {
          paintCompiled(ctx, entry.fill, alpha, env);
          resetStrokeState();
        }
        stroke(
          entry,
          entry.highlight ? alpha * HIGHLIGHT_UNDERLAY_OPACITY : alpha,
        );
        return entry;
      }
      const ops = paintFor(shape, revision, transient ? cutPaints : paints);
      if (!ops.length) return null;
      const m = composeShapeTransform(world, shape, local);
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      paintCompiled(ctx, ops, alpha, env);
      resetStrokeState();
      return null;
    }

    /**
     * Clip the context to a page-space frame mask, inside a `save()` the
     * caller has to `restore()`.
     *
     * The mask is applied under the WORLD transform, before the shape's own
     * goes down: a clip is resolved to device space the moment it is set, so
     * the `setTransform` that follows leaves it exactly where it landed.
     */
    function clipTo(mask: readonly Point[], world: DOMMatrix): void {
      ctx.save();
      ctx.setTransform(world);
      const region = new Path2D();
      region.moveTo(mask[0]!.x, mask[0]!.y);
      for (let i = 1; i < mask.length; i++) region.lineTo(mask[i]!.x, mask[i]!.y);
      region.closePath();
      ctx.clip(region);
    }

    /** Re-establish what `stroke` assumes about the context, after anything
     *  that wrote to it behind `stroke`'s back. */
    function resetStrokeState() {
      // Line joinery never varies for ink, so it is set here rather than per
      // stroke.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      appliedDash = false;
      appliedAlpha = -1;
      appliedStroke = '';
      appliedFill = '';
      appliedWidth = -1;
    }

    const paint = () => {
      // Tracked reads: the camera, what survives culling, and two epochs — one
      // bumped by any UI overlay change, one by every document change. Both are
      // counters because the scene holds the overlays in separate atoms, so
      // there is no single reference left to compare a cached frame against.
      // Per-shape signals are read untracked below — capturing 50k of them
      // would make the dependency walk the cost this renderer exists to remove.
      const camera = scene.camera.get();
      const visible = scene.visible.get();
      const ui = scene.uiEpoch.get();
      const epoch = scene.documentEpoch.get();
      // Tracked too: the cull region is quantized, so a small resize can leave
      // `visible` unchanged and still need the canvas resized.
      const { width, height } = scene.viewport.get();

      unsafe__withoutCapture(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.round(width * dpr);
        if (canvas.width !== pixelWidth) {
          canvas.width = pixelWidth;
          canvas.height = Math.round(height * dpr);
          bitmap = null;
          refAt = null;
        }
        // A canvas with no area has nothing to paint, and a bitmap captured at
        // that size is not a frame anyone can reproject — a board that loads
        // with a camera animation already running would otherwise hand the
        // first zoom a 0x0 source. `bitmap` is left null, so the first sized
        // frame is a full repaint.
        if (!canvas.width || !canvas.height) return;
        const moving = movingRef();
        const { e, f } = cameraTranslation(camera, !moving);
        impostors = 0;

        // Neither a pan nor a zoom changes any geometry, so the pixels already
        // on the canvas still stand for the right world — they are only in the
        // wrong place, and for a zoom at the wrong size. Reproject them and
        // redraw whatever that leaves uncovered. Everything else (an edit, a
        // theme flip, a settle) has to repaint, because it changes what the
        // pixels ARE rather than where they sit.
        const reusable =
          bitmap &&
          moving &&
          bitmap.epoch === epoch &&
          bitmap.ui === ui &&
          bitmap.theme === themeEpoch &&
          bitmap.pixelWidth === pixelWidth;
        const shifted = !reusable
          ? null
          : bitmap!.z === camera.z
            ? shift(bitmap!, e, f, dpr, camera, visible)
            : rescale(bitmap!, e, f, dpr, camera, visible);

        if (!shifted) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, height);
          ctx.transform(camera.z, 0, 0, camera.z, e, f);
          const { items, delegated: handedOver } = collect(visible);
          drawShapes(items, camera.z);
          evictImages();
          canvas.dataset.canvas2dDrawn = String(items.length);
          canvas.dataset.canvas2dDelegated = String(handedOver);
          bitmap = {
            z: camera.z,
            epoch,
            ui,
            theme: themeEpoch,
            pixelWidth,
            e,
            f,
          };
          // The canvas now holds real geometry, which is the best source a
          // later zoom could ask for. Captured lazily: a board that is only
          // ever panned never pays for the copy.
          refAt = null;
        }
        ctx.globalAlpha = 1;
        canvas.dataset.canvas2dBuilt = String(built);
        canvas.dataset.canvas2dBlits = String(blits);
        canvas.dataset.canvas2dRescales = String(rescales);
        canvas.dataset.canvas2dImpostors = String(impostors);
      });
    };

    /**
     * Translate the existing bitmap and repaint only the exposed edges.
     *
     * The offset is rounded to whole device pixels and `bitmap.e/f` records
     * where the pixels actually sit, so the residual against the true camera
     * stays under half a device pixel instead of accumulating. That residual is
     * why this only runs during a gesture: the settle repaints exactly, which
     * is also what keeps a still board matching the DOM layer.
     */
    function shift(
      from: Bitmap,
      e: number,
      f: number,
      dpr: number,
      camera: Camera,
      visible: ReadonlySet<string>,
    ): boolean {
      const dx = Math.round((e - from.e) * dpr);
      const dy = Math.round((f - from.f) * dpr);
      const w = canvas.width;
      const h = canvas.height;
      // Past half a viewport there is more exposed edge than retained middle.
      if (Math.abs(dx) >= w / 2 || Math.abs(dy) >= h / 2) return false;
      if (dx !== 0 || dy !== 0) {
        // `copy` clears whatever the shifted image does not cover, so the
        // exposed edges arrive empty rather than holding the previous frame.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(canvas, dx, dy);
        ctx.globalCompositeOperation = 'source-over';
        blits++;
      }
      from.e += dx / dpr;
      from.f += dy / dpr;
      // These pixels have moved, so they are no longer a copy of any real
      // paint. The next zoom captures the canvas instead.
      refAt = null;

      repaintEdges(
        exposedEdges({ x: dx, y: dy, w, h }, w, h, SEAM),
        dpr,
        camera,
        from,
        visible,
      );
      return true;
    }

    /**
     * Stretch a pristine copy of the last real paint to the current zoom and
     * repaint only the ring it no longer covers.
     *
     * The counterpart to {@link shift}, and the reason this renderer exists to
     * be measured: a zoom-out was repainting every path in the viewport on
     * every frame, which at 25k shapes is the whole frame. Within one
     * {@link REPROJECT_BAND} the bitmap still says what the geometry would, so
     * a continuous zoom now repaints once per band.
     *
     * Zooming in is the free direction — the magnified bitmap over-covers the
     * viewport, so there is no ring at all and the frame is one `drawImage`.
     * What it costs instead is sharpness, bounded by the band and paid back
     * exactly at settle. Zooming out is the opposite trade: sharp, but the ring
     * grows as the bitmap shrinks inside the viewport, up to half its area at
     * the band edge.
     */
    function rescale(
      from: Bitmap,
      e: number,
      f: number,
      dpr: number,
      camera: Camera,
      visible: ReadonlySet<string>,
    ): boolean {
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return false;
      if (!refAt) {
        if (!ref) ref = document.createElement('canvas');
        if (ref.width !== w || ref.height !== h) {
          ref.width = w;
          ref.height = h;
        }
        const rctx = ref.getContext('2d')!;
        rctx.setTransform(1, 0, 0, 1, 0, 0);
        rctx.globalCompositeOperation = 'copy';
        rctx.drawImage(canvas, 0, 0);
        refAt = { z: from.z, e: from.e, f: from.f };
      }
      if (!withinReprojectBand(refAt.z, camera.z)) return false;

      const { s, dx, dy } = reprojection(refAt, { z: camera.z, e, f }, dpr);
      // Rounded inwards, so the ring is repainted a fraction wide rather than
      // a fraction short: a sliver of stale pixels at the boundary would be
      // wrong in a way nothing later corrects, and a sliver of repaint is not.
      const cx = Math.ceil(dx);
      const cy = Math.ceil(dy);
      const cw = Math.floor(dx + w * s) - cx;
      const ch = Math.floor(dy + h * s) - cy;
      // Past half a viewport there is more exposed ring than retained middle —
      // the same rule the pure translation uses, stated as an area because a
      // zoom can shrink the bitmap away from all four edges at once.
      const keptW = Math.min(w, cx + cw) - Math.max(0, cx);
      const keptH = Math.min(h, cy + ch) - Math.max(0, cy);
      if (keptW <= 0 || keptH <= 0 || keptW * keptH < (w * h) / 2) return false;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(ref!, dx, dy, w * s, h * s);
      ctx.globalCompositeOperation = 'source-over';
      blits++;
      rescales++;

      // The canvas now stands for the current camera exactly; `refAt` still
      // describes the untouched source and is deliberately left alone, so the
      // next frame of the same gesture resamples the original once more rather
      // than resampling this.
      from.z = camera.z;
      from.e = e;
      from.f = f;

      repaintEdges(
        exposedEdges({ x: cx, y: cy, w: cw, h: ch }, w, h, SEAM),
        dpr,
        camera,
        from,
        visible,
      );
      return true;
    }

    /**
     * Clear `edges`, clip to them, and repaint the shapes inside from the
     * spatial index.
     *
     * Shared by both reprojections: what they retain differs, what they have to
     * redraw does not. Querying the index for each strip is the point — walking
     * the whole visible set and letting the clip reject it would keep exactly
     * the per-shape JS these paths exist to remove.
     */
    function repaintEdges(
      edges: readonly [number, number, number, number][],
      dpr: number,
      camera: Camera,
      at: { e: number; f: number },
      visible: ReadonlySet<string>,
    ): void {
      if (!edges.length) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      for (const [x, y, rw, rh] of edges) {
        ctx.clearRect(x, y, rw, rh);
        ctx.rect(x, y, rw, rh);
      }
      ctx.save();
      ctx.clip();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.transform(camera.z, 0, 0, camera.z, at.e, at.f);

      const ids = new Set<string>();
      for (const [x, y, rw, rh] of edges) {
        for (const id of scene.index.search({
          minX: (x / dpr - at.e) / camera.z,
          minY: (y / dpr - at.f) / camera.z,
          maxX: ((x + rw) / dpr - at.e) / camera.z,
          maxY: ((y + rh) / dpr - at.f) / camera.z,
        }))
          if (visible.has(id)) ids.add(id);
      }
      const { items } = collect(ids);
      drawShapes(items, camera.z);
      ctx.restore();
      canvas.dataset.canvas2dDrawn = String(items.length);
    }

    let stopUi = () => {};
    transact(() => {
      // The store is already published; the scene only derives from it.
      const shapes = shapeStore.snapshot();
      scene.sync(shapes, null, null, new Map());
      scene.camera.set(useCameraStore.getState().camera);
      stopUi = bindSceneUi(scene, editor.getShape);
      trackDomNative(shapes, null);
      syncDelegation();
    });

    /** The DOM sublayer's camera, written imperatively for the same reason
     *  `FlatShapeLayer` writes its own: it is one transform per frame, and a
     *  React render per frame is what this renderer exists to avoid. */
    const positionDomLayer = (camera: Camera) => {
      const layer = domLayerRef.current;
      if (!layer) return;
      layer.style.transform = cameraToTransform(
        camera,
        !useCameraInteraction.getState().isMoving,
      );
    };

    const themeObserver = new MutationObserver(() => {
      resolve = createCssVarResolver();
      themeEpoch++;
      cache.clear();
      paints.clear();
      paint();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    let previousVisible = new Set<string>();
    const stops = [
      subscribeDocumentChanges(({ shapes, ids, contentIds, previous }) => {
        scene.sync(shapes, ids, contentIds, previous);
        // A deleted shape's entry would otherwise hold its Path2D for the rest
        // of the session; nothing else ever removes one.
        for (const id of ids ?? [...cache.keys(), ...paints.keys()]) {
          if (shapes.has(id)) continue;
          cache.delete(id);
          paints.delete(id);
        }
        // After the scene, so `z` and the index already describe the change
        // the delegation is being recomputed against.
        trackDomNative(shapes, ids);
        syncDelegation();
      }),
      useCameraStore.subscribe(() =>
        scene.camera.set(useCameraStore.getState().camera),
      ),
      useLodStore.subscribe(paint),
      stopUi,
      useEraserCutStore.subscribe(() => {
        // A preview lasts one gesture; nothing conditioned for the last one is
        // worth keeping, and keeping it would leak an entry per fragment.
        cutCache = new Map();
        cutPaints = new Map();
        bitmap = null;
        refAt = null;
        paint();
      }),
      useCameraInteraction.subscribe(() => {
        positionDomLayer(scene.camera.get());
        paint();
      }),
      react('position canvas 2d dom layer', () => {
        positionDomLayer(scene.camera.get());
      }),
      // The delegated shapes cull exactly as the DOM layer's do; they are a
      // handful of containers, and an off-screen one must not keep painting.
      react('cull canvas 2d dom layer', () => {
        const visible = scene.visible.get();
        const display = (id: string, value: string) => {
          const element = containers.get(id);
          if (element) element.style.display = value;
          const overlay = overlays.get(id);
          if (overlay) overlay.style.display = value;
        };
        for (const id of previousVisible)
          if (!visible.has(id)) display(id, 'none');
        for (const id of visible)
          if (!previousVisible.has(id)) display(id, '');
        previousVisible = visible;
      }),
      react('paint canvas 2d', paint),
      () => themeObserver.disconnect(),
      () => {
        if (ref) ref.width = ref.height = 0;
        ref = null;
        // Drop the decoded bitmaps with the renderer; a page switch remounts
        // this effect and would otherwise keep the old page's images alive.
        for (const element of images.values())
          if (element !== 'failed') element.src = '';
        images.clear();
      },
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [scene, domIds, domHighlightIds, containers, overlays]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)]"
      data-canvas-engine="canvas-2d"
    >
      <canvas
        ref={canvasRef}
        data-shape-canvas
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
      />
      {/* The shapes the canvas hands back to the DOM, above it in the same
          stacking context — which is what `delegatedShapeIds` guarantees is
          the right side of every painted shape they overlap. */}
      <div
        ref={domLayerRef}
        data-shape-layer
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          transformOrigin: '0 0',
        }}
      >
        <ShapeList
          scene={scene}
          containers={containers}
          overlays={overlays}
          ids={domIds}
          highlightIds={domHighlightIds}
        />
      </div>
    </div>
  );
}
