import type { DrawPoint } from '@whiteboard/shared';
import { CentiPixelPathWriter, toCenti } from './fmt';

export interface FreehandEngineOptions {
  inkAlgorithm?: 'reference';
  size: number;
  last: boolean;
  simulatePressure: boolean;
  thinning: number;
  smoothing: number;
  streamline: number;
  startTaper: number | boolean;
  endTaper: number | boolean;
  easing?: (pressure: number) => number;
  /**
   * Ramp the start taper linearly instead of easing it out. A pencil wants the
   * ease-out: its taper is a lead-in that should reach full width early and
   * leave the body of the stroke uniform. A trail that is nothing but taper
   * wants the straight ramp, so width tracks distance behind the pointer.
   */
  linearStartTaper?: boolean;
  /** Use the current five-brush-width pressure initialization model. */
  pressureWarmup?: boolean;
  /**
   * How strongly a tilted stylus broadens the nib, 0..1. Zero — the default,
   * and everything a mouse or a finger can produce — leaves the radius model
   * exactly as it was.
   */
  tiltAmount?: number;
  /**
   * Perpendicular error, in world units, the emitted outline may carry on top
   * of `TRACK_ERROR_LIMIT` because it is sub-pixel at the camera this render
   * is for. Zero — the default, and everything at or above zoom 1 — leaves the
   * geometry exactly as it was. See `inkErrorLimit` in `use-lod-store.ts`.
   */
  errorLimit?: number;
}

const MIN_PHYSICAL_PRESSURE = 0.025;
const PRESSURE_RELAXATION = 0.275;
const MIN_RADIUS = 0.01;
const linearEasing = (value: number): number => value;

/**
 * Sample spacing every distance-domain filter here is calibrated at, in world
 * units. The draw tool records a point only once the pointer has moved at
 * least this far, so a slow, deliberate stroke arrives at almost exactly this
 * spacing and gets exactly the weights the settings sliders name.
 */
export const NOMINAL_SAMPLE_SPACING = 1;

/**
 * Distance over which physical stylus pressure closes ~63% of a change, in
 * world units. Real pressure is noisy enough to need smoothing, but the rate
 * must not depend on the brush: relaxing by a fraction of `distance / size`
 * made a thick pen respond roughly four times more sluggishly than a thin one
 * to the very same hand.
 */
const PRESSURE_RESPONSE_DISTANCE = 8;

/**
 * Extra half-width a fully flattened stylus adds, as a multiple of the width
 * it draws held upright.
 *
 * A pencil laid over on its side presents the long axis of its worn nib to the
 * page, and how much of that axis the line is actually as wide as depends on
 * which way the line goes: draw across the lean and you get the whole flat,
 * draw along it and you get the same narrow edge an upright pen has. So this
 * is a ceiling reached only by the stroke drawn square across the barrel, not
 * a width every tilted sample gets.
 *
 * 1.2 puts a fully flattened shading stroke at a little over twice the width
 * of the same pen held upright, which is about what a real pencil does before
 * the tone stops reading as a line at all.
 */
export const MAX_TILT_BROADENING = 1.2;

/**
 * Distance over which the tilt reading closes ~63% of a change, in world
 * units.
 *
 * Longer than the pressure response because the two are different gestures.
 * Pressure is the hand leaning on the page and can change within a letter;
 * the angle the barrel is held at is a grip, and a grip changes over a stroke,
 * not over a sample. Filtering it this slowly keeps digitizer noise in the
 * tilt channels — which is coarser than the pressure channel's, since tilt is
 * quantized to whole degrees — from rippling the width of a line drawn at a
 * constant angle.
 */
const TILT_RESPONSE_DISTANCE = 12;

/**
 * Fraction of the brush width the decimated outline may deviate from the exact
 * one at `smoothing: 1`. Applied as a perpendicular error bound rather than a
 * minimum spacing, so straight runs coarsen into window-spaced anchors while a
 * tight curve keeps every point that carries it — the old spacing rule dropped
 * detail in proportion to `size`, which cost thick brushes the most.
 */
const TRACK_ERROR_LIMIT = 0.05;
const SIMPLIFY_WINDOW = 8;

/**
 * How much of each end of a stroke may be discarded as press/lift jitter, in
 * world units, capped below by the brush so sub-pixel nibs keep their tighter
 * threshold.
 *
 * This used to be `size / 3` outright. Because the discarded run is replaced
 * by a single straight segment to the endpoint, a size-32 brush opened and
 * closed every stroke with an ~11-unit straight stub while a size-4 brush used
 * ~1.3 — the same hand tracing the same arc got a visibly stiffer line from
 * the thicker pen, and while drawing, the live tip is that stub. Press and
 * lift jitter is a property of the hand and the digitizer; it does not get
 * larger because the brush did.
 */
const ENDPOINT_JITTER_DISTANCE = 2;

/**
 * Greatest multiple of the brush radius a corner may push the outline out to.
 *
 * Offsetting a turn along its bisector is what keeps the ribbon exactly one
 * radius wide measured perpendicular to each arm, but the bisector offset
 * grows without bound as the turn approaches a reversal. Past this limit the
 * corner is partitioned instead and emitted as two round-capped subpaths, so
 * the join rounds off rather than growing a spike.
 */
const INK_MITER_LIMIT = 1.5;

/**
 * `1 + directionChange` below which the miter exceeds `INK_MITER_LIMIT`.
 *
 * `1 + cos(turn)` is `2 cos²(turn / 2)`, and the miter's length is
 * `radius / cos(turn / 2)`, so the limit is reached exactly at
 * `2 / INK_MITER_LIMIT²` — a turn of about 96 degrees.
 */
const MITER_DENOMINATOR_FLOOR = 2 / (INK_MITER_LIMIT * INK_MITER_LIMIT);

/**
 * Direction change, as a cosine, at or below which a step is treated as an
 * intended corner rather than tremor.
 *
 * Only consulted for steps longer than `MAX_FILTER_STEP`, and measured over
 * `CORNER_WINDOW` of travel rather than between neighbouring samples, so that
 * what it compares is a turn the hand made against the tremor it carried while
 * making it. About 26 degrees sits between the two.
 */
const CORNER_DIRECTION_CHANGE = 0.9;

/**
 * Travel on each side of a sample, in world units, over which the turn that
 * releases the clamp is measured. Long enough that hand tremor averages out of
 * the direction estimate, short enough that a letterform's corner still reads
 * as one.
 */
const CORNER_WINDOW = 8;

/**
 * The same window expressed in filter response distances, for settings lagging
 * enough that eight units is not sufficient warning of an approaching corner.
 */
const CORNER_WINDOW_RESPONSES = 3;

/**
 * Longest step, in world units, the streamline filter credits to one sample.
 *
 * The filter's response is a distance, so a hand moving faster than it is
 * calibrated to follow closes almost the whole gap in a single step: at five
 * units the weight is 0.99 and stabilization has effectively switched itself
 * off, which is why quick sweeping strokes came out carrying every bit of
 * tremor while slow ones were steady. Clamping the step restores a floor of
 * smoothing at speed. Chosen so the default slider settles near 0.47 per
 * sample, which is what tldraw applies at its own default and measured as the
 * point past which corners drawn slowly start to visibly round off.
 *
 * Being a clamp on distance rather than on the weight, it scales with the
 * slider and vanishes with it: at zero stabilization the response is zero, the
 * weight is 1 whatever the step, and the filter stays the identity.
 */
const MAX_FILTER_STEP = 0.75;

/**
 * Travel, in filter response distances, over which the tip is eased onto the
 * raw pointer position.
 *
 * The tip is pinned to the raw sample so the ink ends where the pointer is
 * (see `pinTipToRaw`), but a pin applied to that one sample alone is a
 * discontinuity that moves: while drawing, each frame puts the newest sample
 * on the pointer and then, on the next frame, drops it back onto the filtered
 * curve as the sample behind it takes over. Measured on a spiral at the draw
 * tool's one-unit input gate, that retreat averaged 2.6 world units a frame
 * with the default stabilization — a third of an eight-unit brush, twitching
 * at exactly the place the eye is watching, while every sample behind it sat
 * perfectly still.
 *
 * Spreading the same correction over a run of samples does not reduce it; it
 * divides it by the number of frames the run spans, which is what turns a
 * twitch into a drift the eye reads as the line settling. Expressed in
 * response distances rather than world units because the lag being corrected
 * is itself proportional to the response: it scales with the stabilization
 * slider and vanishes with it, leaving the identity filter untouched.
 */
const TIP_PIN_RAMP_RESPONSES = 4;

/**
 * Greatest share of a stroke the tip ramp may cover.
 *
 * The ramp is sized from the filter response, which is a property of the
 * settings and the camera, not of the stroke — so on a short stroke drawn at
 * heavy stabilization it can reach most of the way back to the press point and
 * pull the whole line onto its raw samples, undoing the smoothing everywhere
 * instead of easing the last of it. Measured on a 60-unit zig-zag at zoom
 * 0.25, an uncapped eight-response ramp left 38.4 units of tremor against the
 * 43.4 an unstabilized filter leaves: almost none of the stabilization
 * survived. Short strokes have short tips.
 */
const TIP_PIN_MAX_STROKE_FRACTION = 0.25;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Weight given to the raw sample in the streamline filter, per nominal step. */
function streamlineRawWeight(streamlineAmount: number): number {
  return 0.15 + (1 - clamp01(streamlineAmount)) * 0.85;
}

/**
 * Convert a one-pole weight quoted per `NOMINAL_SAMPLE_SPACING` step into the
 * distance over which that filter closes ~63% of a gap.
 *
 * Filtering once per *sample* made every smoothing amount a function of
 * drawing speed: samples land a world unit apart when the hand is slow and
 * twenty apart when it is fast, so the same slider lagged the ink by under a
 * unit in one stroke and by tens of units in the next, rounding off exactly
 * the corners that were drawn quickly. Re-deriving the weight from the step's
 * length makes the filter depend on the path, not on how it was sampled.
 */
function responseDistanceFor(weightPerNominalStep: number): number {
  if (weightPerNominalStep >= 1) return 0;
  if (weightPerNominalStep <= 0) return Number.POSITIVE_INFINITY;
  return -NOMINAL_SAMPLE_SPACING / Math.log(1 - weightPerNominalStep);
}

/**
 * Fraction of the remaining gap a one-pole filter closes over `distance`.
 * Equals the per-sample weight exactly when `distance` is the spacing the
 * response was calibrated at, so existing strokes and settings are unaffected
 * at the spacing they were tuned for.
 */
function onePoleWeight(distance: number, response: number): number {
  if (!(distance > 0)) return 0;
  if (response <= 0) return 1;
  if (!Number.isFinite(response)) return 0;
  return 1 - Math.exp(-distance / response);
}

/**
 * Length of a 2D vector.
 *
 * `Math.hypot` is the obvious spelling and measured ~5x slower here: it is
 * variadic and rescales its arguments to survive intermediate overflow. That
 * matters at 1e154, and these are canvas coordinates — the draw tool discards
 * non-finite samples at ingestion, so the naive form is exact where it is used
 * and the difference is the engine's single largest cost.
 */
export function vectorLength(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance from a point to a segment, on scalars to stay allocation-free. */
function segmentDistanceSquared(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  let t =
    lengthSquared > 0
      ? ((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared
      : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const offsetX = pointX - (startX + t * dx);
  const offsetY = pointY - (startY + t * dy);
  return offsetX * offsetX + offsetY * offsetY;
}

/**
 * Simplify the two outline tracks together over a bounded look-ahead window.
 *
 * Left and right points share an index because they are the two sides of the
 * same centerline sample. A candidate chord is therefore accepted only when
 * every skipped point on both sides stays inside the error bound. Compacting
 * the arrays together preserves that correspondence for cap generation and
 * for the reverse-track spline writer.
 */
function simplifyTracks(length: number, tolerance: number): number {
  if (length <= 2 || tolerance <= 0) return length;

  const toleranceSquared = tolerance * tolerance;
  const lastIndex = length - 1;
  let output = 1;
  let anchor = 0;

  while (anchor < lastIndex) {
    let best = anchor + 1;
    const windowEnd = Math.min(anchor + SIMPLIFY_WINDOW, lastIndex);

    candidate: for (let target = anchor + 2; target <= windowEnd; target++) {
      for (let point = anchor + 1; point < target; point++) {
        if (
          segmentDistanceSquared(
            buffers.trackLeftX[point]!,
            buffers.trackLeftY[point]!,
            buffers.trackLeftX[anchor]!,
            buffers.trackLeftY[anchor]!,
            buffers.trackLeftX[target]!,
            buffers.trackLeftY[target]!,
          ) > toleranceSquared ||
          segmentDistanceSquared(
            buffers.trackRightX[point]!,
            buffers.trackRightY[point]!,
            buffers.trackRightX[anchor]!,
            buffers.trackRightY[anchor]!,
            buffers.trackRightX[target]!,
            buffers.trackRightY[target]!,
          ) > toleranceSquared
        ) {
          break candidate;
        }
      }
      best = target;
    }

    buffers.trackLeftX[output] = buffers.trackLeftX[best]!;
    buffers.trackLeftY[output] = buffers.trackLeftY[best]!;
    buffers.trackRightX[output] = buffers.trackRightX[best]!;
    buffers.trackRightY[output] = buffers.trackRightY[best]!;
    output++;
    anchor = best;
  }

  return output;
}

function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(16, current);
  while (capacity < required) capacity *= 2;
  return capacity;
}

/**
 * Module-level, non-reentrant struct-of-arrays workspace. Every public render
 * finishes before another can begin on the JavaScript thread, so these buffers
 * can be safely reused by all persisted and in-progress strokes.
 */
class InkBuffers {
  capacity = 0;

  stageX = new Float64Array(0);
  stageY = new Float64Array(0);
  stageZ = new Float64Array(0);
  stageTiltX = new Float64Array(0);
  stageTiltY = new Float64Array(0);

  pointX = new Float64Array(0);
  pointY = new Float64Array(0);
  inputX = new Float64Array(0);
  inputY = new Float64Array(0);
  inputZ = new Float64Array(0);
  tiltX = new Float64Array(0);
  tiltY = new Float64Array(0);
  pressure = new Float64Array(0);
  distance = new Float64Array(0);
  runLength = new Float64Array(0);
  radius = new Float64Array(0);
  vectorX = new Float64Array(0);
  vectorY = new Float64Array(0);

  /** The active partition's centerline, resolved once per point. */
  sequenceX = new Float64Array(0);
  sequenceY = new Float64Array(0);

  trackLeftX = new Float64Array(0);
  trackLeftY = new Float64Array(0);
  trackRightX = new Float64Array(0);
  trackRightY = new Float64Array(0);

  partitionStart = new Int32Array(0);
  partitionEnd = new Int32Array(0);
  boundary = new Uint8Array(0);
  rawBoundary = new Uint8Array(0);

  /** Centerline samples the emitted path keeps; see `simplifyCenterline`. */
  centerlineKeep = new Int32Array(0);

  readonly writer = new CentiPixelPathWriter();

  ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = nextCapacity(this.capacity, required);

    this.stageX = new Float64Array(this.capacity);
    this.stageY = new Float64Array(this.capacity);
    this.stageZ = new Float64Array(this.capacity);
    this.stageTiltX = new Float64Array(this.capacity);
    this.stageTiltY = new Float64Array(this.capacity);

    this.pointX = new Float64Array(this.capacity);
    this.pointY = new Float64Array(this.capacity);
    this.inputX = new Float64Array(this.capacity);
    this.inputY = new Float64Array(this.capacity);
    this.inputZ = new Float64Array(this.capacity);
    this.tiltX = new Float64Array(this.capacity);
    this.tiltY = new Float64Array(this.capacity);
    this.pressure = new Float64Array(this.capacity);
    this.distance = new Float64Array(this.capacity);
    this.runLength = new Float64Array(this.capacity);
    this.radius = new Float64Array(this.capacity);
    this.vectorX = new Float64Array(this.capacity);
    this.vectorY = new Float64Array(this.capacity);

    this.sequenceX = new Float64Array(this.capacity);
    this.sequenceY = new Float64Array(this.capacity);

    this.trackLeftX = new Float64Array(this.capacity * 14);
    this.trackLeftY = new Float64Array(this.capacity * 14);
    this.trackRightX = new Float64Array(this.capacity * 14);
    this.trackRightY = new Float64Array(this.capacity * 14);

    this.partitionStart = new Int32Array(this.capacity);
    this.partitionEnd = new Int32Array(this.capacity);
    this.boundary = new Uint8Array(this.capacity);
    this.rawBoundary = new Uint8Array(this.capacity);

    this.centerlineKeep = new Int32Array(this.capacity);
  }
}

const buffers = new InkBuffers();

function pressureOf(point: DrawPoint): number {
  const pressure = point.pressure ?? 0.5;
  return Number.isFinite(pressure) ? clamp01(pressure) : 0.5;
}

/** One tilt channel, defaulting an absent or broken reading to upright. */
function tiltOf(value: number | undefined): number {
  return Number.isFinite(value) ? clamp(value!, -1, 1) : 0;
}

function expandTwoPointStroke(
  count: number,
  simulatePressure: boolean,
): number {
  if (count !== 2 || !simulatePressure) return count;
  const startX = buffers.stageX[0]!;
  const startY = buffers.stageY[0]!;
  const endX = buffers.stageX[1]!;
  const endY = buffers.stageY[1]!;
  const endPressure = buffers.stageZ[1]!;
  // Tilt is the angle the barrel is held at, which the interpolated samples
  // share with the two real ones — unlike pressure, it is not ramped.
  const endTiltX = buffers.stageTiltX[1]!;
  const endTiltY = buffers.stageTiltY[1]!;
  for (let k = 1; k <= 4; k++) {
    const t = k / 4;
    buffers.stageX[k] = startX + (endX - startX) * t;
    buffers.stageY[k] = startY + (endY - startY) * t;
    buffers.stageZ[k] = (endPressure * k) / 4;
    buffers.stageTiltX[k] = endTiltX;
    buffers.stageTiltY[k] = endTiltY;
  }
  return 5;
}

/** Ingest and compact raw samples in the staged typed arrays. */
function ingest(
  points: DrawPoint[],
  size: number,
  simulatePressure: boolean,
  reference = false,
): number {
  buffers.ensureCapacity(Math.max(points.length, 5));
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const point = points[i]!;
    buffers.stageX[i] = Number.isFinite(point.x) ? point.x : 0;
    buffers.stageY[i] = Number.isFinite(point.y) ? point.y : 0;
    const pressure = pressureOf(point);
    buffers.stageZ[i] = simulatePressure
      ? pressure
      : Math.max(MIN_PHYSICAL_PRESSURE, pressure);
    buffers.stageTiltX[i] = tiltOf(point.tiltX);
    buffers.stageTiltY[i] = tiltOf(point.tiltY);
  }
  if (count <= 1) return count;

  const thresholdSquared =
    (reference ? size / 3 : Math.min(size / 3, ENDPOINT_JITTER_DISTANCE)) ** 2;
  const startX = buffers.stageX[0]!;
  const startY = buffers.stageY[0]!;
  let startPressure = buffers.stageZ[0]!;
  let firstKept = 1;
  while (firstKept < count) {
    const dx = buffers.stageX[firstKept]! - startX;
    const dy = buffers.stageY[firstKept]! - startY;
    if (dx * dx + dy * dy > thresholdSquared) break;
    startPressure = Math.max(startPressure, buffers.stageZ[firstKept]!);
    firstKept++;
  }
  buffers.stageZ[0] = startPressure;
  if (firstKept === count) return 1;

  let stagedCount = 1;
  for (let read = firstKept; read < count; read++) {
    buffers.stageX[stagedCount] = buffers.stageX[read]!;
    buffers.stageY[stagedCount] = buffers.stageY[read]!;
    buffers.stageZ[stagedCount] = buffers.stageZ[read]!;
    buffers.stageTiltX[stagedCount] = buffers.stageTiltX[read]!;
    buffers.stageTiltY[stagedCount] = buffers.stageTiltY[read]!;
    stagedCount++;
  }
  if (stagedCount <= 2) {
    return expandTwoPointStroke(stagedCount, simulatePressure);
  }

  const end = stagedCount - 1;
  const endX = buffers.stageX[end]!;
  const endY = buffers.stageY[end]!;
  let lastPrefix = end - 1;
  while (lastPrefix > 0) {
    const dx = buffers.stageX[lastPrefix]! - endX;
    const dy = buffers.stageY[lastPrefix]! - endY;
    if (dx * dx + dy * dy > thresholdSquared) break;
    lastPrefix--;
  }
  if (lastPrefix < end - 1) {
    buffers.stageX[lastPrefix + 1] = endX;
    buffers.stageY[lastPrefix + 1] = endY;
    buffers.stageZ[lastPrefix + 1] = buffers.stageZ[end]!;
    buffers.stageTiltX[lastPrefix + 1] = buffers.stageTiltX[end]!;
    buffers.stageTiltY[lastPrefix + 1] = buffers.stageTiltY[end]!;
    stagedCount = lastPrefix + 2;
  }
  return expandTwoPointStroke(stagedCount, simulatePressure);
}

/**
 * Cosine of the turn the stroke makes at `index`, measured over a window of
 * travel on each side rather than between neighbouring samples.
 *
 * The window is the whole point. Tremor and an intended corner are both
 * direction changes; what separates them is scale. Between adjacent samples a
 * couple of units of jitter on a two-unit step swings the direction by tens of
 * degrees, so a per-sample test reads tremor as a corner and releases the
 * stabilization exactly where it was needed. Averaged over `CORNER_WINDOW`
 * units of travel the jitter cancels and only a turn the hand actually made
 * survives.
 *
 * Read from the staged (unfiltered) coordinates: the filtered ones have
 * already had the very direction change this is trying to detect partly
 * removed. Ends are measured over whatever travel is available, and a stroke's
 * final sample is reported straight so its tail is stabilized like the run
 * leading into it.
 */
function directionChangeAt(
  index: number,
  stagedCount: number,
  window: number,
): number {
  if (index + 1 >= stagedCount) return 1;

  const centerX = buffers.stageX[index]!;
  const centerY = buffers.stageY[index]!;

  let back = index;
  let travelled = 0;
  while (back > 0 && travelled < window) {
    travelled += vectorLength(
      buffers.stageX[back]! - buffers.stageX[back - 1]!,
      buffers.stageY[back]! - buffers.stageY[back - 1]!,
    );
    back--;
  }

  let forward = index;
  travelled = 0;
  while (forward + 1 < stagedCount && travelled < window) {
    travelled += vectorLength(
      buffers.stageX[forward + 1]! - buffers.stageX[forward]!,
      buffers.stageY[forward + 1]! - buffers.stageY[forward]!,
    );
    forward++;
  }

  const inX = centerX - buffers.stageX[back]!;
  const inY = centerY - buffers.stageY[back]!;
  const outX = buffers.stageX[forward]! - centerX;
  const outY = buffers.stageY[forward]! - centerY;
  const inLength = vectorLength(inX, inY);
  const outLength = vectorLength(outX, outY);
  if (inLength === 0 || outLength === 0) return 1;
  return clamp((inX * outX + inY * outY) / (inLength * outLength), -1, 1);
}

/** Streamline staged coordinates and retain raw coordinates for elbow bounds. */
function streamline(
  stagedCount: number,
  size: number,
  streamlineAmount: number,
  last: boolean,
  reference = false,
): number {
  if (stagedCount === 0) return 0;
  const response = responseDistanceFor(streamlineRawWeight(streamlineAmount));
  // Heavy stabilization lags further, so it needs more room to shed that lag
  // before the corner arrives; at light settings the constant already governs.
  const cornerWindow = Math.max(
    CORNER_WINDOW,
    CORNER_WINDOW_RESPONSES * response,
  );
  const clampedWeight = onePoleWeight(MAX_FILTER_STEP, response);

  buffers.pointX[0] = buffers.stageX[0]!;
  buffers.pointY[0] = buffers.stageY[0]!;
  buffers.inputX[0] = buffers.stageX[0]!;
  buffers.inputY[0] = buffers.stageY[0]!;
  buffers.inputZ[0] = buffers.stageZ[0]!;
  buffers.tiltX[0] = buffers.stageTiltX[0]!;
  buffers.tiltY[0] = buffers.stageTiltY[0]!;
  buffers.distance[0] = 0;
  buffers.runLength[0] = 0;

  let previousX = buffers.pointX[0]!;
  let previousY = buffers.pointY[0]!;
  let previousRawX = buffers.stageX[0]!;
  let previousRawY = buffers.stageY[0]!;
  let totalLength = 0;
  let pointCount = 1;

  for (let i = 1; i < stagedCount; i++) {
    const rawX = buffers.stageX[i]!;
    const rawY = buffers.stageY[i]!;
    // Weight this step by how far the hand actually travelled, not by the
    // fact that a sample arrived, and by at most `MAX_FILTER_STEP` of it.
    // See `responseDistanceFor`.
    const stepX = rawX - previousRawX;
    const stepY = rawY - previousRawY;
    const stepLength = vectorLength(stepX, stepY);
    const uncapped = reference ? 0 : onePoleWeight(stepLength, response);
    let weight = reference
      ? last && i === stagedCount - 1 ? 1 : streamlineRawWeight(streamlineAmount)
      : uncapped;
    if (!reference && stepLength > MAX_FILTER_STEP) {
      // Applied everywhere, the clamp also lags genuine corners, cutting a
      // fast right angle inside its vertex by more than a brush width. So it
      // is released in proportion to how sharply the hand is actually
      // turning: full on a straight run or a gentle curve, absent at a
      // corner, which keeps the unclamped response it has today.
      const straightness = clamp01(
        (directionChangeAt(i, stagedCount, cornerWindow) -
          CORNER_DIRECTION_CHANGE) /
          (1 - CORNER_DIRECTION_CHANGE),
      );
      weight = uncapped - (uncapped - clampedWeight) * straightness;
    }
    previousRawX = rawX;
    previousRawY = rawY;
    const x = previousX + (rawX - previousX) * weight;
    const y = previousY + (rawY - previousY) * weight;
    const step = vectorLength(x - previousX, y - previousY);
    totalLength += step;
    previousX = x;
    previousY = y;
    if (step === 0) continue;
    if (i < 4 && i < stagedCount - 1 && totalLength < size) continue;

    buffers.pointX[pointCount] = x;
    buffers.pointY[pointCount] = y;
    buffers.inputX[pointCount] = buffers.stageX[i]!;
    buffers.inputY[pointCount] = buffers.stageY[i]!;
    buffers.inputZ[pointCount] = buffers.stageZ[i]!;
    buffers.tiltX[pointCount] = buffers.stageTiltX[i]!;
    buffers.tiltY[pointCount] = buffers.stageTiltY[i]!;
    // Samples skipped above still moved the pen, so the gap to the previous
    // *stored* point is the run length since it, not this one step. Dynamics
    // read `distance` as the spacing between the points they are walking, and
    // `pinTipToRaw` maintains exactly that identity at the other end.
    buffers.distance[pointCount] =
      totalLength - buffers.runLength[pointCount - 1]!;
    buffers.runLength[pointCount] = totalLength;
    pointCount++;
  }
  if (last && !reference) pinTipToRaw(pointCount, response);
  return pointCount;
}

/**
 * Ease the end of the filtered curve onto the raw samples it was filtered
 * from, so the ink ends exactly where the pointer is.
 *
 * The pin itself is not optional: under stabilization the filter trails the
 * pointer, and pinning only on commit would snap the whole stroke forward at
 * pointer-up. What is optional is doing it in one step. Blending over
 * `TIP_PIN_RAMP_RESPONSES` of travel reaches the same raw endpoint by a
 * smoothstep that is flat at both ends, so the ramp joins the filtered curve
 * without a kink and the tip lands on the pointer rather than jumping to it.
 *
 * Applied after the loop rather than inside it, on purpose. The one-pole is
 * recursive, so feeding blended positions back in as filter state would make
 * every sample in the ramp depend on how near the end of the stroke it
 * happened to be — the settled geometry behind the tip, which measures as
 * bit-stable today, would start moving as the stroke grew. Reading the filter
 * output and writing it back keeps that stability exactly as it is.
 */
function pinTipToRaw(pointCount: number, response: number): void {
  // No stabilization means no response, no lag, and nothing to correct: the
  // filter is already the identity and the raw tip is where it ends.
  if (pointCount < 2 || response <= 0) return;

  const last = pointCount - 1;
  const tipLength = buffers.runLength[last]!;
  const ramp = Math.min(
    TIP_PIN_RAMP_RESPONSES * response,
    tipLength * TIP_PIN_MAX_STROKE_FRACTION,
  );
  if (ramp <= 0) return;

  let first = last;
  for (let i = last; i > 0; i--) {
    const t = clamp01(1 - (tipLength - buffers.runLength[i]!) / ramp);
    if (t <= 0) break;
    const blend = t * t * (3 - 2 * t);
    const x = buffers.pointX[i]!;
    const y = buffers.pointY[i]!;
    buffers.pointX[i] = x + (buffers.inputX[i]! - x) * blend;
    buffers.pointY[i] = y + (buffers.inputY[i]! - y) * blend;
    first = i;
  }

  // Dynamics read per-sample steps and run length — pressure response, both
  // tapers — so the ramp has to leave them describing the curve it just moved.
  for (let i = first; i <= last; i++) {
    const step = vectorLength(
      buffers.pointX[i]! - buffers.pointX[i - 1]!,
      buffers.pointY[i]! - buffers.pointY[i - 1]!,
    );
    buffers.distance[i] = step;
    buffers.runLength[i] = buffers.runLength[i - 1]! + step;
  }
}

function resolveTaper(
  taper: number | boolean,
  size: number,
  totalLength: number,
): number {
  if (taper === true) return Math.max(size, totalLength);
  return typeof taper === 'number' && Number.isFinite(taper)
    ? Math.max(0, taper)
    : 0;
}

function baseRadius(
  pressure: number,
  size: number,
  thinning: number,
  easing: (pressure: number) => number,
): number {
  if (thinning === 0) return Math.max(MIN_RADIUS, size / 2);
  return Math.max(MIN_RADIUS, size * easing(0.5 - thinning * (0.5 - pressure)));
}

/**
 * Widen the radius where the stylus was leaning across the direction of travel.
 *
 * The lean is a vector on the page, and the only part of it the line can be
 * wider for is the part that lies *across* where the line is going — which is
 * exactly the cross product of the lean with the unit direction of travel, so
 * no angle is ever formed. Drawn along the lean it is zero and the nib is the
 * upright one; drawn square across it, it is the whole lean and the nib is at
 * its broadest. That is the difference between the edge and the flat of a
 * pencil, and it is the whole of why a tilted pen feels like one.
 *
 * Multiplied onto the radius the pressure model and the tapers have already
 * agreed on, rather than folded into `baseRadius`: tilt says how wide the nib
 * meeting the page is, and pressure says how hard it is being pushed into it.
 * A stroke that tapers away at the lift still tapers away at whatever angle it
 * was held.
 */
function applyTiltBroadening(pointCount: number, tiltAmount: number): void {
  if (tiltAmount <= 0 || pointCount === 0) return;
  let leanX = buffers.tiltX[0]!;
  let leanY = buffers.tiltY[0]!;
  for (let i = 0; i < pointCount; i++) {
    if (i > 0) {
      const weight = onePoleWeight(
        buffers.distance[i]!,
        TILT_RESPONSE_DISTANCE,
      );
      leanX += (buffers.tiltX[i]! - leanX) * weight;
      leanY += (buffers.tiltY[i]! - leanY) * weight;
    }
    if (leanX === 0 && leanY === 0) continue;
    // The opening sample has no step behind it, so it borrows the one ahead;
    // a stroke of a single point has no direction at all and takes the full
    // lean, which is the round nib seen face on.
    const at = i > 0 ? i : 1;
    let across = vectorLength(leanX, leanY);
    if (at < pointCount) {
      const dx = buffers.pointX[at]! - buffers.pointX[at - 1]!;
      const dy = buffers.pointY[at]! - buffers.pointY[at - 1]!;
      const travel = vectorLength(dx, dy);
      if (travel > 0) across = Math.abs(dx * leanY - dy * leanX) / travel;
    }
    const broadening = 1 + tiltAmount * MAX_TILT_BROADENING * clamp01(across);
    buffers.radius[i] = buffers.radius[i]! * broadening;
  }
}

/** Compute pressure, short-stroke fixup, radius, and compatibility tapers. */
function calculateDynamics(
  pointCount: number,
  options: FreehandEngineOptions,
): void {
  const totalLength = buffers.runLength[pointCount - 1] ?? 0;
  const thinning = clamp(options.thinning, -1, 1);
  const easing = options.easing ?? linearEasing;
  let pressure = clamp01(buffers.inputZ[0] ?? 0.5);
  if (options.pressureWarmup || options.inkAlgorithm === 'reference') {
    // A pointer-down sample has no velocity history and a stylus often reports
    // its contact ramp. Average the opening response over five brush widths so
    // that one reading cannot leave a heavy blob at the press point.
    for (let i = 0; i < pointCount; i++) {
      if (buffers.runLength[i]! > options.size * 5) break;
      const stepRatio = clamp01(buffers.distance[i]! / options.size);
      let target: number;
      if (options.simulatePressure) {
        const rawPressure = Math.min(1, 1 - stepRatio);
        target = Math.min(
          1,
          pressure + (rawPressure - pressure) * stepRatio * PRESSURE_RELAXATION,
        );
      } else {
        target = Math.min(
          1,
          pressure +
            (Math.max(MIN_PHYSICAL_PRESSURE, buffers.inputZ[i]!) - pressure) *
              0.5,
        );
      }
      pressure += (target - pressure) * 0.5;
    }
  }
  let maximumPressure = pressure;

  for (let i = 0; i < pointCount; i++) {
    if (i > 0) {
      if (options.simulatePressure) {
        // Legacy path: strokes saved before the draw tool derived pressure from
        // true pointer velocity carry no usable signal, only the neutral
        // default, so their width still has to come from per-sample spacing.
        // Left exactly as it was — this is what those strokes look like.
        const stepRatio = clamp01(buffers.distance[i]! / options.size);
        pressure = clamp01(
          pressure +
            (Math.min(1, 1 - stepRatio) - pressure) *
              stepRatio *
              PRESSURE_RELAXATION,
        );
      } else {
        const target = Math.max(MIN_PHYSICAL_PRESSURE, buffers.inputZ[i]!);
        // `pressureWarmup` names the opening initialization above, not this
        // steady-state filter: relaxing by a fraction of `distance / size`
        // here is the brush-dependent rate `PRESSURE_RESPONSE_DISTANCE`
        // exists to replace.
        const response =
          options.inkAlgorithm === 'reference'
            ? clamp01(buffers.distance[i]! / options.size) * PRESSURE_RELAXATION
            : onePoleWeight(buffers.distance[i]!, PRESSURE_RESPONSE_DISTANCE);
        pressure = clamp01(pressure + (target - pressure) * response);
      }
    }
    buffers.pressure[i] = pressure;
    maximumPressure = Math.max(maximumPressure, pressure);
  }

  if (totalLength < 1) {
    pressure = maximumPressure;
    for (let i = 0; i < pointCount; i++) {
      buffers.pressure[i] = pressure;
    }
  }

  const startTaper =
    totalLength < 1
      ? 0
      : resolveTaper(options.startTaper, options.size, totalLength);
  const endTaper =
    totalLength < 1
      ? 0
      : resolveTaper(options.endTaper, options.size, totalLength);
  for (let i = 0; i < pointCount; i++) {
    let radius = baseRadius(
      buffers.pressure[i]!,
      options.size,
      thinning,
      easing,
    );
    const length = buffers.runLength[i]!;
    const startRatio = startTaper > 0 ? clamp01(length / startTaper) : 1;
    const endRatio =
      endTaper > 0 ? clamp01((totalLength - length) / endTaper) : 1;
    const startFactor = options.linearStartTaper
      ? startRatio
      : startRatio * (2 - startRatio);
    const endFactor = 1 - (1 - endRatio) ** 3;
    radius *= Math.min(startFactor, endFactor);
    buffers.radius[i] = Math.max(MIN_RADIUS, radius);
  }
  applyTiltBroadening(pointCount, clamp01(options.tiltAmount ?? 0));
}

function calculateGlobalVectors(pointCount: number): void {
  if (pointCount === 1) {
    buffers.vectorX[0] = 1;
    buffers.vectorY[0] = 0;
    return;
  }
  for (let i = 1; i < pointCount; i++) {
    const dx = buffers.pointX[i - 1]! - buffers.pointX[i]!;
    const dy = buffers.pointY[i - 1]! - buffers.pointY[i]!;
    const length = vectorLength(dx, dy);
    if (length > 0) {
      buffers.vectorX[i] = dx / length;
      buffers.vectorY[i] = dy / length;
      continue;
    }
    // A step that goes nowhere has no direction of its own, so it carries the
    // one before it. The old fallback was `(1, 1)`, which is not a unit vector
    // at all: the miter offset it produced was 41% too wide and locked at -45
    // degrees, so a stroke that doubled back onto its own start bulged there.
    buffers.vectorX[i] = i > 1 ? buffers.vectorX[i - 1]! : 1;
    buffers.vectorY[i] = i > 1 ? buffers.vectorY[i - 1]! : 0;
  }
  buffers.vectorX[0] = buffers.vectorX[1]!;
  buffers.vectorY[0] = buffers.vectorY[1]!;
}

/** Partition overlapping index ranges at acute and close hard elbows. */
function partition(pointCount: number, reference = false): number {
  buffers.boundary.fill(0, 0, pointCount);
  buffers.rawBoundary.fill(0, 0, pointCount);
  if (pointCount <= 1) {
    buffers.partitionStart[0] = 0;
    buffers.partitionEnd[0] = 0;
    return 1;
  }

  calculateGlobalVectors(pointCount);
  let partitionCount = 0;
  let start = 0;
  for (let i = 1; i < pointCount - 1; i++) {
    const directionChange = clamp(
      buffers.vectorX[i]! * buffers.vectorX[i + 1]! +
        buffers.vectorY[i]! * buffers.vectorY[i + 1]!,
      -1,
      1,
    );
    const acute = directionChange < -0.8;
    // Split exactly where the corner's miter would overshoot its limit, so the
    // join rounds off instead of spiking. The angle alone decides it: the old
    // test divided the neighbouring segment lengths by the brush radius, and
    // sample spacing is a record of hand speed, so one and the same corner
    // partitioned cleanly when drawn slowly and grew a spike when drawn fast.
    const meanRadius =
      (buffers.radius[i - 1]! + buffers.radius[i]! + buffers.radius[i + 1]!) /
      3;
    const hard = reference
      ? directionChange <= 0.7 &&
        (buffers.distance[i]! ** 2 + buffers.distance[i + 1]! ** 2) /
          meanRadius ** 2 <
          1.5
      : !acute && 1 + directionChange < MITER_DENOMINATOR_FLOOR;
    if (!acute && !hard) continue;

    buffers.boundary[i] = 1;
    if (acute) buffers.rawBoundary[i] = 1;
    buffers.partitionStart[partitionCount] = start;
    buffers.partitionEnd[partitionCount] = i;
    partitionCount++;
    start = i;
  }
  buffers.partitionStart[partitionCount] = start;
  buffers.partitionEnd[partitionCount] = pointCount - 1;
  return partitionCount + 1;
}

function sequenceIndex(
  localIndex: number,
  start: number,
  innerStart: number,
): number {
  return localIndex === 0 ? start : innerStart + localIndex - 1;
}

function sequenceX(
  localIndex: number,
  localCount: number,
  start: number,
  end: number,
  innerStart: number,
): number {
  const index = sequenceIndex(localIndex, start, innerStart);
  const useRaw =
    (localIndex === 0 && buffers.rawBoundary[start] === 1) ||
    (localIndex === localCount - 1 &&
      index === end &&
      buffers.rawBoundary[end] === 1);
  return useRaw ? buffers.inputX[index]! : buffers.pointX[index]!;
}

function sequenceY(
  localIndex: number,
  localCount: number,
  start: number,
  end: number,
  innerStart: number,
): number {
  const index = sequenceIndex(localIndex, start, innerStart);
  const useRaw =
    (localIndex === 0 && buffers.rawBoundary[start] === 1) ||
    (localIndex === localCount - 1 &&
      index === end &&
      buffers.rawBoundary[end] === 1);
  return useRaw ? buffers.inputY[index]! : buffers.pointY[index]!;
}

/**
 * Remove tiny inner segments after a partition boundary. The returned index is
 * the first centerline sample after the (possibly raw) duplicated boundary.
 */
function cleanupPartitionStart(start: number, end: number): number {
  if (buffers.boundary[start] === 0 || end - start < 2) return start + 1;
  const boundaryX =
    buffers.rawBoundary[start] === 1
      ? buffers.inputX[start]!
      : buffers.pointX[start]!;
  const boundaryY =
    buffers.rawBoundary[start] === 1
      ? buffers.inputY[start]!
      : buffers.pointY[start]!;
  let innerStart = start + 1;
  while (innerStart < end) {
    const dx = boundaryX - buffers.pointX[innerStart]!;
    const dy = boundaryY - buffers.pointY[innerStart]!;
    const threshold =
      ((buffers.radius[start]! + buffers.radius[innerStart]!) / 2) * 0.5;
    if (dx * dx + dy * dy >= threshold * threshold) break;
    innerStart++;
  }
  return innerStart;
}

function calculatePartitionTracks(
  start: number,
  end: number,
  innerStart: number,
  size: number,
  smoothing: number,
  reference = false,
  screenErrorLimit = 0,
): number {
  const localCount = 1 + Math.max(0, end - innerStart + 1);
  if (localCount <= 1) return 1;

  // Resolve the partition's centerline once. Both loops below read every point
  // of it, and the vector loop reads each point twice, so asking `sequenceX`
  // for it on demand answered the same boundary test six times per point.
  const seqX = buffers.sequenceX;
  const seqY = buffers.sequenceY;
  for (let local = 0; local < localCount; local++) {
    seqX[local] = sequenceX(local, localCount, start, end, innerStart);
    seqY[local] = sequenceY(local, localCount, start, end, innerStart);
  }

  for (let local = 1; local < localCount; local++) {
    const dx = seqX[local - 1]! - seqX[local]!;
    const dy = seqY[local - 1]! - seqY[local]!;
    const length = vectorLength(dx, dy);
    if (length > 0) {
      buffers.vectorX[local] = dx / length;
      buffers.vectorY[local] = dy / length;
      continue;
    }
    // See `calculateGlobalVectors`: carry the previous direction rather than
    // the non-unit `(1, 1)` this used to fall back to.
    buffers.vectorX[local] = local > 1 ? buffers.vectorX[local - 1]! : 1;
    buffers.vectorY[local] = local > 1 ? buffers.vectorY[local - 1]! : 0;
  }

  // `seq[0]` is already the boundary — the raw sample at an acute corner — and
  // `seq[1]` the first centerline point after it, so `vector[1]` is the arm
  // leaving the corner and is what the corner itself turns on.
  buffers.vectorX[0] = buffers.vectorX[1]!;
  buffers.vectorY[0] = buffers.vectorY[1]!;

  if (reference && start > 0 && buffers.rawBoundary[start] === 1) {
    const dx = buffers.pointX[start]! - seqX[1]!;
    const dy = buffers.pointY[start]! - seqY[1]!;
    const length = vectorLength(dx, dy);
    if (length > 0) {
      buffers.vectorX[0] = dx / length;
      buffers.vectorY[0] = dy / length;
    }
  }
  // The brush-relative bound is what the stroke looks like drawn at 1:1; the
  // screen-referenced one is what survives rasterization at the camera this
  // render is for. Neither subsumes the other — a thick brush zoomed in wants
  // the first, a thin one zoomed out the second — so the outline is allowed
  // whichever error is larger.
  const errorLimit = Math.max(
    (reference ? 1 : clamp01(smoothing)) * size * TRACK_ERROR_LIMIT,
    screenErrorLimit > 0 ? screenErrorLimit : 0,
  );
  let trackCount = 0;
  let wasSharp = false;
  const append = (lx: number, ly: number, rx: number, ry: number) => {
    buffers.trackLeftX[trackCount] = lx;
    buffers.trackLeftY[trackCount] = ly;
    buffers.trackRightX[trackCount] = rx;
    buffers.trackRightY[trackCount++] = ry;
  };

  for (let local = 0; local < localCount; local++) {
    const index = sequenceIndex(local, start, innerStart);
    const centerX = seqX[local]!;
    const centerY = seqY[local]!;
    const next = local + 1 < localCount ? local + 1 : localCount - 1;
    const directionChange = clamp(
      buffers.vectorX[next]! * buffers.vectorX[local]! +
        buffers.vectorY[next]! * buffers.vectorY[local]!,
      -1,
      1,
    );
    if (reference && local > 0 && local < localCount - 1) {
      const prev = local - 1;
      const prevDot =
        buffers.vectorX[local]! * buffers.vectorX[prev]! +
        buffers.vectorY[local]! * buffers.vectorY[prev]!;
      const sharp = (prevDot < 0 && !wasSharp) || directionChange < 0.2;
      if (sharp) {
        const radius = buffers.radius[index]!;
        const hard = directionChange <= -0.62 ||
          buffers.runLength[end]! - buffers.runLength[index]! <= radius;
        const cx = hard ? buffers.inputX[index]! : centerX;
        const cy = hard ? buffers.inputY[index]! : centerY;
        const armX = -buffers.vectorY[prev]! * radius;
        const armY = buffers.vectorX[prev]! * radius;
        const cross =
          buffers.vectorX[prev]! * buffers.vectorY[next]! -
          buffers.vectorY[prev]! * buffers.vectorX[next]!;
        if (!hard) {
          // Bevel the outside of the turn and hold the inside at one point.
          // Sweeping both edges around the center twists the ribbon at elbows.
          const nextArmX = -buffers.vectorY[next]! * radius;
          const nextArmY = buffers.vectorX[next]! * radius;
          const innerX = (armX + nextArmX) / 2;
          const innerY = (armY + nextArmY) / 2;
          if (cross >= 0) {
            append(cx + armX, cy + armY, cx - innerX, cy - innerY);
            append(cx + nextArmX, cy + nextArmY, cx - innerX, cy - innerY);
          } else {
            append(cx + innerX, cy + innerY, cx - armX, cy - armY);
            append(cx + innerX, cy + innerY, cx - nextArmX, cy - nextArmY);
          }
          wasSharp = true;
          continue;
        }
        const sweep = Math.PI + 0.0001;
        const tolerance = Math.max(0.05, size * 0.02);
        const steps = Math.max(
          8,
          Math.min(
            13,
            Math.ceil(
              Math.abs(sweep) /
                (2 * Math.acos(clamp(1 - tolerance / radius, -1, 1))),
            ),
          ),
        );
        for (let k = 0; k <= steps; k++) {
          const angle = (sweep * k) / steps;
          const ox = armX * Math.cos(angle) - armY * Math.sin(angle);
          const oy = armX * Math.sin(angle) + armY * Math.cos(angle);
          const reverseAngle = sweep - angle;
          append(cx + ox, cy + oy,
            cx + armX * Math.cos(reverseAngle) - armY * Math.sin(reverseAngle),
            cy + armX * Math.sin(reverseAngle) + armY * Math.cos(reverseAngle));
        }
        wasSharp = true;
        continue;
      }
    }
    wasSharp = false;
    // Offset along the turn's bisector, scaled so the ribbon stays exactly one
    // radius wide measured perpendicular to each arm. The previous offset was
    // an un-normalized lerp between the two segment normals, whose length rode
    // the turn angle in both directions — 0.87x at a 60-degree turn, so the
    // line pinched, and 2.1x approaching a reversal, so it bulged.
    // `directionChange === 1` (a straight run) reduces this to the plain
    // segment normal, leaving straight ink byte-identical.
    const miterScale =
      buffers.radius[index]! /
      Math.max(1 + directionChange, MITER_DENOMINATOR_FLOOR);
    const offsetX = reference
      ? (buffers.vectorY[next]! +
          (buffers.vectorY[local]! - buffers.vectorY[next]!) *
            directionChange) *
        buffers.radius[index]!
      : (buffers.vectorY[next]! + buffers.vectorY[local]!) * miterScale;
    const offsetY = reference
      ? -(
          buffers.vectorX[next]! +
          (buffers.vectorX[local]! - buffers.vectorX[next]!) * directionChange
        ) * buffers.radius[index]!
      : -(buffers.vectorX[next]! + buffers.vectorX[local]!) * miterScale;
    const leftX = centerX - offsetX;
    const leftY = centerY - offsetY;
    const rightX = centerX + offsetX;
    const rightY = centerY + offsetY;
    append(leftX, leftY, rightX, rightY);
  }

  return simplifyTracks(trackCount, errorLimit);
}

function midpointCenti(a: number, b: number): number {
  return Math.round((a + b) * 50);
}

function writeForwardTrack(count: number): void {
  const writer = buffers.writer;
  if (count <= 1) return;
  if (count === 2) {
    const targetX = toCenti(buffers.trackLeftX[1]!);
    const targetY = toCenti(buffers.trackLeftY[1]!);
    writer.quadraticTo(targetX, targetY, targetX, targetY);
    return;
  }

  writer.quadraticTo(
    toCenti(buffers.trackLeftX[1]!),
    toCenti(buffers.trackLeftY[1]!),
    midpointCenti(buffers.trackLeftX[1]!, buffers.trackLeftX[2]!),
    midpointCenti(buffers.trackLeftY[1]!, buffers.trackLeftY[2]!),
  );
  for (let i = 2; i < count - 1; i++) {
    writer.smoothTo(
      midpointCenti(buffers.trackLeftX[i]!, buffers.trackLeftX[i + 1]!),
      midpointCenti(buffers.trackLeftY[i]!, buffers.trackLeftY[i + 1]!),
    );
  }
  writer.smoothTo(
    toCenti(buffers.trackLeftX[count - 1]!),
    toCenti(buffers.trackLeftY[count - 1]!),
  );
}

function writeReverseTrack(count: number): void {
  const writer = buffers.writer;
  if (count <= 1) return;
  if (count === 2) {
    const targetX = toCenti(buffers.trackRightX[0]!);
    const targetY = toCenti(buffers.trackRightY[0]!);
    writer.quadraticTo(targetX, targetY, targetX, targetY);
    return;
  }

  writer.quadraticTo(
    toCenti(buffers.trackRightX[count - 2]!),
    toCenti(buffers.trackRightY[count - 2]!),
    midpointCenti(
      buffers.trackRightX[count - 2]!,
      buffers.trackRightX[count - 3]!,
    ),
    midpointCenti(
      buffers.trackRightY[count - 2]!,
      buffers.trackRightY[count - 3]!,
    ),
  );
  for (let i = count - 3; i > 0; i--) {
    writer.smoothTo(
      midpointCenti(buffers.trackRightX[i]!, buffers.trackRightX[i - 1]!),
      midpointCenti(buffers.trackRightY[i]!, buffers.trackRightY[i - 1]!),
    );
  }
  writer.smoothTo(
    toCenti(buffers.trackRightX[0]!),
    toCenti(buffers.trackRightY[0]!),
  );
}

function writeDot(index: number): void {
  const writer = buffers.writer;
  const centerX = toCenti(buffers.pointX[index]!);
  const centerY = toCenti(buffers.pointY[index]!);
  const radius = toCenti(buffers.radius[index]!);
  writer.moveTo(centerX + radius, centerY);
  writer.arcTo(radius, centerX - radius, centerY);
  writer.arcTo(radius, centerX + radius, centerY);
  writer.close();
}

function writePartition(
  start: number,
  end: number,
  size: number,
  smoothing: number,
  reference = false,
  screenErrorLimit = 0,
): void {
  if (start === end) {
    writeDot(start);
    return;
  }
  const innerStart = cleanupPartitionStart(start, end);
  const count = calculatePartitionTracks(
    start,
    end,
    innerStart,
    size,
    smoothing,
    reference,
    screenErrorLimit,
  );
  if (count <= 1) {
    writeDot(start);
    return;
  }

  const writer = buffers.writer;
  writer.moveTo(
    toCenti(buffers.trackLeftX[0]!),
    toCenti(buffers.trackLeftY[0]!),
  );
  writeForwardTrack(count);

  writer.arcTo(
    toCenti(buffers.radius[end]!),
    toCenti(buffers.trackRightX[count - 1]!),
    toCenti(buffers.trackRightY[count - 1]!),
  );
  if (reference) {
    // Continue around the endpoint for a total 540-degree sweep. The extra
    // turn keeps a curling terminal ribbon covered with nonzero winding.
    writer.arcTo(
      toCenti(buffers.radius[end]!),
      toCenti(buffers.trackLeftX[count - 1]!),
      toCenti(buffers.trackLeftY[count - 1]!),
    );
    writer.arcTo(
      toCenti(buffers.radius[end]!),
      toCenti(buffers.trackRightX[count - 1]!),
      toCenti(buffers.trackRightY[count - 1]!),
    );
  }
  writeReverseTrack(count);
  writer.arcTo(
    toCenti(buffers.radius[start]!),
    toCenti(buffers.trackLeftX[0]!),
    toCenti(buffers.trackLeftY[0]!),
  );
  writer.close();
}

/**
 * The conditioned centerline of a stroke: the samples the outline is actually
 * built around, after compaction and stabilization.
 *
 * `x` and `y` are borrowed views onto the engine's workspace, valid only until
 * the next call into this module — copy out anything that must outlive that.
 */
export interface InkCenterline {
  count: number;
  x: Float64Array;
  y: Float64Array;
}

const centerlineView: InkCenterline = {
  count: 0,
  x: buffers.pointX,
  y: buffers.pointY,
};

/**
 * Condition a stroke's samples exactly as the outline pipeline does, without
 * building the outline.
 *
 * Callers that need to follow the rendered stroke — hit-testing, the dashed
 * centerline — used to re-implement the smoothing themselves and each missed a
 * different part of it, so a click could land off the visible ink and a dashed
 * stroke could sit beside the solid one drawn from the same points.
 */
export function buildInkCenterline(
  points: DrawPoint[],
  size: number,
  streamlineAmount: number,
  last: boolean,
  inkAlgorithm?: 'reference',
): InkCenterline {
  centerlineView.x = buffers.pointX;
  centerlineView.y = buffers.pointY;
  if (points.length === 0 || !Number.isFinite(size) || size <= 0) {
    centerlineView.count = 0;
    return centerlineView;
  }
  // Pressure never moves the centerline, so the simulation flag is irrelevant
  // here; `false` skips the two-point expansion, which only interpolates
  // collinear samples anyway.
  const stagedCount = ingest(points, size, false, inkAlgorithm === 'reference');
  centerlineView.count = streamline(
    stagedCount,
    size,
    streamlineAmount,
    last,
    inkAlgorithm === 'reference',
  );
  centerlineView.x = buffers.pointX;
  centerlineView.y = buffers.pointY;
  return centerlineView;
}

/**
 * SVG path data for a conditioned centerline, drawn as quadratics through the
 * midpoints of its samples.
 *
 * Shares the outline's byte writer rather than building the string with
 * `toFixed` and concatenation. That is not a micro-optimization here: at 600
 * samples the formatting was ~140µs against ~7µs for the centerline itself, so
 * a dashed stroke cost several times what the solid one it traces does.
 *
 * The chained `t` commands are exactly the explicit quadratics they replace —
 * reflecting control `p[i-1]` about endpoint `(p[i-1] + p[i]) / 2` gives
 * `p[i]`, the control the next segment wants — and the closing `t` onto the
 * final sample degenerates to the straight run to the lift position.
 */
/**
 * Choose the centerline samples the emitted path will be drawn through, under
 * the same windowed perpendicular bound {@link simplifyTracks} applies to the
 * outline, and write them to `buffers.centerlineKeep`.
 *
 * An index list rather than a compaction of `line` itself: the same conditioned
 * samples measure the arc length dashes are distributed along and answer hit
 * tests, and neither may move because the camera pulled back. Only what is
 * painted coarsens.
 */
function simplifyCenterline(line: InkCenterline, tolerance: number): number {
  const count = line.count;
  const keep = buffers.centerlineKeep;
  if (tolerance <= 0 || count <= 2) {
    for (let i = 0; i < count; i++) keep[i] = i;
    return count;
  }
  const toleranceSquared = tolerance * tolerance;
  const lastIndex = count - 1;
  let output = 1;
  let anchor = 0;
  keep[0] = 0;

  while (anchor < lastIndex) {
    let best = anchor + 1;
    const windowEnd = Math.min(anchor + SIMPLIFY_WINDOW, lastIndex);

    candidate: for (let target = anchor + 2; target <= windowEnd; target++) {
      for (let point = anchor + 1; point < target; point++) {
        if (
          segmentDistanceSquared(
            line.x[point]!,
            line.y[point]!,
            line.x[anchor]!,
            line.y[anchor]!,
            line.x[target]!,
            line.y[target]!,
          ) > toleranceSquared
        ) {
          break candidate;
        }
      }
      best = target;
    }

    keep[output++] = best;
    anchor = best;
  }

  return output;
}

export function getInkCenterlinePathData(
  line: InkCenterline,
  tolerance = 0,
): string {
  if (line.count < 2) return '';
  const keep = buffers.centerlineKeep;
  const count = simplifyCenterline(line, tolerance);
  if (count < 2) return '';
  const x = (i: number) => line.x[keep[i]!]!;
  const y = (i: number) => line.y[keep[i]!]!;
  const writer = buffers.writer;
  writer.reset(count * 24 + 64);
  writer.moveTo(toCenti(x(0)), toCenti(y(0)));
  if (count === 2) {
    const targetX = toCenti(x(1));
    const targetY = toCenti(y(1));
    writer.quadraticTo(targetX, targetY, targetX, targetY);
    return writer.finish();
  }
  writer.quadraticTo(
    toCenti(x(1)),
    toCenti(y(1)),
    midpointCenti(x(1), x(2)),
    midpointCenti(y(1), y(2)),
  );
  for (let i = 2; i < count - 1; i++) {
    writer.smoothTo(midpointCenti(x(i), x(i + 1)), midpointCenti(y(i), y(i + 1)));
  }
  writer.smoothTo(toCenti(x(count - 1)), toCenti(y(count - 1)));
  return writer.finish();
}

/** Run the complete non-reentrant ink pipeline and emit SVG path data. */
export function getFreehandPathData(
  points: DrawPoint[],
  options: FreehandEngineOptions,
): string {
  if (
    points.length === 0 ||
    !Number.isFinite(options.size) ||
    options.size <= 0
  ) {
    return '';
  }

  const stagedCount = ingest(
    points,
    options.size,
    options.simulatePressure,
    options.inkAlgorithm === 'reference',
  );
  const pointCount = streamline(
    stagedCount,
    options.size,
    options.streamline,
    options.last,
    options.inkAlgorithm === 'reference',
  );
  if (pointCount === 0) return '';

  calculateDynamics(pointCount, options);
  const partitionCount = partition(
    pointCount,
    options.inkAlgorithm === 'reference',
  );
  buffers.writer.reset(pointCount * 96 + partitionCount * 160 + 128);
  for (let i = 0; i < partitionCount; i++) {
    writePartition(
      buffers.partitionStart[i]!,
      buffers.partitionEnd[i]!,
      options.size,
      options.smoothing,
      options.inkAlgorithm === 'reference',
      options.errorLimit ?? 0,
    );
  }
  return buffers.writer.finish();
}
