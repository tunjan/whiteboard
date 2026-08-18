import type { DrawPoint } from '@whiteboard/shared';

export type EncodedDimension = 2 | 3;

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const NEUTRAL_PRESSURE = 0.5;

function clampPressure(value: number | undefined): number {
  if (!Number.isFinite(value)) return NEUTRAL_PRESSURE;
  return Math.max(0, Math.min(1, value!));
}

function dimensionFor(points: readonly DrawPoint[]): EncodedDimension {
  return points.some(
    (point) =>
      Math.abs(clampPressure(point.pressure) - NEUTRAL_PRESSURE) > 1e-7,
  )
    ? 3
    : 2;
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
 * deltas from the point immediately before them. Constant-pressure segments
 * omit z entirely and carry a `2:` prefix; pressure-bearing segments use `3:`.
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
  const first = points[0]!;
  view.setFloat32(0, Number.isFinite(first.x) ? first.x : 0, true);
  view.setFloat32(4, Number.isFinite(first.y) ? first.y : 0, true);
  if (dimension === 3) view.setFloat32(8, clampPressure(first.pressure), true);

  let previousX = Number.isFinite(first.x) ? first.x : 0;
  let previousY = Number.isFinite(first.y) ? first.y : 0;
  let previousPressure = clampPressure(first.pressure);
  let offset = anchorBytes;
  for (let index = 1; index < points.length; index++) {
    const point = points[index]!;
    const x = Number.isFinite(point.x) ? point.x : previousX;
    const y = Number.isFinite(point.y) ? point.y : previousY;
    const pressure = clampPressure(point.pressure);
    view.setUint16(offset, floatToHalf(x - previousX), true);
    view.setUint16(offset + 2, floatToHalf(y - previousY), true);
    if (dimension === 3) {
      view.setUint16(
        offset + 4,
        floatToHalf(pressure - previousPressure),
        true,
      );
    }
    previousX = x;
    previousY = y;
    previousPressure = pressure;
    offset += deltaBytes;
  }
  return `${dimension}:${bytesToBase64(bytes)}`;
}

/** Decode one segment. Malformed data is ignored instead of reaching geometry. */
export function decodeB64Vecs(encoded: string): DrawPoint[] {
  const separator = encoded.indexOf(':');
  const dimension = Number(encoded.slice(0, separator));
  if ((dimension !== 2 && dimension !== 3) || separator < 0) return [];
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
  let x = clean(view.getFloat32(0, true));
  let y = clean(view.getFloat32(4, true));
  let pressure =
    dimension === 3 ? clean(view.getFloat32(8, true)) : NEUTRAL_PRESSURE;
  const count = 1 + (bytes.length - anchorBytes) / deltaBytes;
  const points = new Array<DrawPoint>(count);
  points[0] = { x, y, pressure };
  let offset = anchorBytes;
  for (let index = 1; index < count; index++) {
    x = clean(x + halfToFloat(view.getUint16(offset, true)));
    y = clean(y + halfToFloat(view.getUint16(offset + 2, true)));
    if (dimension === 3) {
      pressure = clean(
        pressure + halfToFloat(view.getUint16(offset + 4, true)),
      );
    }
    points[index] = {
      x,
      y,
      pressure: Math.max(0, Math.min(1, pressure)),
    };
    offset += deltaBytes;
  }
  return points;
}

export function encodedDimension(encoded: string): EncodedDimension | null {
  return encoded.startsWith('2:') ? 2 : encoded.startsWith('3:') ? 3 : null;
}
