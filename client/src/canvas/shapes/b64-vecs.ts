import type { DrawPoint } from '@whiteboard/shared';

/**
 * Channels stored per point: `2` is x/y, `3` adds pressure, `5` adds the two
 * tilt channels on top of it.
 *
 * There is no 4: tilt is a vector and its two components are meaningless
 * apart, so a stroke either carries the lean of the barrel or it does not.
 * Widening every pen stroke from three channels to five costs four bytes a
 * sample, which is why the widening is driven by the samples themselves rather
 * than by the pointer that made them — a stylus held upright for a whole
 * stroke still encodes as 3.
 */
export type EncodedDimension = 2 | 3 | 5;

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const NEUTRAL_PRESSURE = 0.5;

function clampPressure(value: number | undefined): number {
  if (!Number.isFinite(value)) return NEUTRAL_PRESSURE;
  return Math.max(0, Math.min(1, value!));
}

function clampTilt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value!));
}

function isDimension(value: number): value is EncodedDimension {
  return value === 2 || value === 3 || value === 5;
}

function dimensionFor(points: readonly DrawPoint[]): EncodedDimension {
  let dimension: EncodedDimension = 2;
  for (const point of points) {
    if (clampTilt(point.tiltX) !== 0 || clampTilt(point.tiltY) !== 0) return 5;
    if (Math.abs(clampPressure(point.pressure) - NEUTRAL_PRESSURE) > 1e-7) {
      dimension = 3;
    }
  }
  return dimension;
}

/**
 * One point's channels, in storage order, filled into a shared scratch array.
 *
 * Reused rather than returned fresh: this runs once per sample per encode, and
 * a live stroke re-encodes its newest segment every frame.
 */
const channels = new Float64Array(5);

function readChannels(point: DrawPoint, previous: Float64Array): void {
  channels[0] = Number.isFinite(point.x) ? point.x : previous[0]!;
  channels[1] = Number.isFinite(point.y) ? point.y : previous[1]!;
  channels[2] = clampPressure(point.pressure);
  channels[3] = clampTilt(point.tiltX);
  channels[4] = clampTilt(point.tiltY);
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1]! : 0;
    const c = hasC ? bytes[index + 2]! : 0;
    const value = (a << 16) | (b << 8) | c;
    output += BASE64[(value >>> 18) & 63];
    output += BASE64[(value >>> 12) & 63];
    output += hasB ? BASE64[(value >>> 6) & 63] : '=';
    output += hasC ? BASE64[value & 63] : '=';
  }
  return output;
}

function base64ToBytes(value: string): Uint8Array | null {
  if (value.length % 4 !== 0) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (index >= contentLength) {
      if (char !== '=') return null;
    } else if (BASE64.indexOf(char) < 0) {
      return null;
    }
  }
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let write = 0;
  for (let index = 0; index < value.length; index += 4) {
    const chars = [
      BASE64.indexOf(value[index]!),
      BASE64.indexOf(value[index + 1]!),
      index + 2 >= contentLength ? 0 : BASE64.indexOf(value[index + 2]!),
      index + 3 >= contentLength ? 0 : BASE64.indexOf(value[index + 3]!),
    ];
    if (chars.some((char) => char < 0)) return null;
    const bits =
      (chars[0]! << 18) | (chars[1]! << 12) | (chars[2]! << 6) | chars[3]!;
    if (write < output.length) output[write++] = (bits >>> 16) & 0xff;
    if (write < output.length) output[write++] = (bits >>> 8) & 0xff;
    if (write < output.length) output[write++] = bits & 0xff;
  }
  return output;
}

const float32 = new Float32Array(1);
const uint32 = new Uint32Array(float32.buffer);

/** IEEE-754 binary32 to binary16, round-to-nearest. */
export function floatToHalf(value: number): number {
  float32[0] = Number.isFinite(value) ? value : 0;
  const bits = uint32[0]!;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((mantissa + 0x1000) >> 13);
  }
  if (exponent >= 31) return sign | 0x7bff;
  mantissa += 0x1000;
  if (mantissa & 0x800000) {
    mantissa = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7bff;
  }
  return sign | (exponent << 10) | (mantissa >> 13);
}

/** IEEE-754 binary16 to JavaScript number. */
export function halfToFloat(value: number): number {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = (value >>> 10) & 0x1f;
  const mantissa = value & 0x03ff;
  if (exponent === 0) {
    return mantissa === 0
      ? sign < 0
        ? -0
        : 0
      : sign * 2 ** -14 * (mantissa / 1024);
  }
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

function clean(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < 1e-8) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Encode one independent point segment.
 *
 * The first point is an absolute Float32 anchor. Later points are Float16
 * deltas from the point immediately before them. Which channels are present is
 * named by the prefix: `2:` is position only, `3:` adds pressure, `5:` adds
 * the two tilt channels.
 */
export function encodeB64Vecs(
  points: readonly DrawPoint[],
  dimension: EncodedDimension = dimensionFor(points),
): string {
  if (points.length === 0) return `${dimension}:`;
  const anchorBytes = dimension * 4;
  const deltaBytes = dimension * 2;
  const bytes = new Uint8Array(anchorBytes + (points.length - 1) * deltaBytes);
  const view = new DataView(bytes.buffer);
  const previous = new Float64Array(5);
  readChannels(points[0]!, previous);
  for (let channel = 0; channel < dimension; channel++) {
    view.setFloat32(channel * 4, channels[channel]!, true);
    previous[channel] = channels[channel]!;
  }

  let offset = anchorBytes;
  for (let index = 1; index < points.length; index++) {
    readChannels(points[index]!, previous);
    for (let channel = 0; channel < dimension; channel++) {
      const value = channels[channel]!;
      view.setUint16(
        offset + channel * 2,
        floatToHalf(value - previous[channel]!),
        true,
      );
      previous[channel] = value;
    }
    offset += deltaBytes;
  }
  return `${dimension}:${bytesToBase64(bytes)}`;
}

/** Decode one segment. Malformed data is ignored instead of reaching geometry. */
export function decodeB64Vecs(encoded: string): DrawPoint[] {
  const separator = encoded.indexOf(':');
  if (separator < 0) return [];
  const dimension = Number(encoded.slice(0, separator));
  if (!isDimension(dimension)) return [];
  const payload = encoded.slice(separator + 1);
  if (payload.length === 0) return [];
  const bytes = base64ToBytes(payload);
  if (!bytes) return [];
  const anchorBytes = dimension * 4;
  const deltaBytes = dimension * 2;
  if (
    bytes.length < anchorBytes ||
    (bytes.length - anchorBytes) % deltaBytes !== 0
  ) {
    return [];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const running = new Float64Array(5);
  running[2] = NEUTRAL_PRESSURE;
  for (let channel = 0; channel < dimension; channel++) {
    running[channel] = clean(view.getFloat32(channel * 4, true));
  }
  const count = 1 + (bytes.length - anchorBytes) / deltaBytes;
  const points = new Array<DrawPoint>(count);
  points[0] = pointFrom(running, dimension);
  let offset = anchorBytes;
  for (let index = 1; index < count; index++) {
    for (let channel = 0; channel < dimension; channel++) {
      const delta = halfToFloat(
        view.getUint16(offset + channel * 2, true),
      );
      running[channel] = clean(running[channel]! + delta);
    }
    points[index] = pointFrom(running, dimension);
    offset += deltaBytes;
  }
  return points;
}

/**
 * One decoded point. Channels the segment does not carry are left off the
 * object rather than defaulted, so a stroke stored without tilt round-trips to
 * exactly the samples it was encoded from.
 */
function pointFrom(
  running: Float64Array,
  dimension: EncodedDimension,
): DrawPoint {
  const point: DrawPoint = {
    x: running[0]!,
    y: running[1]!,
    pressure: Math.max(0, Math.min(1, running[2]!)),
  };
  if (dimension === 5) {
    point.tiltX = Math.max(-1, Math.min(1, running[3]!));
    point.tiltY = Math.max(-1, Math.min(1, running[4]!));
  }
  return point;
}

export function encodedDimension(encoded: string): EncodedDimension | null {
  const separator = encoded.indexOf(':');
  if (separator < 0) return null;
  const dimension = Number(encoded.slice(0, separator));
  return isDimension(dimension) ? dimension : null;
}
