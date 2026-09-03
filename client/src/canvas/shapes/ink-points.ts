import * as Y from 'yjs';
import type { DrawPoint } from '@whiteboard/shared';
import { decodeB64Vecs, encodeB64Vecs, encodedDimension } from './b64-vecs';

/**
 * Yjs encoding for a draw shape's append-only point stream.
 *
 * New strokes are a Y.Array of independently decodable Base64 segments. Each
 * segment stores a Float32 anchor followed by Float16 deltas, and drops the
 * pressure channel when every point is neutral. A live frame appends one
 * segment, so the CRDT write cost remains linear instead of rewriting the
 * stroke accumulated so far.
 *
 * Readers accept all previous forms: flat number triples, DrawPoint objects,
 * and the original plain `props.points` array. Any edit writes the new format.
 */

type StoredPoint = string | number | DrawPoint;
const NEUTRAL_PRESSURE = 0.5;
const MAX_FLOAT16 = 65_504;

function encodeTriples(points: DrawPoint[]): number[] {
  const out = new Array<number>(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    out[i * 3] = point.x;
    out[i * 3 + 1] = point.y;
    out[i * 3 + 2] = point.pressure ?? NEUTRAL_PRESSURE;
  }
  return out;
}

function decodeTriples(values: number[]): DrawPoint[] {
  const count = Math.floor(values.length / 3);
  return Array.from({ length: count }, (_, index) => ({
    x: values[index * 3]!,
    y: values[index * 3 + 1]!,
    pressure: values[index * 3 + 2]!,
  }));
}

function decodeChunks(chunks: readonly string[]): DrawPoint[] {
  const decoded = chunks.map(decodeB64Vecs);
  const count = decoded.reduce((total, points) => total + points.length, 0);
  const output = new Array<DrawPoint>(count);
  let at = 0;
  for (const points of decoded) {
    for (const point of points) output[at++] = point;
  }
  return output;
}

function decodeStored(raw: StoredPoint[]): DrawPoint[] {
  if (raw.length === 0) return [];
  if (typeof raw[0] === 'string') {
    return decodeChunks(
      raw.filter((entry): entry is string => typeof entry === 'string'),
    );
  }
  if (typeof raw[0] === 'number') {
    return decodeTriples(
      raw.filter((entry): entry is number => typeof entry === 'number'),
    );
  }
  return raw.filter(
    (entry): entry is DrawPoint =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.x === 'number' &&
      typeof entry.y === 'number',
  );
}

interface MirrorBase {
  unobserved: boolean;
  stale: boolean;
}

interface EncodedMirror extends MirrorBase {
  kind: 'encoded';
  chunks: string[];
  lengths: number[];
  points: DrawPoint[];
  /**
   * The exact samples this client encoded into `chunks`, or null when what is
   * stored did not come from here (a peer's append, a reload, an undo).
   *
   * `points` is the decoded stroke, and decoding is lossy: a Float16 delta
   * carries the quantization of its own step, which is unrelated to the
   * magnitude of the coordinate it lands on. Deciding "is this an append or an
   * edit?" by comparing a caller's samples against those decoded values asks a
   * lossy format to answer an equality question it cannot, and a stroke that
   * passes near an axis with a long step fails it — every frame from there on
   * rewrote the whole array. Keeping what was actually written makes the
   * comparison exact and independent of how precisely it is stored.
   */
  written: DrawPoint[] | null;
}

interface TriplesMirror extends MirrorBase {
  kind: 'triples';
  nums: number[];
  points: DrawPoint[];
  clean: number;
}

type PointsMirror = EncodedMirror | TriplesMirror;
const mirrors = new WeakMap<Y.Array<StoredPoint>, PointsMirror>();

function spliceItems<T>(
  target: T[],
  at: number,
  remove: number,
  insert: readonly T[],
): void {
  const tail = target.slice(at + remove);
  target.length = at;
  for (const value of insert) target.push(value);
  for (const value of tail) target.push(value);
}

function pointOffset(lengths: readonly number[], chunkIndex: number): number {
  let offset = 0;
  for (let index = 0; index < chunkIndex; index++) offset += lengths[index]!;
  return offset;
}

function applyEncodedDelta(
  mirror: EncodedMirror,
  event: Y.YArrayEvent<StoredPoint>,
): void {
  // `unobserved` is set by `syncYPoints` immediately before its own write, so
  // finding it still set means this delta is that write coming back. Anything
  // else — a peer, an undo — moved the chunks without going through the shadow,
  // which no longer describes them.
  if (!mirror.unobserved) mirror.written = null;
  mirror.unobserved = false;
  if (mirror.stale) return;
  let at = 0;
  for (const operation of event.changes.delta) {
    if (operation.retain !== undefined) {
      at += operation.retain;
      continue;
    }
    if (operation.delete !== undefined) {
      const pointAt = pointOffset(mirror.lengths, at);
      let removePoints = 0;
      for (let index = at; index < at + operation.delete; index++) {
        removePoints += mirror.lengths[index] ?? 0;
      }
      spliceItems(mirror.chunks, at, operation.delete, []);
      spliceItems(mirror.lengths, at, operation.delete, []);
      spliceItems(mirror.points, pointAt, removePoints, []);
      continue;
    }
    if (operation.insert !== undefined) {
      const insert = operation.insert as StoredPoint[];
      if (!insert.every((entry) => typeof entry === 'string')) {
        mirror.stale = true;
        return;
      }
      const chunks = insert as string[];
      if (!chunks.every((chunk) => encodedDimension(chunk) !== null)) {
        mirror.stale = true;
        return;
      }
      const decoded = chunks.map(decodeB64Vecs);
      const lengths = decoded.map((points) => points.length);
      const points = decoded.flat();
      const pointAt = pointOffset(mirror.lengths, at);
      spliceItems(mirror.chunks, at, 0, chunks);
      spliceItems(mirror.lengths, at, 0, lengths);
      spliceItems(mirror.points, pointAt, 0, points);
      at += chunks.length;
    }
  }
}

function invalidateTriplesFrom(
  mirror: TriplesMirror,
  numberIndex: number,
): void {
  const point = Math.floor(numberIndex / 3);
  if (point < mirror.clean) mirror.clean = point;
}

function applyTriplesDelta(
  mirror: TriplesMirror,
  event: Y.YArrayEvent<StoredPoint>,
): void {
  mirror.unobserved = false;
  if (mirror.stale) return;
  let at = 0;
  for (const operation of event.changes.delta) {
    if (operation.retain !== undefined) {
      at += operation.retain;
    } else if (operation.delete !== undefined) {
      spliceItems(mirror.nums, at, operation.delete, []);
      invalidateTriplesFrom(mirror, at);
    } else if (operation.insert !== undefined) {
      const insert = operation.insert as StoredPoint[];
      if (!insert.every((entry) => typeof entry === 'number')) {
        mirror.stale = true;
        return;
      }
      spliceItems(mirror.nums, at, 0, insert as number[]);
      invalidateTriplesFrom(mirror, at);
      at += insert.length;
    }
  }
}

function createMirror(
  arr: Y.Array<StoredPoint>,
  raw: StoredPoint[],
): PointsMirror | null {
  if (raw.length === 0 || raw.every((entry) => typeof entry === 'string')) {
    const chunks = raw as string[];
    if (!chunks.every((chunk) => encodedDimension(chunk) !== null)) return null;
    const decoded = chunks.map(decodeB64Vecs);
    const mirror: EncodedMirror = {
      kind: 'encoded',
      chunks: chunks.slice(),
      lengths: decoded.map((points) => points.length),
      points: decoded.flat(),
      // What is already stored did not necessarily come from here. A live
      // stroke adopts the shadow on its first append instead — a new shape is
      // created with its seed point, so it never reaches here empty.
      written: null,
      unobserved: false,
      stale: false,
    };
    arr.observe((event) => applyEncodedDelta(mirror, event));
    return mirror;
  }
  if (raw.every((entry) => typeof entry === 'number')) {
    const mirror: TriplesMirror = {
      kind: 'triples',
      nums: (raw as number[]).slice(),
      points: [],
      clean: 0,
      unobserved: false,
      stale: false,
    };
    arr.observe((event) => applyTriplesDelta(mirror, event));
    return mirror;
  }
  return null;
}

function mirrorFor(arr: Y.Array<StoredPoint>): PointsMirror | null {
  const existing = mirrors.get(arr);
  if (existing && !existing.stale) return existing;
  if (existing?.unobserved) return null;
  const mirror = createMirror(arr, arr.toArray());
  if (mirror) mirrors.set(arr, mirror);
  return mirror;
}

function decodedTriples(mirror: TriplesMirror): DrawPoint[] {
  const count = Math.floor(mirror.nums.length / 3);
  if (mirror.points.length > count) mirror.points.length = count;
  for (let index = mirror.clean; index < count; index++) {
    mirror.points[index] = {
      x: mirror.nums[index * 3]!,
      y: mirror.nums[index * 3 + 1]!,
      pressure: mirror.nums[index * 3 + 2]!,
    };
  }
  mirror.clean = count;
  return mirror.points;
}

function almostEqual(a: number, b: number): boolean {
  const tolerance = Math.max(0.001, Math.max(Math.abs(a), Math.abs(b)) * 0.001);
  return Math.abs(a - b) <= tolerance;
}

function isPrefix(
  current: readonly DrawPoint[],
  next: readonly DrawPoint[],
  exact: boolean,
): boolean {
  if (next.length < current.length) return false;
  for (let index = 0; index < current.length; index++) {
    const a = current[index]!;
    const b = next[index]!;
    const pressureA = a.pressure ?? NEUTRAL_PRESSURE;
    const pressureB = b.pressure ?? NEUTRAL_PRESSURE;
    // An absent lean and a measured upright one are the same sample to
    // compare, exactly as an absent pressure is the neutral one: a stroke
    // stored without tilt channels decodes without them, and the caller that
    // wrote it may hold either form.
    const tiltXA = a.tiltX ?? 0;
    const tiltXB = b.tiltX ?? 0;
    const tiltYA = a.tiltY ?? 0;
    const tiltYB = b.tiltY ?? 0;
    if (exact) {
      if (
        a.x !== b.x ||
        a.y !== b.y ||
        pressureA !== pressureB ||
        tiltXA !== tiltXB ||
        tiltYA !== tiltYB
      ) {
        return false;
      }
    } else if (
      !almostEqual(a.x, b.x) ||
      !almostEqual(a.y, b.y) ||
      !almostEqual(pressureA, pressureB) ||
      !almostEqual(tiltXA, tiltXB) ||
      !almostEqual(tiltYA, tiltYB)
    ) {
      return false;
    }
  }
  return true;
}

/** Materialize a stroke from the current or any legacy storage form. */
export function readPoints(
  map: Y.Map<unknown>,
  storedProps: Record<string, unknown>,
): DrawPoint[] {
  const stored = map.get('points');
  if (stored instanceof Y.Array) {
    const arr = stored as Y.Array<StoredPoint>;
    const mirror = mirrorFor(arr);
    if (mirror && !mirror.unobserved) {
      return mirror.kind === 'encoded' ? mirror.points : decodedTriples(mirror);
    }
    return decodeStored(arr.toArray());
  }
  return Array.isArray(storedProps.points)
    ? (storedProps.points as DrawPoint[])
    : [];
}

/** Append a live tail when possible; rewrite once for resize/erase/migration. */
export function syncYPoints(
  arr: Y.Array<StoredPoint>,
  next: DrawPoint[],
): void {
  const mirror = mirrorFor(arr);
  const current =
    mirror && !mirror.unobserved
      ? mirror.kind === 'encoded'
        ? mirror.points
        : decodedTriples(mirror)
      : decodeStored(arr.toArray());
  // Prefer the samples this client wrote over the ones read back out of the
  // encoding. See `EncodedMirror.written`. The length guard keeps the two from
  // being compared when anything has left them describing different stretches
  // of the stroke.
  const shadow =
    mirror?.kind === 'encoded' &&
    mirror.written !== null &&
    mirror.written.length === current.length
      ? mirror.written
      : null;
  const exact = mirror?.kind === 'triples';
  const prefix = shadow
    ? isPrefix(shadow, next, true)
    : isPrefix(current, next, exact);
  if (prefix && next.length === current.length) return;
  if (prefix && mirror?.kind === 'encoded') {
    const tail = next.slice(current.length);
    mirror.unobserved = true;
    arr.push(encodePointsForStorage(tail) as StoredPoint[]);
    // The prefix test that got here established that the caller's samples and
    // the stored chunks describe the same stretch, so the caller's are the
    // unquantized record of it and become the shadow from here on. Without
    // this a stroke never acquires one: its shape is created holding a seed
    // point, so the mirror is always built over chunks it did not see written.
    // A shadow whose length no longer matches was skipped by the guard above
    // and would stay skipped forever, since both arrays grow by the same tail:
    // re-seed it here so the stroke returns to the exact comparison.
    if (mirror.written === null || mirror.written.length !== current.length) {
      mirror.written = next.slice(0, current.length);
    }
    // The observer runs at the end of the enclosing transaction and sees this
    // write as its own, so extending the shadow here keeps it in step. The
    // array is the mirror's own copy and is never handed out, so it is grown in
    // place rather than rebuilt — the frame must cost the new points, no more.
    mirror.written.push(...tail);
    return;
  }

  // A rewrite re-establishes the shadow whatever it was before, which is what
  // lets a stroke that once fell back to rewriting start appending again.
  const owner = mirror ?? mirrors.get(arr) ?? null;
  if (owner) owner.unobserved = true;
  if (owner?.kind === 'encoded') owner.written = next.slice();
  arr.delete(0, arr.length);
  const encoded = encodePointsForStorage(next);
  if (encoded.length > 0) arr.insert(0, encoded as StoredPoint[]);
}

/** Ensure a points Y.Array, promoting a legacy props array in the new format. */
export function ensurePointsArray(map: Y.Map<unknown>): Y.Array<StoredPoint> {
  const existing = map.get('points');
  if (existing instanceof Y.Array) return existing as Y.Array<StoredPoint>;
  const legacy = map.get('props') as { points?: unknown } | undefined;
  const points = Array.isArray(legacy?.points)
    ? (legacy.points as DrawPoint[])
    : [];
  const arr = Y.Array.from(encodePointsForStorage(points) as StoredPoint[]);
  map.set('points', arr);
  return arr;
}

/** Encode stroke points into independently anchored Base64 Y.Array entries. */
export function encodePointsForStorage(points: DrawPoint[]): string[] {
  if (points.length === 0) return [];
  const segments: string[] = [];
  let start = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (
      Math.abs(point.x - previous.x) <= MAX_FLOAT16 &&
      Math.abs(point.y - previous.y) <= MAX_FLOAT16
    ) {
      continue;
    }
    segments.push(encodeB64Vecs(points.slice(start, index)));
    start = index;
  }
  segments.push(encodeB64Vecs(points.slice(start)));
  return segments;
}

/** Legacy helper retained for migration tests and fixture construction. */
export function encodeLegacyPointTriples(points: DrawPoint[]): number[] {
  return encodeTriples(points);
}
