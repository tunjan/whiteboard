import type { DrawPoint, PressureEasing } from '@whiteboard/shared';
import {
  buildInkCenterline,
  getFreehandPathData,
  getInkCenterlinePathData,
  vectorLength,
  MAX_TILT_BROADENING,
  NOMINAL_SAMPLE_SPACING,
  type FreehandEngineOptions,
  type InkCenterline,
} from './ink-engine';

export interface InkStrokeDynamics {
  inkAlgorithm?: 'reference';
  simulatePressure?: boolean;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  startTaper?: number | boolean;
  endTaper?: number | boolean;
  linearStartTaper?: boolean;
  pressureEasing?: PressureEasing;
  pressureWarmup?: boolean;
  tiltAmount?: number;
}

const MIN_STREAMLINE_RAW_WEIGHT = 0.15;
const STREAMLINE_RAW_WEIGHT_RANGE = 0.85;
const RAW_WEIGHT_AT_HALF_STABILIZATION = 0.425;
export const DEFAULT_PENCIL_STABILIZATION = 0.35;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function modulate(
  value: number,
  input: readonly [number, number],
  output: readonly [number, number],
): number {
  const t = clamp01((value - input[0]) / (input[1] - input[0]));
  return lerp(output[0], output[1], t);
}

const easeOutSine = (value: number): number =>
  Math.sin((clamp01(value) * Math.PI) / 2);
const stylusEasing = (value: number): number =>
  clamp01(value) * 0.65 + easeOutSine(value) * 0.35;

/** Canonical freehand profiles used by tools that do not expose custom knobs. */
export type InkStrokeProfile = FreehandEngineOptions;

export const STROKE_PROFILES = {
  simulatePressure: (strokeWidth: number): InkStrokeProfile => ({
    size: strokeWidth,
    last: false,
    simulatePressure: true,
    thinning: 0.5,
    streamline: modulate(strokeWidth, [9, 16], [0.64, 0.74]),
    smoothing: 0.62,
    easing: easeOutSine,
    pressureWarmup: true,
    startTaper: 0,
    endTaper: false,
  }),
  realPressure: (strokeWidth: number): InkStrokeProfile => ({
    size: 1 + strokeWidth * 1.2,
    last: false,
    simulatePressure: false,
    thinning: 0.62,
    streamline: 0.62,
    smoothing: 0.62,
    easing: stylusEasing,
    pressureWarmup: true,
    startTaper: 0,
    endTaper: false,
  }),
  solid: (strokeWidth: number): InkStrokeProfile => ({
    size: strokeWidth,
    last: false,
    simulatePressure: false,
    thinning: 0,
    streamline: modulate(strokeWidth, [9, 16], [0.64, 0.74]),
    smoothing: 0.62,
    easing: (value) => value,
    pressureWarmup: true,
    startTaper: 0,
    endTaper: false,
  }),
  highlight: (
    strokeWidth: number,
    showAsComplete = false,
  ): InkStrokeProfile => ({
    size: 1 + strokeWidth,
    last: showAsComplete,
    simulatePressure: false,
    thinning: 0,
    streamline: 0.5,
    smoothing: 0.5,
    easing: easeOutSine,
    pressureWarmup: true,
    startTaper: 0,
    endTaper: false,
  }),
};

/**
 * The stabilization slider as a `streamline` amount for the ink engine.
 *
 * `zoom` is the camera scale the stroke is being drawn at. The engine filters
 * in world units, so without this correction the same physical tremor in the
 * hand gets `1 / zoom` as much smoothing: a line drawn zoomed out came back
 * visibly shakier than the identical gesture at 1:1, because the hand's wobble
 * covered several times more world units. This is the argument
 * `SPEED_AT_MIN_WIDTH` already makes for velocity-derived pressure — how the
 * hand moves is a property of the hand, not of the camera.
 *
 * The correction is one-sided: it only ever adds smoothing, below zoom 1.
 * Applying it symmetrically would also *remove* smoothing when zoomed in — at
 * zoom 4 the default 0.47 falls to about 0.03, effectively no stabilization at
 * all — which is too large a change to make on someone's behalf.
 *
 * The result is stored on the shape at pointer-down, so rendering stays a pure
 * function of the stroke and existing strokes are untouched.
 */
export function pencilStabilizationToStreamline(
  stabilization: number,
  zoom = 1,
): number {
  const strength = clamp01(stabilization);
  const rawInputWeight =
    strength <= 0.5
      ? lerp(1, RAW_WEIGHT_AT_HALF_STABILIZATION, strength / 0.5)
      : lerp(
          RAW_WEIGHT_AT_HALF_STABILIZATION,
          MIN_STREAMLINE_RAW_WEIGHT,
          (strength - 0.5) / 0.5,
        );

  return toStreamline(scaleRawWeightForZoom(rawInputWeight, zoom));
}

/**
 * Re-quote a per-nominal-step filter weight for a camera scale, so the filter
 * closes the same fraction of a gap over the same distance *on screen*.
 *
 * The engine's one-pole runs on world distance, so the world response distance
 * has to grow as the camera shrinks: `R_world = R_screen / zoom`. The two
 * conversions are `responseDistanceFor` and `onePoleWeight` from the engine,
 * evaluated at the spacing they are both calibrated at.
 *
 * Saturating is expected at the far end. `streamline` bottoms out at a raw
 * weight of 0.15, i.e. a response of about 6.2 units, so below roughly zoom
 * 0.18 the correction has no more room and the line is as steady as the engine
 * can make it.
 */
function scaleRawWeightForZoom(weight: number, zoom: number): number {
  // Only ever add smoothing; see the note above.
  const scale = Number.isFinite(zoom) && zoom > 0 ? Math.min(zoom, 1) : 1;
  if (scale >= 1 || weight >= 1 || weight <= 0) return weight;
  const responseAtZoomOne = -NOMINAL_SAMPLE_SPACING / Math.log(1 - weight);
  return 1 - Math.exp(-(NOMINAL_SAMPLE_SPACING * scale) / responseAtZoomOne);
}

/** Invert {@link streamlineRawWeight}: a raw-sample weight back to the slider. */
function toStreamline(rawWeight: number): number {
  return clamp01(
    1 - (rawWeight - MIN_STREAMLINE_RAW_WEIGHT) / STREAMLINE_RAW_WEIGHT_RANGE,
  );
}

/**
 * How the stroke's end is finished, once the hand has actually lifted.
 *
 * `off` is a round cap: the ink stops where the pointer stopped. `full` is the
 * pointed brush finish, which ramps across the whole stroke. `velocity` asks
 * the gesture — a flick tapers, a considered stop does not. See
 * {@link liftTaperFor}.
 */
export type EndTaperMode = 'off' | 'velocity' | 'full';

/**
 * The pen-response preference, as the user chooses it.
 *
 * `medium` is not a curve of its own: it means "whichever curve the input this
 * stroke was drawn with calls for", which is what every stroke used before
 * there was a choice. Only the two deliberate ends name a curve, and they name
 * it for stylus and mouse alike — someone who says the pen is too soft means
 * it about the pointer they have.
 */
export type PencilPressureCurve = 'soft' | 'medium' | 'firm';

/**
 * Speed, in screen pixels per millisecond, below which a lift earns no taper
 * at all.
 *
 * A taper is the mark a nib leaves as it comes off the page while still
 * moving, so the thing that decides whether there is one is whether the hand
 * was still moving. Ending a letter by stopping and lifting is not a flick and
 * must keep its round cap — that is the difference between handwriting and a
 * brush script, and a fixed taper gets it wrong every time it is asked.
 *
 * Quoted on screen and against the clock for the reason `SPEED_AT_MIN_WIDTH`
 * in the draw tool is: how fast the hand moved is a property of the hand, not
 * of the camera it happened to be drawing through.
 */
export const LIFT_TAPER_MIN_SPEED = 0.35;

/** Lift speed at which the taper reaches its full length, same units. */
export const LIFT_TAPER_FULL_SPEED = 1.8;

/**
 * Longest taper a lift can earn, in brush widths.
 *
 * In widths rather than pixels because a taper shorter than the nib is not a
 * taper — it is the round cap it replaces — and one many times longer than the
 * nib is a needle. Six is where a fast flick reads as having been lifted
 * rather than cut off, measured against the same gesture on paper.
 */
export const LIFT_TAPER_MAX_WIDTHS = 6;

/**
 * Most of a stroke a lift taper may consume.
 *
 * The length above is derived from the brush and the gesture, neither of which
 * knows how long the stroke is. Without this, a short quick tick — a decimal
 * point, the cross of a `t` — is entirely inside its own taper and comes out
 * as a sliver pointed at both ends instead of a mark.
 */
export const LIFT_TAPER_MAX_STROKE_FRACTION = 0.5;

/**
 * The taper length a lift has earned, in world units, or 0 for none.
 *
 * `speed` is the filtered pointer speed at the lift in screen px/ms;
 * `strokeLength` and `size` are world lengths, as the result is.
 *
 * No camera term, and deliberately: the only screen-referenced quantity here
 * is the speed that decides *whether* there is a taper, which is a fact about
 * the hand. How long it then is, is quoted in brush widths — already a world
 * measure — so a flick leaves a taper the same number of nibs long at every
 * zoom without anything having to convert between the two.
 */
export function liftTaperFor(
  speed: number,
  size: number,
  strokeLength: number,
): number {
  if (!Number.isFinite(speed) || !(size > 0)) return 0;
  const t = clamp01(
    (speed - LIFT_TAPER_MIN_SPEED) /
      (LIFT_TAPER_FULL_SPEED - LIFT_TAPER_MIN_SPEED),
  );
  if (t <= 0) return 0;
  const taper = size * LIFT_TAPER_MAX_WIDTHS * t;
  const cap = Math.max(0, strokeLength) * LIFT_TAPER_MAX_STROKE_FRACTION;
  return cap > 0 ? Math.min(taper, cap) : taper;
}

export const DEFAULT_PENCIL_DYNAMICS = {
  // Mouse and touch do not provide meaningful pressure. A predictable pencil
  // line is a better default than turning small speed changes into a brush.
  simulatePressure: false,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: pencilStabilizationToStreamline(DEFAULT_PENCIL_STABILIZATION),
  // Persisted on new shapes; older shapes omit both and keep this same curve.
  pressureEasing: 'smoothstep',
  pressureWarmup: false,
  // Free hardware signal on a stylus and inert on everything else, so it is on
  // by default at a middling strength; nothing a mouse or a finger draws can
  // reach it. See `MAX_TILT_BROADENING`.
  tiltAmount: 0.5,
  startTaper: 0,
  // Round caps make a pencil stop where the pointer stops; a flick earns its
  // taper from the speed it was lifted at. See `liftTaperFor`.
  endTaper: false,
} as const satisfies Required<
  Omit<InkStrokeDynamics, 'inkAlgorithm' | 'linearStartTaper'>
>;

/** Defaults for new reference ink; legacy geometry keeps its original defaults. */
export const REFERENCE_PENCIL_DYNAMICS = {
  ...DEFAULT_PENCIL_DYNAMICS,
  simulatePressure: true,
  smoothing: 0.62,
  pressureWarmup: true,
  tiltAmount: 0,
} as const;

/**
 * Legacy simulated-pressure strokes keep the flat response they were drawn
 * with. Their width comes from sample spacing rather than from a real reading,
 * and re-shaping it would rewrite how every stroke saved before that looks.
 */
const linearPressureEasing = (pressure: number): number => pressure;

/**
 * Pressure response for strokes carrying a real signal — stylus hardware or
 * the draw tool's velocity measurement.
 *
 * Smoothstep is retained as the default for shapes saved before pressure
 * profiles were serialized. Current strokes name their curve explicitly.
 */
const smoothPressureEasing = (pressure: number): number =>
  pressure * pressure * (3 - 2 * pressure);

/**
 * How much sooner or later than the automatic curve a chosen pen response
 * reaches a given width, as an exponent on the input to that same curve.
 *
 * Shaping the *input* rather than composing a different curve is what keeps
 * the three responses recognisably one pen: `p ** g` fixes both ends, so a
 * feather-light touch still draws nothing and a pen pressed to its limit still
 * draws the full nib on all three. Only the journey between them moves — which
 * is precisely what someone reaching for this control is complaining about.
 *
 * The pair is deliberately wide. A response preference that three people
 * cannot tell apart is worse than no preference at all: at mid pressure these
 * put soft at about 1.4x the width of medium and firm at about 0.6x, which is
 * a difference you see in one written word.
 */
const SOFT_PRESSURE_GAMMA = 0.65;
const FIRM_PRESSURE_GAMMA = 1.5;

const softPressureEasing = (pressure: number): number =>
  smoothPressureEasing(clamp01(pressure) ** SOFT_PRESSURE_GAMMA);
const firmPressureEasing = (pressure: number): number =>
  smoothPressureEasing(clamp01(pressure) ** FIRM_PRESSURE_GAMMA);

function pressureEasingFor(
  easing: PressureEasing | undefined,
  simulatePressure: boolean,
): (pressure: number) => number {
  switch (easing) {
    case 'linear':
      return linearPressureEasing;
    case 'ease-out-sine':
      return easeOutSine;
    case 'stylus':
      return stylusEasing;
    case 'smoothstep':
      return smoothPressureEasing;
    case 'soft':
      return softPressureEasing;
    case 'firm':
      return firmPressureEasing;
    default:
      return simulatePressure ? linearPressureEasing : smoothPressureEasing;
  }
}

/** Reused because the engine is intentionally synchronous and non-reentrant. */
const engineOptions: FreehandEngineOptions = {
  size: 1,
  last: false,
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  easing: linearPressureEasing,
  startTaper: 0,
  endTaper: false,
  linearStartTaper: false,
  pressureWarmup: false,
  tiltAmount: 0,
  errorLimit: 0,
};

/**
 * A stroke's centerline as the renderer needs it: the path to draw, and the
 * arc length to distribute dashes along.
 *
 * Both come from one conditioned centerline because building it is the
 * expensive half of a render. A dashed stroke needs the path and the length,
 * and a closed one paints its fill from the same curve; asking for them
 * separately ran the ingest and stabilization passes two or three times over
 * identical input.
 */
export interface InkCenterlineGeometry {
  path: string;
  length: number;
}

export const EMPTY_INK_CENTERLINE: InkCenterlineGeometry = {
  path: '',
  length: 0,
};

/**
 * Path and arc length from a single conditioned centerline.
 *
 * `errorLimit` coarsens only the emitted path, never the samples the length is
 * measured on: dashes must stay where they are when the camera moves.
 */
export function getInkCenterlineGeometry(
  points: DrawPoint[],
  size: number,
  streamlineAmount = 0.5,
  inkAlgorithm?: 'reference',
  last = true,
  errorLimit = 0,
): InkCenterlineGeometry {
  const line = buildInkCenterline(
    points,
    size,
    streamlineAmount,
    last,
    inkAlgorithm,
  );
  return {
    path: getInkCenterlinePathData(line, errorLimit),
    length: centerlineLength(line),
  };
}

/**
 * Smoothed centerline path (quadratic through midpoints) for an ink stroke.
 * Used for dashed/dotted pencils, which stroke a uniform-width line instead of
 * filling the variable-width freehand-engine outline. Built on the engine's own
 * conditioned centerline (final point pinned to the raw lift position), so a
 * dashed stroke follows exactly the line its solid twin would.
 */
export function getInkCenterlinePath(
  points: DrawPoint[],
  size: number,
  streamlineAmount = 0.5,
): string {
  return getInkCenterlinePathData(
    buildInkCenterline(points, size, streamlineAmount, true),
  );
}

/**
 * Arc length of the path {@link getInkCenterlinePathData} draws, for
 * distributing dashes along it.
 *
 * Measured on the conditioned samples rather than on the quadratics drawn
 * through their midpoints, which cut fractionally inside every bend. The two
 * agree to well under the sub-pixel rounding the dash lengths are quantized to.
 */
function centerlineLength(line: InkCenterline): number {
  let total = 0;
  for (let i = 1; i < line.count; i++) {
    total += vectorLength(
      line.x[i]! - line.x[i - 1]!,
      line.y[i]! - line.y[i - 1]!,
    );
  }
  return total;
}

/**
 * The widest half-width the engine can draw a stroke at, for the padding that
 * bounds and hit tests reserve around its centerline.
 *
 * `baseRadius` is `size * easing(0.5 - thinning * (0.5 - pressure))`, so
 * thinning pushes the radius past `size / 2` in *both* directions: negative
 * thinning widens a light touch, positive thinning a heavy one. Reserving
 * `size / 2` for the positive case cut a default pencil's own outline off at
 * two thirds of its width, so clicks on visible ink missed and culling
 * clipped it.
 */
export function maxInkRadius(
  size: number,
  dynamics: InkStrokeDynamics = {},
): number {
  const thinning = Math.max(-1, Math.min(1, dynamics.thinning ?? 0));
  // A stroke drawn square across a fully laid-over stylus is the widest the
  // nib ever gets, and bounds have to hold for it or the widest part of a
  // shading stroke falls outside the box that selects and erases it.
  const tilt = 1 + clamp01(dynamics.tiltAmount ?? 0) * MAX_TILT_BROADENING;
  if (thinning === 0) return (size / 2) * tilt;
  const easing = pressureEasingFor(
    dynamics.pressureEasing,
    dynamics.simulatePressure ?? false,
  );
  return size * easing(0.5 + Math.abs(thinning) / 2) * tilt;
}

/**
 * SVG path data for an ink stroke (local coordinates).
 *
 * `errorLimit` is the world-unit deviation the outline may carry because it is
 * sub-pixel at the current camera; 0 renders the exact geometry.
 */
export function getInkPathData(
  points: DrawPoint[],
  size: number,
  last: boolean,
  dynamics: InkStrokeDynamics = {},
  errorLimit = 0,
): string {
  engineOptions.inkAlgorithm = dynamics.inkAlgorithm;
  engineOptions.size = size;
  engineOptions.last = last;
  engineOptions.thinning = dynamics.thinning ?? 0;
  engineOptions.smoothing = dynamics.smoothing ?? 0.5;
  engineOptions.streamline = dynamics.streamline ?? 0.5;
  engineOptions.simulatePressure = dynamics.simulatePressure ?? false;
  engineOptions.easing = pressureEasingFor(
    dynamics.pressureEasing,
    engineOptions.simulatePressure,
  );
  engineOptions.pressureWarmup = dynamics.pressureWarmup ?? false;
  engineOptions.startTaper = dynamics.startTaper ?? 0;
  engineOptions.endTaper = dynamics.endTaper ?? false;
  engineOptions.linearStartTaper = dynamics.linearStartTaper ?? false;
  engineOptions.tiltAmount = dynamics.tiltAmount ?? 0;
  engineOptions.errorLimit = errorLimit;
  return getFreehandPathData(points, engineOptions);
}
