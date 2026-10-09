import * as Y from 'yjs';
import {
  encodeInkChunk,
  inkChunkDimension,
  readShapeBase,
  type DrawPoint,
} from '@whiteboard/shared';

/**
 * One-time rewrite of every stroke into the binary ink chunk format.
 *
 * The client reads only `encodeInkChunk` chunks. Strokes were stored four ways
 * before that, and this is the only code that still reads them:
 *   - Base64 strings: a Float32 anchor then Float16 deltas, `<dim>:<base64>`;
 *   - flat `[x, y, pressure, …]` numbers in the Y.Array;
 *   - DrawPoint objects in the Y.Array;
 *   - a plain array at `props.points`, before points had a Y.Array at all.
 *
 * Shapes live in root maps named `shapes` (a page document, or the page-default
 * of a board document from before pages were split out) or `shapes:<pageId>`
 * (the other pages of such a board).
 */

const NEUTRAL_PRESSURE = 0.5;

function halfToFloat(value: number): number {
  const exponent = (value >>> 10) & 0x1f;
  const mantissa = value & 0x03ff;
  const sign = value & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

/** The Base64 decoder's own rounding, which its deltas were encoded against. */
function clean(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) < 1e-8) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function decodeBase64Segment(encoded: string): DrawPoint[] {
  const separator = encoded.indexOf(':');
  const dimension = Number(encoded.slice(0, separator));
  if (separator < 0 || (dimension !== 2 && dimension !== 3 && dimension !== 5))
    return [];
  const bytes = Buffer.from(encoded.slice(separator + 1), 'base64');
  const anchorBytes = dimension * 4;
  const deltaBytes = dimension * 2;
  if (
    bytes.length < anchorBytes ||
    (bytes.length - anchorBytes) % deltaBytes !== 0
  ) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const running = [0, 0, NEUTRAL_PRESSURE, 0, 0];
  for (let channel = 0; channel < dimension; channel++) {
    running[channel] = clean(view.getFloat32(channel * 4, true));
  }
  const point = (): DrawPoint => {
    const p: DrawPoint = {
      x: running[0]!,
      y: running[1]!,
      pressure: Math.max(0, Math.min(1, running[2]!)),
    };
    if (dimension === 5) {
      p.tiltX = Math.max(-1, Math.min(1, running[3]!));
      p.tiltY = Math.max(-1, Math.min(1, running[4]!));
    }
    return p;
  };
  const points = [point()];
  for (let at = anchorBytes; at < bytes.length; at += deltaBytes) {
    for (let channel = 0; channel < dimension; channel++) {
      const delta = halfToFloat(view.getUint16(at + channel * 2, true));
      running[channel] = clean(running[channel]! + delta);
    }
    points.push(point());
  }
  return points;
}

function isDrawPoint(value: unknown): value is DrawPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DrawPoint).x === 'number' &&
    typeof (value as DrawPoint).y === 'number'
  );
}

/** A stroke's points from any legacy form, in stored order. */
export function readLegacyPoints(entries: readonly unknown[]): DrawPoint[] {
  const points: DrawPoint[] = [];
  const numbers: number[] = [];
  for (const entry of entries) {
    if (typeof entry === 'number') numbers.push(entry);
    else if (typeof entry === 'string') {
      points.push(...decodeBase64Segment(entry));
    } else if (isDrawPoint(entry)) points.push(entry);
  }
  for (let at = 0; at + 2 < numbers.length; at += 3) {
    points.push({
      x: numbers[at]!,
      y: numbers[at + 1]!,
      pressure: numbers[at + 2]!,
    });
  }
  return points;
}

function isShapesMap(name: string): boolean {
  return name === 'shapes' || name.startsWith('shapes:');
}

export interface InkMigrationResult {
  /** Strokes rewritten into chunks. */
  migrated: number;
  /** Strokes already stored as chunks, left untouched. */
  current: number;
}

/**
 * Rewrite every legacy stroke in `doc` in one transaction. Idempotent: a stroke
 * already stored as chunks is not written to.
 */
export function migrateInk(doc: Y.Doc): InkMigrationResult {
  const result: InkMigrationResult = { migrated: 0, current: 0 };
  const names = [...doc.share.keys()].filter(isShapesMap);
  doc.transact(() => {
    for (const name of names) {
      for (const shape of doc.getMap<unknown>(name).values()) {
        if (!(shape instanceof Y.Map)) continue;
        // Per-field before migrate-shapes.ts packed it; either may come first.
        const type = shape.get('type') ?? readShapeBase(shape)?.type;
        if (type !== 'draw') continue;
        const stored = shape.get('points');
        const props = shape.get('props') as Record<string, unknown> | undefined;
        const propsPoints = Array.isArray(props?.points)
          ? (props.points as unknown[])
          : null;
        const entries = stored instanceof Y.Array ? stored.toArray() : [];
        const isCurrent =
          stored instanceof Y.Array &&
          entries.every((entry) => inkChunkDimension(entry) !== null) &&
          propsPoints === null;
        if (isCurrent) {
          result.current++;
          continue;
        }
        // A Y.Array wins over a props copy: once promoted, the props copy was
        // a stale leftover the client no longer wrote to.
        const points = readLegacyPoints(
          stored instanceof Y.Array ? entries : (propsPoints ?? []),
        );
        shape.set(
          'points',
          Y.Array.from(points.length > 0 ? [encodeInkChunk(points)] : []),
        );
        if (propsPoints !== null) {
          const { points: _dropped, ...rest } = props!;
          shape.set('props', rest);
        }
        result.migrated++;
      }
    }
  });
  return result;
}
