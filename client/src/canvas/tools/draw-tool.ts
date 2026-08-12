import { Pencil } from 'lucide-react';
import {
  genId,
  type DrawPoint,
  type DrawProps,
  type Point,
  type Shape,
} from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { pencilStabilizationToStreamline } from '../shapes/ink';
import { NOMINAL_SAMPLE_SPACING } from '../shapes/ink-engine';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useStrokePredictionStore } from '../use-stroke-prediction-store';
import { useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/**
 * Freehand pen. Builds a draw shape point-by-point and leaves stroke cleanup to
 * the ink renderer so velocity and pressure dynamics stay intact.
 * Critically, on pointer-up it stays in the draw tool and does NOT select the
 * new stroke — no selection rectangle appears, so the user can keep drawing.
 */
/** Pressure stored when there is no signal to derive one from. */
const NEUTRAL_PRESSURE = 0.5;

/**
 * Pointer speed at which a velocity-driven stroke reaches its minimum width, in
 * CSS pixels per millisecond.
 *
 * Measured on screen and against the clock. Per-sample travel — the old proxy —
 * is really a measure of the hardware's report rate: a 60 Hz mouse and a 240 Hz
 * pen tracing the same line at the same speed report steps four times apart,
 * and drew visibly different strokes. Screen distance rather than world
 * distance because this stands in for how hard someone is pressing, which is a
 * property of the hand and not of the camera; in world units the same gesture
 * would thin out simply for having been drawn zoomed out. The value tracks what
 * the old heuristic produced on a 240 Hz pen, so the pencil still feels the way
 * it did.
 */
const SPEED_AT_MIN_WIDTH = 1.5;

/**
 * How far past the pointer the predicted tail may reach, in milliseconds.
 *
 * Prediction is extrapolation, and its error grows with the horizon. One frame
 * is enough to hide the input latency it exists to hide; beyond that the tip
 * wanders off the line and then visibly retracts when the real samples land.
 */
const PREDICTION_HORIZON_MS = 16;

/**
 * Points after which a continuous stroke is committed and continued in a new
 * shape.
 *
 * Every frame of a live stroke re-runs the outline pipeline over the whole
 * point array, so a stroke that is never lifted gets steadily more expensive to
 * draw and to send. Capping the array bounds that cost; the child shape starts
 * at the point the parent ended on, where both round caps land, so the split
 * leaves no visible seam.
 */
const MAX_POINTS_PER_SHAPE = 600;

/**
 * Zoom at which the camera term of the closure tolerance is half its maximum.
 *
 * Zoomed far out, the gap a hand leaves between the start and end of a loop
 * spans many more world units than the same gesture does at 1:1, so the
 * tolerance has to open up to keep "ended where it started" meaning the same
 * thing on screen.
 */
const CLOSE_ZOOM_KNEE = 0.18;

/** Largest the camera term of the closure tolerance can grow to, in world units. */
const CLOSE_ZOOM_TOLERANCE = 100;

/** Shortest stroke that may close, as a multiple of the brush width. */
const CLOSE_MIN_LENGTH_FACTOR = 4;

/**
 * How far the lift may land from the press and still enclose a region.
 *
 * The constant is the hand's own tolerance; the square-root term widens it for
 * thick brushes, whose two ends already overlap by a radius before their
 * centers meet; and the camera term dominates when zoomed out. See
 * {@link CLOSE_ZOOM_KNEE}.
 */
function closeThreshold(size: number, zoom: number): number {
  return (
    6 +
    2 * Math.sqrt(size * 0.8) +
    CLOSE_ZOOM_TOLERANCE / (1 + (zoom / CLOSE_ZOOM_KNEE) ** 3)
  );
}

function pathLength(points: DrawPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y,
    );
  }
  return total;
}

export function createDrawTool(): Tool {
  let id: string | null = null;
  let origin = { x: 0, y: 0 };
  let points: DrawPoint[] = [];
  // Browser-predicted tail (shape-local). Rendered locally via the prediction
  // store so visible ink reaches the predicted pointer position; NEVER written
  // to the document — peers only ever receive real samples.
  let predicted: DrawPoint[] = [];
  // Derive this stroke's pressure from pointer velocity (mouse/touch with the
  // simulation setting on). Pen strokes carry hardware pressure instead.
  let velocityPressure = false;
  // Previous raw hardware sample, for the velocity measurement. Tracked
  // separately from `points` because the spacing gate below drops samples, and
  // a dropped sample must not make the pointer look like it moved further in
  // the same time than it did.
  let lastSampleScreen: { x: number; y: number } | null = null;
  let lastSampleTime = 0;
  let lastVelocityPressure = NEUTRAL_PRESSURE;
  // Whether the first real velocity reading has been folded back into the
  // stroke's opening point. See `pressureFromVelocity`.
  let velocitySeeded = false;
  // Camera scale when the stroke began. Closure is judged against it rather
  // than the live camera so a zoom mid-stroke cannot change whether the loop
  // the hand drew counts as closed.
  let zoomOnEnter = 1;
  // Style and dynamics shared by every shape this gesture produces. Captured
  // once at pointer-down so a chunk split cannot pick up a different color or
  // brush partway through a single stroke.
  let strokeProps: DrawProps | null = null;
  // Whether the point cap has already split this gesture. See isClosedStroke.
  let chunked = false;
  // Pending rAF for the live stroke write. Pointer Events can deliver many
  // coalesced samples per frame; without this each sample fired its own Yjs
  // transaction → full document-snapshot rebuild → React commit. Coalescing the
  // writes to one per frame keeps every accumulated point (so the curve is
  // unchanged) while collapsing N pipeline runs per move into one per frame.
  let rafId: number | null = null;

  const cancelPendingFlush = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const scheduleFlush = (ctx: ToolContext): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!id) return;
      ctx.editor.updateShape(id, { props: { points: points.slice() } });
      // Same frame as the document write, so the rendered stroke and its
      // predicted tail always advance together.
      useStrokePredictionStore.getState().setPrediction(id, predicted);
    });
  };

  /**
   * Whether the finished stroke ends near enough to its start to enclose a
   * region, which is what lets it be filled and hit-tested as an area.
   *
   * A short stroke is excluded outright: over a distance of a few brush widths
   * the two ends are never far enough apart for landing close together to say
   * anything about intent. So is any stroke the point cap has already split:
   * a chunk begins where the previous one was cut, not where the hand pressed,
   * so the region it would enclose is not one anybody drew.
   */
  const isClosedStroke = (): boolean => {
    const size = strokeProps?.size;
    if (chunked || !size || points.length < 3) return false;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x === last.x && first.y === last.y) return false;
    if (pathLength(points) <= size * CLOSE_MIN_LENGTH_FACTOR) return false;
    return (
      Math.hypot(last.x - first.x, last.y - first.y) <=
      closeThreshold(size, zoomOnEnter)
    );
  };

  // Commit the accumulated points to the shape and end the stroke. Shared by
  // pointer-up (normal finish), commit (OS reclaimed the pointer mid-stroke),
  // and the chunk split, which ends one shape to continue in the next.
  const finalize = (ctx: ToolContext): void => {
    cancelPendingFlush();
    predicted = [];
    useStrokePredictionStore.getState().clearPrediction();
    const sid = id;
    id = null;
    if (!sid) return;
    // Final synchronous write, covering the flush this cancelled. The points are
    // committed exactly as drawn: the samples are the record of the path the
    // hand took, and thinning them here would cut corners off the stroke the
    // moment the pointer lifts.
    ctx.editor.updateShape(sid, {
      props: { points: points.slice(), isClosed: isClosedStroke() },
    });
    points = [];
  };

  // Create the shape the gesture is currently drawing into, seeded with its
  // first point. Used at pointer-down and again at each chunk split.
  const beginShape = (ctx: ToolContext, worldOrigin: Point, seed: DrawPoint) => {
    if (!strokeProps) return;
    origin = worldOrigin;
    points = [seed];
    const sid = genId();
    id = sid;
    ctx.editor.createShape({
      id: sid,
      type: 'draw',
      x: worldOrigin.x,
      y: worldOrigin.y,
      rotation: 0,
      opacity: useStyleStore.getState().opacity,
      index: getTopIndex(ctx.editor.getShapes()),
      props: { ...strokeProps, points: points.slice() },
    } as Shape);
  };

  /**
   * Commit the current shape and continue the same gesture in a new one once
   * the point cap is reached. See {@link MAX_POINTS_PER_SHAPE}.
   */
  const splitIfFull = (ctx: ToolContext): void => {
    if (points.length < MAX_POINTS_PER_SHAPE) return;
    const last = points[points.length - 1]!;
    const worldOrigin = { x: origin.x + last.x, y: origin.y + last.y };
    chunked = true;
    finalize(ctx);
    beginShape(ctx, worldOrigin, { x: 0, y: 0, pressure: last.pressure });
  };

  // Minimum spacing between recorded samples, in world units. See `appendPoint`.
  // Shared with the ink engine, which calibrates its filters at this spacing.
  const MIN_SAMPLE_DISTANCE = NOMINAL_SAMPLE_SPACING;

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const stylusPressure = (pressure: number): number => clamp01(pressure * 1.25);

  /**
   * Pressure from how fast the pointer is travelling. Consumes the raw sample
   * rate rather than the stored one, so it must be called exactly once per
   * incoming sample, in order.
   */
  const pressureFromVelocity = (info: ToolPointerInfo): number => {
    const previousScreen = lastSampleScreen;
    const elapsed = info.timestamp - lastSampleTime;
    lastSampleScreen = info.screenPoint;
    lastSampleTime = info.timestamp;
    // Nothing to measure against yet, or two samples share a timestamp: hold
    // the last reading rather than reporting an infinite speed.
    if (!previousScreen) return lastVelocityPressure;
    if (!(elapsed > 0)) return lastVelocityPressure;
    const speed =
      Math.hypot(
        info.screenPoint.x - previousScreen.x,
        info.screenPoint.y - previousScreen.y,
      ) / elapsed;
    lastVelocityPressure = clamp01(1 - speed / SPEED_AT_MIN_WIDTH);
    // Pointer-down has nothing to measure against, so the stroke opens at the
    // neutral default and the engine then spends several world units easing
    // from it to the speed the hand was actually moving at — every stroke
    // began at mid weight regardless of how it was drawn. The first real
    // reading is the one that describes that opening, so put it there.
    // Replace rather than mutate: an earlier flush may already have handed the
    // old object to Yjs via `points.slice()`.
    if (!velocitySeeded) {
      velocitySeeded = true;
      const first = points[0];
      if (first) points[0] = { ...first, pressure: lastVelocityPressure };
    }
    return lastVelocityPressure;
  };

  // Stylus pressure is conditioned once at ingestion and then persisted; so is
  // velocity-derived pressure, which is why the engine's own simulation stays
  // off for new strokes. Everything else stores the neutral default.
  const pressureFor = (info: ToolPointerInfo): number => {
    if (info.pointerType === 'pen') return stylusPressure(info.pressure);
    if (velocityPressure) return pressureFromVelocity(info);
    return NEUTRAL_PRESSURE;
  };

  const snapToAngle = (point: DrawPoint): DrawPoint => {
    const start = points[0];
    if (!start) return point;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return point;
    const increment = Math.PI / 12;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / increment) * increment;
    return {
      ...point,
      x: start.x + Math.cos(snappedAngle) * length,
      y: start.y + Math.sin(snappedAngle) * length,
    };
  };

  const appendPoint = (info: ToolPointerInfo): boolean => {
    let local: DrawPoint = {
      x: info.point.x - origin.x,
      y: info.point.y - origin.y,
      pressure: pressureFor(info),
    };
    if (info.shiftKey) {
      local = snapToAngle(local);
      const start = points[0];
      const currentEnd = points[1];
      if (
        start &&
        currentEnd &&
        currentEnd.x === local.x &&
        currentEnd.y === local.y &&
        currentEnd.pressure === local.pressure
      ) {
        return false;
      }
      points = start ? [start, local] : [local];
      return true;
    }

    const last = points[points.length - 1];
    if (last) {
      // Gate on world distance, not screen distance: a zoom-scaled gate made
      // the recorded path a function of the camera. The same gesture came out
      // ~36% of a brush width apart drawn at zoom 4 vs zoom 1, and zoomed out
      // the gate was wide enough (20 world units at zoom 0.05) to throw away
      // real pointer samples. One world unit is what a zoom-1 stroke already
      // captured, so feel there is unchanged and every other zoom now matches
      // it — and it is the spacing the engine calibrates its filters at.
      // Pressure is still merged so slow stationary strokes retain their
      // thickness response.
      if (Math.hypot(last.x - local.x, last.y - local.y) < MIN_SAMPLE_DISTANCE) {
        if (last.pressure === local.pressure) return false;
        // Replace (don't mutate): the previous object was already handed to Yjs
        // by an earlier flush's `points.slice()`, so mutating it in place would
        // desync the stored value from the document.
        points[points.length - 1] = { ...last, pressure: local.pressure };
        return true;
      }
    }
    points.push(local);
    return true;
  };

  // Shape-local predicted tail for this move. Straight-line (shift) mode snaps
  // the whole stroke to two points, so prediction is meaningless there.
  const predictedFor = (info: ToolPointerInfo): DrawPoint[] => {
    if (info.shiftKey || !info.predicted?.length) return [];
    const anchor = points[points.length - 1];
    // Where the stroke is currently heading. Prediction that folds back on
    // this is the browser overshooting a direction change; carrying it would
    // hook the tip backwards over ink that is already drawn.
    const behind = points[points.length - 2];
    let headingX = 0;
    let headingY = 0;
    if (anchor && behind) {
      headingX = anchor.x - behind.x;
      headingY = anchor.y - behind.y;
    }
    const heading = headingX !== 0 || headingY !== 0;
    // The tail's pressure is held at the last real sample's: a predicted point
    // has no measurable velocity and no hardware reading, so anything else
    // would change the stroke's width at the junction.
    const pressure =
      info.pointerType === 'pen'
        ? stylusPressure(info.pressure)
        : velocityPressure
          ? lastVelocityPressure
          : NEUTRAL_PRESSURE;
    const tail: DrawPoint[] = [];
    for (const p of info.predicted) {
      if (p.t - info.timestamp > PREDICTION_HORIZON_MS) break;
      const local: DrawPoint = {
        x: p.x - origin.x,
        y: p.y - origin.y,
        pressure,
      };
      if (anchor) {
        const dx = local.x - anchor.x;
        const dy = local.y - anchor.y;
        // Same gate as real samples, so a stationary pointer's prediction
        // noise doesn't wiggle the tip in place.
        if (Math.hypot(dx, dy) < MIN_SAMPLE_DISTANCE) continue;
        if (heading && dx * headingX + dy * headingY <= 0) break;
      }
      tail.push(local);
    }
    return tail;
  };

  const sameTail = (a: DrawPoint[], b: DrawPoint[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i]!.x !== b[i]!.x || a[i]!.y !== b[i]!.y) return false;
    }
    return true;
  };

  return {
    id: 'draw',
    label: 'Draw',
    hotkey: 'd',
    cursor: 'crosshair',
    icon: Pencil,
    // Every sample is a reading of where the hand was and when. Dropping them
    // costs path detail on fast strokes and, with velocity-derived pressure,
    // coarsens the speed measurement the stroke's width comes from. The rAF
    // flush below keeps the extra samples from costing extra document writes.
    wantsCoalescedSamples: true,
    // Local-only render affordance: the live stroke's tail extends to the
    // browser's predicted pointer position, cutting perceived latency. The
    // document write path is untouched — peers receive real samples per frame.
    wantsPredictedSamples: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('draw');
      if (!util) return;
      const pencil = useCanvasUiStore.getState();
      // Real pens carry hardware pressure; only mouse/touch fall back to the
      // user's velocity-based simulation preference.
      velocityPressure =
        info.pointerType !== 'pen' && pencil.pencilSimulatePressure;
      lastSampleScreen = null;
      lastSampleTime = info.timestamp;
      lastVelocityPressure = NEUTRAL_PRESSURE;
      velocitySeeded = false;
      chunked = false;
      zoomOnEnter = info.zoom;
      const style = useStyleStore.getState();
      strokeProps = {
        ...(util.getDefaultProps() as DrawProps),
        points: [],
        color: style.color,
        size: style.size,
        dash: style.dash,
        // Only ever seen once the stroke closes on itself; an open squiggle
        // renders the same whatever the fill style is set to.
        fillStyle: style.fill,
        // The points already carry pressure — hardware or velocity-derived —
        // so the engine must read it rather than re-deriving one from sample
        // spacing. The flag stays in the schema for strokes saved before
        // that was true.
        simulatePressure: false,
        thinning: pencil.pencilThinning,
        smoothing: pencil.pencilSmoothing,
        streamline: pencilStabilizationToStreamline(pencil.pencilStabilization),
        startTaper: pencil.pencilStartTaper,
        endTaper: pencil.pencilEndTaper,
      };
      beginShape(ctx, info.point, {
        x: 0,
        y: 0,
        pressure: pressureFor(info),
      });
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!id) return;
      const appended = appendPoint(info);
      if (appended) splitIfFull(ctx);
      // A held-still pointer can still emit predictions every frame. Flushing
      // on those would run the mutate → snapshot → reconcile pipeline once a
      // frame to redraw an identical stroke, so only a real change schedules.
      const nextPredicted = predictedFor(info);
      const tailChanged = !sameTail(predicted, nextPredicted);
      predicted = nextPredicted;
      if (appended || tailChanged) scheduleFlush(ctx);
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      appendPoint(info);
      finalize(ctx);
      // Stay in the draw tool; intentionally no selection of the new stroke.
    },

    // The OS reclaimed the pen/mouse mid-stroke (spurious pointercancel /
    // lostpointercapture). Keep the ink drawn so far rather than discarding it.
    onCommit(ctx: ToolContext) {
      finalize(ctx);
    },

    // Switching tools mid-stroke (a hotkey while the pointer is still down)
    // never routes a pointer-up back here, so without this the stroke kept
    // whatever the last rAF flush wrote and left that flush pending against an
    // orphaned shape. Commit it, matching onCommit's "keep what was drawn".
    onExit(ctx: ToolContext) {
      finalize(ctx);
    },

    // A pinch (or tool switch) mid-stroke discards the partial stroke entirely.
    onCancel(ctx: ToolContext) {
      cancelPendingFlush();
      predicted = [];
      useStrokePredictionStore.getState().clearPrediction();
      const sid = id;
      id = null;
      points = [];
      if (sid) ctx.editor.deleteShapes([sid]);
    },
  };
}
