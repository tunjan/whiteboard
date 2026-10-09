import * as Y from 'yjs';
import {
  decodeInkChunk,
  encodeInkChunk,
  inkChunkDimension,
  sameStoredPoint,
  type DrawPoint,
} from '@whiteboard/shared';

/**
 * Yjs encoding for a draw shape's append-only point stream.
 *
 * A stroke is a Y.Array of independently decodable binary chunks
 * (`encodeInkChunk`: fixed-point zigzag-varint deltas). A live frame appends one
 * chunk, so the CRDT write cost stays linear instead of rewriting the stroke
 * accumulated so far; `compactYPoints` merges them when the stroke finishes.
 * Anything in the array that is not a chunk is ignored.
 */

type StoredChunk = Uint8Array;

function decodeStored(raw: readonly unknown[]): DrawPoint[] {
  const output: DrawPoint[] = [];
  for (const entry of raw) {
    if (inkChunkDimension(entry) === null) continue;
    for (const point of decodeInkChunk(entry as StoredChunk))
      output.push(point);
  }
  return output;
}

/**
 * The decoded stroke, kept in step with the array by its own observer so a
 * frame of a live stroke decodes only the chunk it added.
 */
interface PointsMirror {
  /** Set by `syncYPoints` before its own write; see `applyDelta`. */
  unobserved: boolean;
  /** The array holds something the mirror cannot represent. */
  stale: boolean;
  lengths: number[];
  points: DrawPoint[];
}

const mirrors = new WeakMap<Y.Array<StoredChunk>, PointsMirror>();

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

function applyDelta(
  mirror: PointsMirror,
  event: Y.YArrayEvent<StoredChunk>,
): void {
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
      spliceItems(mirror.lengths, at, operation.delete, []);
      spliceItems(mirror.points, pointAt, removePoints, []);
      continue;
    }
    if (operation.insert !== undefined) {
      const chunks = operation.insert as unknown[];
      if (!chunks.every((chunk) => inkChunkDimension(chunk) !== null)) {
        mirror.stale = true;
        return;
      }
      const decoded = (chunks as StoredChunk[]).map(decodeInkChunk);
      const pointAt = pointOffset(mirror.lengths, at);
      spliceItems(
        mirror.lengths,
        at,
        0,
        decoded.map((points) => points.length),
      );
      spliceItems(mirror.points, pointAt, 0, decoded.flat());
      at += chunks.length;
    }
  }
}

function mirrorFor(arr: Y.Array<StoredChunk>): PointsMirror | null {
  const existing = mirrors.get(arr);
  if (existing && !existing.stale) return existing;
  if (existing?.unobserved) return null;
  const raw = arr.toArray();
  if (!raw.every((chunk) => inkChunkDimension(chunk) !== null)) return null;
  const decoded = raw.map(decodeInkChunk);
  const mirror: PointsMirror = {
    lengths: decoded.map((points) => points.length),
    points: decoded.flat(),
    unobserved: false,
    stale: false,
  };
  arr.observe((event) => applyDelta(mirror, event));
  mirrors.set(arr, mirror);
  return mirror;
}

function isPrefix(
  current: readonly DrawPoint[],
  next: readonly DrawPoint[],
): boolean {
  if (next.length < current.length) return false;
  for (let index = 0; index < current.length; index++) {
    if (!sameStoredPoint(current[index]!, next[index]!)) return false;
  }
  return true;
}

/** Materialize a stroke's points. */
export function readPoints(map: Y.Map<unknown>): DrawPoint[] {
  const stored = map.get('points');
  if (!(stored instanceof Y.Array)) return [];
  const arr = stored as Y.Array<StoredChunk>;
  const mirror = mirrorFor(arr);
  if (mirror && !mirror.unobserved) return mirror.points;
  return decodeStored(arr.toArray());
}

/** Append a live tail when possible; rewrite for resize/erase/edits. */
export function syncYPoints(
  arr: Y.Array<StoredChunk>,
  next: DrawPoint[],
): void {
  const mirror = mirrorFor(arr);
  const current =
    mirror && !mirror.unobserved ? mirror.points : decodeStored(arr.toArray());
  // Decoding is exact up to the encoder's rounding, and `sameStoredPoint` is
  // that rounding, so this is an exact test of "did the stroke only grow?".
  const prefix = isPrefix(current, next);
  if (prefix && next.length === current.length) return;
  if (prefix && mirror) {
    mirror.unobserved = true;
    arr.push([encodeInkChunk(next.slice(current.length))]);
    return;
  }

  const owner = mirror ?? mirrors.get(arr) ?? null;
  if (owner) owner.unobserved = true;
  arr.delete(0, arr.length);
  const encoded = encodePointsForStorage(next);
  if (encoded.length > 0) arr.insert(0, encoded);
}

/**
 * Re-encode a finished stroke's per-frame chunks as one.
 *
 * A live stroke appends one chunk per frame, each with its own header byte and
 * a first point stored against zero, plus the Y.Array item around it. Merging
 * leaves the samples exactly as they were — the encoding is exact on the
 * quantized grid — and the delete leaves a tombstone of a few bytes behind.
 *
 * `points` must be what `arr` now holds — call it straight after
 * `syncYPoints(arr, points)`. The mirror cannot be the source: inside the write
 * transaction it has not yet heard the tail that call just appended.
 */
export function compactYPoints(
  arr: Y.Array<StoredChunk>,
  points: DrawPoint[],
): void {
  if (arr.length <= 1) return;
  const mirror = mirrorFor(arr);
  if (mirror) mirror.unobserved = true;
  arr.doc!.transact(() => {
    arr.delete(0, arr.length);
    arr.insert(0, encodePointsForStorage(points));
  });
}

/** The shape's points array, created empty if it has none. */
export function ensurePointsArray(map: Y.Map<unknown>): Y.Array<StoredChunk> {
  const existing = map.get('points');
  if (existing instanceof Y.Array) return existing as Y.Array<StoredChunk>;
  const arr = new Y.Array<StoredChunk>();
  map.set('points', arr);
  return arr;
}

/** Encode stroke points as Y.Array entries: one chunk, or none when empty. */
export function encodePointsForStorage(points: DrawPoint[]): StoredChunk[] {
  return points.length === 0 ? [] : [encodeInkChunk(points)];
}
