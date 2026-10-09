import type { DrawPoint } from './shapes/shapes';

/**
 * Binary encoding for one stretch of a draw shape's points.
 *
 * Every channel is fixed-point: position in 1/32 of a world unit, pressure and
 * tilt in 1/256. The first point is stored against zero and every later point
 * against the one before it, each value a zigzag varint. A stroke's samples sit
 * one to four world units apart, so a coordinate step is usually one or two
 * bytes and a pressure step one — about half what the Float16-delta Base64
 * form this replaced took, and half again under Yjs, which stores a Uint8Array
 * as raw bytes where it stored the Base64 as a string.
 *
 * Integer deltas add up exactly, so a decoded point is the quantized sample
 * however far along the chunk it sits: nothing drifts, and "is this the sample
 * that was stored?" has an exact answer (`sameStoredPoint`). The position
 * quantum is at most a quarter of a screen pixel at the deepest zoom (8x).
 *
 * Layout: one header byte naming the channels (`2` x/y, `3` adds pressure, `5`
 * adds the two tilt channels), then the varints, channel-major within a point.
 */
export type InkDimension = 2 | 3 | 5;

const POSITION_SCALE = 32;
const UNIT_SCALE = 256;
const NEUTRAL_PRESSURE = 0.5;
/** Bytes a varint of any safe integer can take. */
const MAX_VARINT_BYTES = 8;

function clampPressure(value: number | undefined): number {
  if (!Number.isFinite(value)) return NEUTRAL_PRESSURE;
  return Math.max(0, Math.min(1, value!));
}

function clampTilt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value!));
}

function isDimension(value: number): value is InkDimension {
  return value === 2 || value === 3 || value === 5;
}

/**
 * The narrowest layout that holds every sample. Tilt is a vector and its two
 * components are meaningless apart, so a stroke either carries both or neither;
 * a stylus held upright a whole stroke still encodes without them.
 */
function dimensionFor(points: readonly DrawPoint[]): InkDimension {
  let dimension: InkDimension = 2;
  for (const point of points) {
    if (quantizeUnit(clampTilt(point.tiltX)) !== 0) return 5;
    if (quantizeUnit(clampTilt(point.tiltY)) !== 0) return 5;
    if (
      quantizeUnit(clampPressure(point.pressure)) !==
      quantizeUnit(NEUTRAL_PRESSURE)
    ) {
      dimension = 3;
    }
  }
  return dimension;
}

function quantizePosition(value: number): number {
  return Math.round(value * POSITION_SCALE);
}

function quantizeUnit(value: number): number {
  return Math.round(value * UNIT_SCALE);
}

/** One point's channels as stored integers, into a shared scratch array. */
const channels = new Float64Array(5);

function readChannels(point: DrawPoint, previous: Float64Array): void {
  // A non-finite coordinate repeats the previous one rather than reaching
  // geometry; the first point's "previous" is the origin.
  channels[0] = Number.isFinite(point.x)
    ? quantizePosition(point.x)
    : previous[0]!;
  channels[1] = Number.isFinite(point.y)
    ? quantizePosition(point.y)
    : previous[1]!;
  channels[2] = quantizeUnit(clampPressure(point.pressure));
  channels[3] = quantizeUnit(clampTilt(point.tiltX));
  channels[4] = quantizeUnit(clampTilt(point.tiltY));
}

/**
 * Whether two samples store as the same point. The append path asks this of
 * what is stored and what the caller now holds, so it must be exactly the
 * encoder's own rounding — anything looser misses edits, anything stricter
 * rewrites a stroke that only grew.
 */
export function sameStoredPoint(a: DrawPoint, b: DrawPoint): boolean {
  return (
    quantizePosition(a.x) === quantizePosition(b.x) &&
    quantizePosition(a.y) === quantizePosition(b.y) &&
    quantizeUnit(clampPressure(a.pressure)) ===
      quantizeUnit(clampPressure(b.pressure)) &&
    quantizeUnit(clampTilt(a.tiltX)) === quantizeUnit(clampTilt(b.tiltX)) &&
    quantizeUnit(clampTilt(a.tiltY)) === quantizeUnit(clampTilt(b.tiltY))
  );
}

/**
 * Zigzag varint, in arithmetic rather than bit operations: JavaScript's are
 * 32-bit, and a coordinate times 32 need not fit in 31 bits.
 */
function writeVarint(bytes: Uint8Array, at: number, value: number): number {
  let rest = value >= 0 ? value * 2 : -value * 2 - 1;
  while (rest >= 128) {
    bytes[at++] = (rest % 128) | 128;
    rest = Math.floor(rest / 128);
  }
  bytes[at++] = rest;
  return at;
}

/** Encode points as one self-contained chunk. */
export function encodeInkChunk(
  points: readonly DrawPoint[],
  dimension: InkDimension = dimensionFor(points),
): Uint8Array {
  const bytes = new Uint8Array(
    1 + points.length * dimension * MAX_VARINT_BYTES,
  );
  bytes[0] = dimension;
  let at = 1;
  const previous = new Float64Array(5);
  for (const point of points) {
    readChannels(point, previous);
    for (let channel = 0; channel < dimension; channel++) {
      at = writeVarint(bytes, at, channels[channel]! - previous[channel]!);
      previous[channel] = channels[channel]!;
    }
  }
  return bytes.slice(0, at);
}

/** The channel layout a chunk declares, or null for bytes that are not one. */
export function inkChunkDimension(chunk: unknown): InkDimension | null {
  if (!(chunk instanceof Uint8Array) || chunk.length === 0) return null;
  const dimension = chunk[0]!;
  return isDimension(dimension) ? dimension : null;
}

/** Decode one chunk. Malformed data decodes to nothing rather than to geometry. */
export function decodeInkChunk(chunk: Uint8Array): DrawPoint[] {
  const dimension = inkChunkDimension(chunk);
  if (dimension === null) return [];
  const running = new Float64Array(5);
  const points: DrawPoint[] = [];
  let at = 1;
  let channel = 0;
  while (at < chunk.length) {
    let value = 0;
    let scale = 1;
    let byte: number;
    do {
      if (at >= chunk.length) return [];
      byte = chunk[at++]!;
      value += (byte & 127) * scale;
      scale *= 128;
    } while (byte & 128);
    running[channel]! += value % 2 === 0 ? value / 2 : -(value + 1) / 2;
    if (++channel === dimension) {
      channel = 0;
      points.push(pointFrom(running, dimension));
    }
  }
  // A chunk that ends partway through a point was cut short.
  return channel === 0 ? points : [];
}

/**
 * One decoded point. Pressure is always present (neutral when not stored);
 * tilt only when the chunk carries it, so an upright stroke round-trips to
 * exactly the samples it was encoded from.
 */
function pointFrom(running: Float64Array, dimension: InkDimension): DrawPoint {
  const point: DrawPoint = {
    x: running[0]! / POSITION_SCALE,
    y: running[1]! / POSITION_SCALE,
    pressure:
      dimension === 2
        ? NEUTRAL_PRESSURE
        : Math.max(0, Math.min(1, running[2]! / UNIT_SCALE)),
  };
  if (dimension === 5) {
    point.tiltX = Math.max(-1, Math.min(1, running[3]! / UNIT_SCALE));
    point.tiltY = Math.max(-1, Math.min(1, running[4]! / UNIT_SCALE));
  }
  return point;
}
