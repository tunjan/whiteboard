import type { DrawPoint, PressureEasing } from '@whiteboard/shared';
import {
  buildInkCenterline,
  getFreehandPathData,
  getInkCenterlinePathData,
  vectorLength,
  NOMINAL_SAMPLE_SPACING,
  type FreehandEngineOptions,
  type InkCenterline,
} from './ink-engine';

export interface InkStrokeDynamics {
  simulatePressure?: boolean;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  startTaper?: number | boolean;
  endTaper?: number | boolean;
  pressureEasing?: PressureEasing;
  pressureWarmup?: boolean;
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
  startTaper: 0,
  // Round caps make a pencil stop where the pointer stops. The pointed brush
  // finish remains available in Settings for people who want it.
  endTaper: false,
} as const satisfies Required<InkStrokeDynamics>;

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
  pressureWarmup: false,
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

/** Path and arc length from a single conditioned centerline. */
export function getInkCenterlineGeometry(
  points: DrawPoint[],
  size: number,
  streamlineAmount = 0.5,
): InkCenterlineGeometry {
  const line = buildInkCenterline(points, size, streamlineAmount, true);
  return {
    path: getInkCenterlinePathData(line),
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

/** SVG path data for an ink stroke (local coordinates). */
export function getInkPathData(
  points: DrawPoint[],
  size: number,
  last: boolean,
  dynamics: InkStrokeDynamics = {},
): string {
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
  return getFreehandPathData(points, engineOptions);
}
