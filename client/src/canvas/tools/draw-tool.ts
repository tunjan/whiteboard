import type { ComponentType } from 'react';
import { PenGlyph } from '@/components/ui/glyphs';
import {
  genId,
  type DrawPoint,
  type DrawProps,
  type DrawShape,
  type Point,
  type PressureEasing,
  type Shape,
} from '@whiteboard/shared';
import { topFrameAtPoint } from '../frame-operations';
import { getBottomIndex, getIndexAboveTopmostOf, getTopIndex } from '../order';
import { InputsManager, isPenOrStylus } from '../inputs-manager';
import {
  DEFAULT_PENCIL_STABILIZATION,
  REFERENCE_PENCIL_DYNAMICS,
  STROKE_PROFILES,
  liftTaperFor,
  pencilStabilizationToStreamline,
  type EndTaperMode,
  type PencilPressureCurve,
} from '../shapes/ink';
import { NOMINAL_SAMPLE_SPACING } from '../shapes/ink-engine';
import { shapeRegistry } from '../shapes/shape-registry';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import {
  beginLiveStroke,
  endLiveStroke,
  publishLiveStroke,
} from '../use-live-stroke-store';
import { nextShapeStyle } from '../use-style-store';
import { playPenToolSound } from './pen-tool-sound';
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
 * How long a predicted tail may go un-refreshed before it is taken back down.
 *
 * Deliberately longer than the horizon, and so than the interval moves arrive
 * at: a deadline at the horizon itself would keep expiring in the gaps between
 * the moves of an ordinary 60 Hz stroke, blanking the tip for a frame at a
 * time. One frame past it distinguishes "the next sample is a moment late" from
 * "there is no next sample, because the hand has stopped".
 */
const TAIL_STALE_MS = PREDICTION_HORIZON_MS * 2;

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
 * Screen distance the pointer must travel after Shift is pressed or released
 * before the stroke actually changes mode, squared.
 *
 * Pressing a modifier is not by itself a statement about the ink: a hand
 * reaching for Shift mid-stroke frequently taps it, and switching on the
 * keystroke alone replaced whatever had just been drawn with a straight
 * segment the moment the key went down. Requiring a few pixels of travel makes
 * the switch something the hand does rather than something the keyboard does,
 * and gives the same hysteresis on the way back to freehand.
 */
const MODE_SWITCH_SCREEN_DISTANCE_SQUARED = 16;

/**
 * How near an existing stroke's free end a Shift-click must land to continue it
 * rather than begin a new one, in screen pixels.
 */
const EXTEND_SCREEN_RADIUS = 12;

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

/**
 * How a tool built on this state machine lays ink down.
 *
 * `pencil` is the freehand pen: it follows the pencil dynamics from Settings,
 * carries hardware or velocity pressure, and stacks on top of the page like any
 * other new shape.
 *
 * `marker` is the highlighter: one flat translucent band of constant width that
 * lands *under* what is already drawn, so the ink it crosses stays crisp
 * instead of being tinted by the wash laid over it.
 */
export type InkKind = 'pencil' | 'marker';

/** Identity and ink kind of one tool built on the draw state machine. */
export interface DrawToolConfig {
  id: string;
  label: string;
  hotkey: string;
  icon: ComponentType<{ className?: string }>;
  ink: InkKind;
}

const PENCIL_CONFIG: DrawToolConfig = {
  id: 'draw',
  label: 'Draw',
  hotkey: 'd',
  icon: PenGlyph,
  ink: 'pencil',
};

/**
 * How much wider than the pen the marker is at the same size setting.
 *
 * A highlighter has to cover a line of handwriting in a single pass, and the
 * four size presets are quoted for a pen nib. Scaling them keeps the one shared
 * size control meaningful for both tools instead of giving the marker a second
 * one to keep in sync.
 */
const MARKER_SIZE_SCALE = 6;

/**
 * How translucent a new marker stroke is.
 *
 * Fixed rather than read from the style panel: the wash reads as a highlight
 * only while the page under it still shows through, and an opaque band would
 * bury whatever it crosses that is not ink — an image, a graph, the grid. The
 * stroke's own opacity stays editable once it is selected, like any shape's.
 */
const MARKER_OPACITY = 1;

/**
 * Marker stabilization and softening, as engine weights rather than the
 * Settings slider the pencil reads.
 *
 * The pencil's zoom correction is deliberately not applied here. It exists
 * because a hand's tremor covers more world units zoomed out and shows in a
 * fine line; a band six times wider than the nib swallows that tremor at every
 * zoom, so correcting for it would only round off the corners of a deliberate
 * gesture.
 */
const MARKER_STREAMLINE = 0.5;
const MARKER_SMOOTHING = 0.5;

/**
 * Where a marker stroke goes in the stacking order: under the drawing, but
 * never under the frame it was drawn on.
 *
 * Straight to the back is what "highlight" means — the ink keeps its own colour
 * and the wash sits behind it. But a frame paints an opaque background across
 * its whole area, so a stroke behind *that* is not behind the drawing, it is
 * gone. Only a frame under the press can hide this stroke, so only that frame
 * constrains it: the wash lands just above it, which
 * `getIndexAboveTopmostOf` still keeps below whatever is stacked higher — the
 * frame's own content included. Anywhere else on the board the stroke goes all
 * the way to the back, where a highlight belongs.
 */
function markerIndex(shapes: readonly Shape[], at: Point): string {
  const frame = topFrameAtPoint(shapes, at);
  return frame === null
    ? getBottomIndex(shapes)
    : getIndexAboveTopmostOf(shapes, [frame.id]);
}

export function createDrawTool(config: DrawToolConfig = PENCIL_CONFIG): Tool {
  let id: string | null = null;
  let origin = { x: 0, y: 0 };
  let points: DrawPoint[] = [];
  // Browser-predicted tail (shape-local). Rendered locally via the prediction
  // store so visible ink reaches the predicted pointer position; NEVER written
  // to the document — peers only ever receive real samples.
  let predicted: DrawPoint[] = [];
  // Whether this stroke draws a predicted tail at all. Set at pointer-down from
  // the preference and the stroke's own dynamics; off unless both allow it.
  let predictionEnabled = false;
  // Screen position whose motion produced the current predicted tail. Some
  // browsers repeat an identical pointermove and prediction after the hand has
  // stopped; that repetition must not make the extrapolation fresh again.
  let predictionAnchorScreen: Point | null = null;
  // Once a tail expires, suppress that same prediction until the real pointer
  // advances. Otherwise the next repeated stationary event resurrects it.
  let stalePredictionAnchorScreen: Point | null = null;
  // Derive this stroke's pressure from pointer velocity (mouse/touch with the
  // simulation setting on). Pen strokes carry hardware pressure instead.
  let velocityPressure = false;
  const inputs = new InputsManager();
  let stylusInput = false;
  // Filtered pointer speed at the most recent sample, in screen px/ms. Tracked
  // for every stroke, not only the ones deriving width from it: the lift taper
  // asks how fast the hand was moving when it left the page, and that question
  // is just as meaningful for a stylus carrying its own pressure.
  let lastSpeed = 0;
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
  // Likewise the opacity, which the active-stroke layer has to reproduce for
  // the live stroke to look like the shape it is writing.
  let strokeOpacity = 1;
  // How this gesture's last chunk finishes, captured at pointer-down so that
  // changing the preference mid-stroke cannot reshape the end of a stroke that
  // is already being drawn.
  let endTaperMode: EndTaperMode = 'off';
  // Whether the point cap has already split this gesture. See isClosedStroke.
  let chunked = false;
  // Shapes earlier chunks of this gesture were committed into, with what each
  // held before the gesture touched it. `id` only ever names the chunk being
  // drawn, so without these a cancelled long stroke left every chunk but the
  // last one on the canvas.
  let committedChunks: { id: string; restore: DrawPoint[] | null }[] = [];
  // Index in `points` the current straight segment is drawn from, or null when
  // the stroke is freehand. Everything past it is the segment's single moving
  // endpoint, so leaving straight mode simply stops rewriting that endpoint and
  // resumes appending after it.
  let straightAnchor: number | null = null;
  // The last stylus position that cleared the one-screen-pixel sampling gate.
  // A merged tip may move between this point and the next accepted sample.
  let lastRecordedPoint: Point | null = null;
  // Set for the first freehand sample after a straight segment. That sample is
  // joined through an eased bridge instead of making one hard corner.
  let bridgeFromStraight = false;
  // A mode change Shift has asked for but that has not yet travelled far enough
  // to take effect, and the screen position it was asked at.
  // See MODE_SWITCH_SCREEN_DISTANCE_SQUARED.
  let pendingMode: 'straight' | 'free' | null = null;
  let pendingModeScreen: Point | null = null;
  // Points the adopted shape held before this gesture began appending to it,
  // or null when the gesture created its own shape. A cancelled stroke is
  // discarded by deleting the shape it made — but an extension did not make
  // one, and deleting it would take the ink that was already there with it.
  let extendedFrom: DrawPoint[] | null = null;
  // Pending rAF for the live stroke write. Pointer Events can deliver many
  // coalesced samples per frame; without this each sample fired its own Yjs
  // transaction → full document-snapshot rebuild → React commit. Coalescing the
  // writes to one per frame keeps every accumulated point (so the curve is
  // unchanged) while collapsing N pipeline runs per move into one per frame.
  let rafId: number | null = null;
  // Pending deadline for dropping a stale tail. See `scheduleTailExpiry`.
  let tailExpiry: ReturnType<typeof setTimeout> | null = null;

  const cancelPendingWork = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (tailExpiry !== null) {
      clearTimeout(tailExpiry);
      tailExpiry = null;
    }
  };

  /**
   * Hand the current stroke to the active-stroke layer, which draws it.
   *
   * Called from inside the rAF below, so the ink is in the DOM before the
   * browser paints that frame. Publishing it through the document instead
   * would schedule a React render that can land after the paint it was meant
   * for — the delay the predicted tail exists to hide.
   */
  const publishFrame = (): void => {
    if (!strokeProps) return;
    publishLiveStroke({
      origin,
      props: strokeProps,
      opacity: strokeOpacity,
      points,
      predicted,
    });
  };

  const scheduleFlush = (ctx: ToolContext): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!id) return;
      // Peers still receive every frame of the stroke: the document write is
      // unchanged, and is what makes them watch it being drawn.
      ctx.editor.updateShape(id, { props: { points: points.slice(), isComplete: false } });
      // Same frame as the document write, so the rendered stroke and its
      // predicted tail always advance together.
      publishFrame();
    });
  };

  /**
   * Drop the tail once no move has arrived to re-derive it for long enough that
   * it has stopped describing anything.
   *
   * A tail says where the pointer is about to be, so it is worth drawing for
   * about the horizon it was extrapolated over and no longer. While the hand
   * travels this deadline never fires: advancing positions arrive faster than
   * it, and each one pushes it back. But a hand finishing a stroke *stops*.
   * Some browsers then emit nothing; others repeat the same last move and
   * prediction. Neither is fresh motion, so the tail has to expire from the
   * last position that really advanced or it stays past the hand until
   * pointer-up clears it — ink overshooting and then snapping back on release.
   *
   * Expiring is local-only: the tail was never in the document, so this
   * republishes the live frame and writes nothing.
   */
  const scheduleTailExpiry = (): void => {
    if (tailExpiry !== null) clearTimeout(tailExpiry);
    tailExpiry = setTimeout(() => {
      tailExpiry = null;
      if (!id) return;
      stalePredictionAnchorScreen = predictionAnchorScreen
        ? { ...predictionAnchorScreen }
        : null;
      if (predicted.length === 0) return;
      predicted = [];
      publishFrame();
    }, TAIL_STALE_MS);
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
    if (pathLength(points) <= size * CLOSE_MIN_LENGTH_FACTOR) return false;
    return (
      Math.hypot(last.x - first.x, last.y - first.y) <=
      closeThreshold(size, zoomOnEnter)
    );
  };

  /**
   * The taper this stroke's ending has earned, as a props patch to fold into
   * the final write, or nothing when the finish is not velocity-driven.
   *
   * Only written at the end, and deliberately: a taper is what the nib leaves
   * on the way off the page, so there is nothing to draw one from until the
   * hand has actually left. The live stroke therefore shows a round cap right
   * up to the lift and grows the taper on release, which is the order the
   * gesture happens in.
   *
   * `finalize` also runs when the OS takes the pointer away mid-stroke. The
   * speed read there is the speed the hand really was moving at, so a stroke
   * interrupted mid-flick tapers exactly as one lifted mid-flick would.
   */
  const liftTaper = (): { endTaper: number } | undefined => {
    const size = strokeProps?.size;
    if (endTaperMode !== 'velocity' || !size) return undefined;
    return { endTaper: liftTaperFor(lastSpeed, size, pathLength(points)) };
  };

  // Commit the accumulated points to the shape and end the stroke. Shared by
  // pointer-up (normal finish), commit (OS reclaimed the pointer mid-stroke),
  // and the chunk split, which ends one shape to continue in the next.
  //
  // `continuing` says the hand is still down and the stroke carries on in the
  // next chunk, so this end is a cut and not a lift: it keeps its round cap
  // instead of tapering to a point at a place nobody stopped.
  const finalize = (ctx: ToolContext, continuing = false): void => {
    cancelPendingWork();
    predicted = [];
    // Before the write below, so that write publishes a snapshot like any
    // other. React then commits the un-filtered document copy and the unmounted
    // layer together, and the ink is never missing from both for a frame.
    endLiveStroke();
    const sid = id;
    id = null;
    if (!sid) return;
    // Final synchronous write, covering the flush this cancelled. The points are
    // committed exactly as drawn: the samples are the record of the path the
    // hand took, and thinning them here would cut corners off the stroke the
    // moment the pointer lifts.
    ctx.editor.updateShape(sid, {
      props: {
        points: points.slice(),
        isComplete: true,
        isClosed: isClosedStroke(),
        ...(continuing ? { endTaper: false } : liftTaper()),
      },
    });
    points = [];
    if (!continuing) {
      committedChunks = [];
      extendedFrom = null;
      straightAnchor = null;
      lastRecordedPoint = null;
      bridgeFromStraight = false;
      pendingMode = null;
      pendingModeScreen = null;
    }
  };

  // Create the shape the gesture is currently drawing into, seeded with its
  // first point. Used at pointer-down and again at each chunk split.
  const beginShape = (
    ctx: ToolContext,
    worldOrigin: Point,
    seed: DrawPoint,
  ) => {
    if (!strokeProps) return;
    extendedFrom = null;
    origin = worldOrigin;
    points = [seed];
    lastRecordedPoint = { x: seed.x, y: seed.y };
    bridgeFromStraight = false;
    const sid = genId();
    id = sid;
    ctx.editor.createShape({
      id: sid,
      type: 'draw',
      x: worldOrigin.x,
      y: worldOrigin.y,
      rotation: 0,
      opacity: strokeOpacity,
      index:
        config.ink === 'marker'
          ? markerIndex(ctx.editor.getShapes(), worldOrigin)
          : getTopIndex(ctx.editor.getShapes()),
      props: { ...strokeProps, isComplete: false, points: points.slice() },
    } as Shape);
    beginLiveStroke(sid);
    // A press that never moves still leaves a dot, so publish the seed rather
    // than waiting for a pointer move the hand may never make.
    publishFrame();
  };

  /**
   * Commit the current shape and continue the same gesture in a new one once
   * the point cap is reached. See {@link MAX_POINTS_PER_SHAPE}.
   */
  const splitIfFull = (ctx: ToolContext): void => {
    if (points.length < MAX_POINTS_PER_SHAPE || !strokeProps) return;
    const last = points[points.length - 1]!;
    const worldOrigin = { x: origin.x + last.x, y: origin.y + last.y };
    chunked = true;
    if (id) committedChunks.push({ id, restore: extendedFrom });
    finalize(ctx, true);
    // The continuation begins where the last chunk was cut, not where the hand
    // pressed, so it must not open with the start taper again — that would pinch
    // the line to nothing in the middle of an unbroken stroke.
    strokeProps = { ...strokeProps, startTaper: 0 };
    beginShape(ctx, worldOrigin, { x: 0, y: 0, pressure: last.pressure });
    // The anchor indexed the chunk that just closed. The seed is the same
    // position under a new index, so a straight segment in progress continues
    // from it rather than from a point that is no longer in this array.
    if (straightAnchor !== null) straightAnchor = 0;
  };

  // Minimum spacing between recorded samples, in world units. See `appendPoint`.
  // Shared with the ink engine, which calibrates its filters at this spacing.
  const MIN_SAMPLE_DISTANCE = NOMINAL_SAMPLE_SPACING;

  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

  const stylusPressure = (pressure: number): number => clamp01(pressure * 1.25);

  /**
   * Advance the velocity filter by one incoming sample.
   *
   * The filter consumes the raw sample rate rather than the stored one, so
   * this must be called exactly once per incoming sample, in order — which is
   * why it sits at the top of `appendPoint` rather than inside the pressure
   * path it used to live in. A stylus stroke skips that path entirely, and its
   * lift is precisely the sample whose speed the taper needs.
   */
  const trackVelocity = (info: ToolPointerInfo): void => {
    const velocity = inputs.update(info.screenPoint, info.timestamp);
    lastSpeed = Math.hypot(velocity.x, velocity.y);
  };

  /**
   * Pressure from how fast the pointer is travelling, as measured by the most
   * recent {@link trackVelocity}.
   */
  const pressureFromVelocity = (): number => {
    lastVelocityPressure = clamp01(1 - lastSpeed / SPEED_AT_MIN_WIDTH);
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

  // Reference strokes store hardware pressure or neutral samples. Extended
  // legacy strokes retain their original capture-time velocity model.
  const pressureFor = (info: ToolPointerInfo): number => {
    if (stylusInput) return stylusPressure(info.pressure);
    if (velocityPressure && strokeProps?.inkAlgorithm !== 'reference')
      return pressureFromVelocity();
    return NEUTRAL_PRESSURE;
  };

  /**
   * The pressure curve this stroke is drawn with.
   *
   * `medium` means "whichever curve this input calls for", which is what every
   * stroke used before the preference existed — a stylus reading real force
   * wants a different response from a mouse whose "pressure" is its own speed.
   * The two deliberate ends override that for both, because someone who says
   * the pen is too soft is saying it about the pointer they actually have.
   */
  const pressureEasingFor = (curve: PencilPressureCurve): PressureEasing => {
    if (curve !== 'medium') return curve;
    if (stylusInput) return 'stylus';
    return velocityPressure ? 'ease-out-sine' : 'linear';
  };

  const snapToAngle = (point: DrawPoint, start: DrawPoint): DrawPoint => {
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

  /**
   * Advance the freehand/straight state machine for this move.
   *
   * A mode change is armed by the modifier and committed by travel, so a Shift
   * tap that the hand does not follow through on leaves the stroke alone. The
   * anchor is taken where the threshold is crossed rather than where the key
   * went down: the few pixels in between were drawn freehand and are the
   * stroke, not an artifact to be discarded.
   */
  const updateMode = (info: ToolPointerInfo): void => {
    const wanted = info.shiftKey ? 'straight' : 'free';
    const current = straightAnchor === null ? 'free' : 'straight';
    if (wanted === current) {
      pendingMode = null;
      pendingModeScreen = null;
      return;
    }
    if (pendingMode !== wanted || !pendingModeScreen) {
      pendingMode = wanted;
      pendingModeScreen = { ...info.screenPoint };
      return;
    }
    const dx = info.screenPoint.x - pendingModeScreen.x;
    const dy = info.screenPoint.y - pendingModeScreen.y;
    if (dx * dx + dy * dy < MODE_SWITCH_SCREEN_DISTANCE_SQUARED) return;
    pendingMode = null;
    pendingModeScreen = null;
    if (wanted === 'straight') {
      straightAnchor = points.length - 1;
      bridgeFromStraight = false;
    } else {
      straightAnchor = null;
      bridgeFromStraight = true;
    }
  };

  /**
   * The draw shape whose free end is close enough to `point` for a Shift-click
   * to continue it, if there is one.
   *
   * Rotated strokes are excluded. Appending to one would mean inverse-rotating
   * every sample into its local frame, and because a draw shape rotates about
   * the centre of its own bounds, each appended point would move the pivot the
   * rest of the stroke is drawn around.
   */
  const extendableAt = (ctx: ToolContext, info: ToolPointerInfo) => {
    const radius = EXTEND_SCREEN_RADIUS / Math.max(info.zoom, 1e-6);
    let best: { shape: DrawShape; distance: number } | null = null;
    for (const shape of ctx.editor.getShapes()) {
      if (shape.type !== 'draw' || shape.locked || shape.rotation) continue;
      const last = shape.props.points[shape.props.points.length - 1];
      if (!last) continue;
      const distance = Math.hypot(
        shape.x + last.x - info.point.x,
        shape.y + last.y - info.point.y,
      );
      if (distance > radius) continue;
      if (!best || distance < best.distance) best = { shape, distance };
    }
    return best?.shape ?? null;
  };

  /**
   * Continue an existing stroke instead of starting a new one: the gesture
   * opens in straight mode anchored on that stroke's free end, and every
   * appended point lands in the same shape record.
   */
  const extendShape = (shape: DrawShape): void => {
    extendedFrom = shape.props.points.slice();
    // `points[0]` is the adopted stroke's opening point, drawn long ago. The
    // seeding in `pressureFromVelocity` exists to give a stroke's own first
    // sample a real velocity reading; letting it run here would reach back and
    // rewrite the width at the far end of ink this gesture never touched.
    velocitySeeded = true;
    strokeProps = { ...shape.props, isComplete: false };
    strokeOpacity = shape.opacity ?? 1;
    origin = { x: shape.x, y: shape.y };
    points = shape.props.points.slice();
    const last = points[points.length - 1];
    lastRecordedPoint = last ? { x: last.x, y: last.y } : null;
    bridgeFromStraight = false;
    id = shape.id;
    straightAnchor = points.length - 1;
    beginLiveStroke(shape.id);
    publishFrame();
  };

  const easeInOutQuad = (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

  /**
   * Join a completed straight segment to the first freehand sample.
   *
   * The short inward nudges avoid duplicate boundary points. A smoothstep
   * distributes the synthetic points without a velocity jump, and the pressure
   * dip keeps the join from forming a heavy knot.
   */
  const appendStraightBridge = (to: DrawPoint): boolean => {
    const from = points[points.length - 1];
    if (!from) {
      points.push(to);
      lastRecordedPoint = { x: to.x, y: to.y };
      return true;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return false;

    const unitX = dx / distance;
    const unitY = dy / distance;
    const inset = Math.min(1, Math.floor(distance / 4));
    const startX = from.x + unitX * inset;
    const startY = from.y + unitY * inset;
    const endX = to.x - unitX * inset;
    const endY = to.y - unitY * inset;
    const steps = Math.max(4, Math.floor(distance / 16));

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const eased = t * t;
      const x = startX + (endX - startX) * eased;
      const y = startY + (endY - startY) * eased;
      // An inset of zero makes the first synthetic point equal the segment's
      // existing endpoint. Do not store a duplicate just to begin the bridge.
      if (i === 0 && x === from.x && y === from.y) continue;
      const pressurePhase = easeInOutQuad(t);
      points.push({
        ...to,
        x,
        y,
        pressure: Math.min(1, 0.5 + Math.abs(0.5 - pressurePhase) * 0.65),
      });
    }
    points.push(to);
    lastRecordedPoint = { x: to.x, y: to.y };
    return true;
  };

  const appendPoint = (
    info: ToolPointerInfo,
    pressureOverride?: number,
  ): boolean => {
    trackVelocity(info);
    let local: DrawPoint = {
      x: info.point.x - origin.x,
      y: info.point.y - origin.y,
      pressure: pressureOverride ?? pressureFor(info),
      // Only a stylus has a barrel to lean, and only a stylus stroke pays the
      // two extra channels for storing where it leaned. Everything else omits
      // them and reads back as the upright pen it was.
      ...(stylusInput
        ? { tiltX: info.tiltX ?? 0, tiltY: info.tiltY ?? 0 }
        : {}),
    };
    const anchor = straightAnchor === null ? null : points[straightAnchor];
    if (anchor) {
      // Only the modifier snaps the angle. While a release is still waiting out
      // its travel threshold the segment stays straight but follows the pointer
      // freely, so the ink is already heading where the freehand stroke will
      // continue from by the time the mode actually changes.
      if (info.shiftKey) local = snapToAngle(local, anchor);
      const currentEnd = points[straightAnchor! + 1];
      if (
        currentEnd &&
        currentEnd.x === local.x &&
        currentEnd.y === local.y &&
        currentEnd.pressure === local.pressure
      ) {
        return false;
      }
      points = [...points.slice(0, straightAnchor! + 1), local];
      lastRecordedPoint = { x: local.x, y: local.y };
      return true;
    }

    if (bridgeFromStraight) {
      bridgeFromStraight = false;
      return appendStraightBridge(local);
    }

    const last = points[points.length - 1];
    if (last) {
      // Pen digitizers report densely enough to include sub-pixel jitter. One
      // screen pixel (`1 / zoom` world units) is the stable sampling floor;
      // mouse and touch keep every reported position. The live tip still moves
      // to the newest reading while pressure retains its strongest contact.
      const minSampleDistance = stylusInput
        ? 1 / Math.max(zoomOnEnter, 1e-6)
        : 0;
      const recorded = lastRecordedPoint ?? last;
      const distanceFromRecorded = Math.hypot(
        recorded.x - local.x,
        recorded.y - local.y,
      );
      if (
        distanceFromRecorded === 0 ||
        distanceFromRecorded < minSampleDistance
      ) {
        const pressure = Math.max(
          last.pressure ?? NEUTRAL_PRESSURE,
          local.pressure ?? NEUTRAL_PRESSURE,
        );
        if (
          last.x === local.x &&
          last.y === local.y &&
          last.pressure === pressure &&
          last.tiltX === local.tiltX &&
          last.tiltY === local.tiltY
        ) {
          return false;
        }
        // Replace (don't mutate): the previous object was already handed to Yjs
        // by an earlier flush's `points.slice()`, so mutating it in place would
        // desync the stored value from the document.
        points[points.length - 1] = { ...local, pressure };
        return true;
      }
    }
    points.push(local);
    lastRecordedPoint = { x: local.x, y: local.y };
    return true;
  };

  // Shape-local predicted tail for this move. Straight-line (shift) mode snaps
  // the whole stroke to two points, so prediction is meaningless there.
  const predictedFor = (info: ToolPointerInfo): DrawPoint[] => {
    if (
      !predictionEnabled ||
      straightAnchor !== null ||
      !info.predicted?.length ||
      (stalePredictionAnchorScreen !== null &&
        stalePredictionAnchorScreen.x === info.screenPoint.x &&
        stalePredictionAnchorScreen.y === info.screenPoint.y)
    ) {
      return [];
    }
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
    const pressure = stylusInput
      ? stylusPressure(info.pressure)
      : velocityPressure && strokeProps?.inkAlgorithm !== 'reference'
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
    id: config.id,
    label: config.label,
    hotkey: config.hotkey,
    cursor: 'crosshair',
    icon: config.icon,
    // Every sample is a reading of where the hand was and when. Dropping them
    // costs path detail on fast strokes and, with velocity-derived pressure,
    // coarsens the speed measurement the stroke's width comes from. The rAF
    // flush below keeps the extra samples from costing extra document writes.
    wantsCoalescedSamples: true,
    // Local-only render affordance: the live stroke's tail extends to the
    // browser's predicted pointer position, cutting perceived latency. The
    // document write path is untouched — peers receive real samples per frame.
    wantsPredictedSamples: true,

    onEnter() {
      if (config.id === 'draw') playPenToolSound('activate');
    },

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('draw');
      if (!util) return;
      const pencil = useCanvasUiStore.getState();
      // Real pens carry hardware pressure; only mouse/touch fall back to the
      // user's velocity-based simulation preference.
      stylusInput = isPenOrStylus(info.pointerType, info.pressure);
      // A marker has no width profile for pressure to act on, so there is
      // nothing for the velocity filter to measure for.
      velocityPressure =
        config.ink === 'pencil' &&
        !stylusInput &&
        pencil.pencilSimulatePressure;
      // Opt-in, and then only where it describes something: a zero-stabilization
      // pencil is a literal input mode, and extrapolation is not a hardware
      // sample. The marker carries its own fixed stabilization.
      predictionEnabled =
        pencil.pencilPrediction &&
        (config.ink === 'marker' || pencil.pencilStabilization > 0);
      predictionAnchorScreen = null;
      stalePredictionAnchorScreen = null;
      inputs.reset(info.screenPoint, info.timestamp);
      lastSpeed = 0;
      lastVelocityPressure = NEUTRAL_PRESSURE;
      // The marker's flat band has no width profile for a taper to shape.
      endTaperMode = config.ink === 'marker' ? 'off' : pencil.pencilEndTaper;
      velocitySeeded = false;
      chunked = false;
      committedChunks = [];
      straightAnchor = null;
      lastRecordedPoint = null;
      bridgeFromStraight = false;
      pendingMode = null;
      pendingModeScreen = null;
      zoomOnEnter = info.zoom;
      // Shift-clicking an existing stroke's free end continues that stroke.
      // Checked before any style is read: the appended segment belongs to the
      // shape it joins and must keep that shape's colour and brush.
      //
      // The pen only. Nothing in the schema tells a marker stroke apart from a
      // pen one, so a marker looking for a free end would happily adopt a pen
      // stroke and carry on drawing it as a pen — and Shift is worth more to
      // the marker as its straight-line mode, which is how a line of text gets
      // highlighted in one level pass.
      if (info.shiftKey && config.ink === 'pencil') {
        const extending = extendableAt(ctx, info);
        if (extending) {
          extendShape(extending);
          return;
        }
      }
      const style = nextShapeStyle();
      if (config.ink === 'marker') {
        strokeOpacity = MARKER_OPACITY;
        strokeProps = {
          ...(util.getDefaultProps() as DrawProps),
          points: [],
          inkAlgorithm: 'reference',
          inkKind: 'highlight',
          isComplete: false,
          color: style.color,
          size: STROKE_PROFILES.highlight(style.size * MARKER_SIZE_SCALE).size,
          // A marker lays one flat band: no dash to break it up, no interior to
          // paint, and — with `thinning` at zero — no width profile for
          // pressure, its easing, or the tapers to shape.
          dash: 'solid',
          fillStyle: 'none',
          simulatePressure: false,
          pressureEasing: 'linear',
          pressureWarmup: false,
          thinning: 0,
          smoothing: MARKER_SMOOTHING,
          streamline: MARKER_STREAMLINE,
          startTaper: 0,
          endTaper: false,
          // A chisel highlighter is already all flat; nothing about holding it
          // at an angle should change the band it lays down.
          tiltAmount: 0,
        };
        beginShape(ctx, info.point, { x: 0, y: 0, pressure: NEUTRAL_PRESSURE });
        return;
      }
      strokeOpacity = style.opacity;
      const profile = stylusInput
        ? STROKE_PROFILES.realPressure(style.size)
        : velocityPressure
          ? STROKE_PROFILES.simulatePressure(style.size)
          : STROKE_PROFILES.solid(style.size);
      strokeProps = {
        ...(util.getDefaultProps() as DrawProps),
        points: [],
        color: style.color,
        size: profile.size,
        dash: style.dash,
        // Only ever seen once the stroke closes on itself; an open squiggle
        // renders the same whatever the fill style is set to.
        fillStyle: style.fill,
        // The reference kernel simulates mouse pressure from sample travel;
        // stylus samples retain their calibrated hardware readings.
        inkAlgorithm: 'reference',
        isComplete: false,
        simulatePressure: velocityPressure,
        pressureEasing: pressureEasingFor(pencil.pencilPressureCurve),
        pressureWarmup: stylusInput || velocityPressure,
        thinning: !stylusInput && !velocityPressure
          ? 0
          : pencil.pencilThinning === REFERENCE_PENCIL_DYNAMICS.thinning
            ? profile.thinning
            : pencil.pencilThinning,
        smoothing: pencil.pencilSmoothing,
        // Quoted against the camera the stroke is being drawn at, so the hand
        // gets the same steadying zoomed out as it does at 1:1. Baked in here,
        // not read at render time — the shape must look the same at every zoom
        // once it exists.
        streamline: pencil.pencilStabilization === DEFAULT_PENCIL_STABILIZATION
          ? profile.streamline
          : pencilStabilizationToStreamline(pencil.pencilStabilization),
        startTaper: pencil.pencilStartTaper,
        // `velocity` writes its taper at the lift, where the speed that earns
        // it is finally known; until then the stroke ends in a round cap like
        // any unfinished one. See `liftTaper`.
        endTaper: endTaperMode === 'full',
        tiltAmount: pencil.pencilTilt,
      };
      beginShape(ctx, info.point, {
        x: 0,
        y: 0,
        // Velocity has no meaningful value until the first moved sample. Seed
        // at neutral without consuming the filter; that first reading will be
        // folded back into this opening point by `pressureFromVelocity`.
        pressure: stylusInput
          ? stylusPressure(info.pressure)
          : NEUTRAL_PRESSURE,
      });
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!id) return;
      updateMode(info);
      const appended = appendPoint(info);
      if (appended) splitIfFull(ctx);
      if (
        stalePredictionAnchorScreen !== null &&
        (stalePredictionAnchorScreen.x !== info.screenPoint.x ||
          stalePredictionAnchorScreen.y !== info.screenPoint.y)
      ) {
        stalePredictionAnchorScreen = null;
      }
      // A held-still pointer can still emit predictions every frame. Flushing
      // on those would run the mutate → snapshot → reconcile pipeline once a
      // frame to redraw an identical stroke, so only a real change schedules.
      const nextPredicted = predictedFor(info);
      const tailChanged = !sameTail(predicted, nextPredicted);
      predicted = nextPredicted;
      // This move is the sample the tail extrapolates from, so the staleness
      // deadline runs from here. Only an advancing real position pushes it
      // back; repeated stationary events are the stale-tail case itself.
      const predictionAdvanced =
        predicted.length > 0 &&
        (predictionAnchorScreen === null ||
          predictionAnchorScreen.x !== info.screenPoint.x ||
          predictionAnchorScreen.y !== info.screenPoint.y);
      if (predictionAdvanced) {
        predictionAnchorScreen = { ...info.screenPoint };
        scheduleTailExpiry();
      }
      if (appended || tailChanged) scheduleFlush(ctx);
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      // A pen reports its release after contact pressure has gone to zero. The
      // normalized pointer-up fallback must not replace the last real pressure
      // reading and reshape the tip at the instant the stroke settles. Keep
      // that pressure while still accepting a final position the release event
      // may carry. Mouse/touch velocity pressure continues to use the event.
      const liftPressure = stylusInput
        ? points[points.length - 1]?.pressure
        : undefined;
      appendPoint(info, liftPressure);
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
      if (config.id === 'draw') playPenToolSound('deactivate');
    },

    // A pinch (or tool switch) mid-stroke discards the partial stroke entirely.
    onCancel(ctx: ToolContext) {
      cancelPendingWork();
      predicted = [];
      endLiveStroke();
      const cancelled = [
        ...committedChunks,
        ...(id ? [{ id, restore: extendedFrom }] : []),
      ];
      id = null;
      points = [];
      committedChunks = [];
      extendedFrom = null;
      straightAnchor = null;
      lastRecordedPoint = null;
      bridgeFromStraight = false;
      pendingMode = null;
      pendingModeScreen = null;
      // Put an extended stroke back the way it was; delete one this gesture
      // created outright.
      const deleted: string[] = [];
      for (const chunk of cancelled) {
        if (chunk.restore)
          ctx.editor.updateShape(chunk.id, {
            props: { points: chunk.restore },
          });
        else deleted.push(chunk.id);
      }
      if (deleted.length > 0) ctx.editor.deleteShapes(deleted);
    },
  };
}
