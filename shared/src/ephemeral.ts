/**
 * Momentary pointer effects — laser strokes and eraser trails — relayed over
 * the collaboration socket as stateless messages instead of awareness.
 *
 * Awareness re-sends a client's whole state on every change, so a laser stroke
 * published there cost every point drawn so far, plus the cursor, selection and
 * voice fields, 25 times a second. Here a laser message carries only the points
 * added since the last one, and an eraser message only the trail itself.
 */
export const EPHEMERAL_PREFIX = 'whiteboard:fx:';
export const MAX_EPHEMERAL_LENGTH = 65_536;
const MAX_LASER_OPS = 256;
const MAX_ID_LENGTH = 64;
/** Coordinates in one `add` op. A stroke re-sent whole after a reconnect fits. */
const MAX_LASER_COORDS = 16_384;
const MAX_SCRIBBLES = 16;
/** x, y, pressure triples. The sender thins a trail to sixteen samples. */
const MAX_SCRIBBLE_COORDS = 48;

export type LaserOp =
  /** Points `at` onwards of stroke `id`, as flat x,y pairs. */
  | { op: 'add'; id: string; at: number; points: number[] }
  | { op: 'done'; id: string }
  | { op: 'drop'; id: string };

export interface ScribbleWire {
  id: string;
  /** Flat x, y, pressure triples, oldest first. */
  points: number[];
  state: 'active' | 'stopping';
  size: number;
}

export type EphemeralMessage = { from: number } & (
  | { kind: 'laser'; ops: LaserOp[] }
  /** The sender's whole trail; an empty list clears it. */
  | { kind: 'scribbles'; scribbles: ScribbleWire[] }
);

export function encodeEphemeral(message: EphemeralMessage): string {
  return `${EPHEMERAL_PREFIX}${JSON.stringify(message)}`;
}

export function decodeEphemeral(payload: string): EphemeralMessage | null {
  if (
    payload.length > MAX_EPHEMERAL_LENGTH ||
    !payload.startsWith(EPHEMERAL_PREFIX)
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(payload.slice(EPHEMERAL_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(value) || !isClientId(value.from)) return null;
  if (value.kind === 'laser') {
    const { ops } = value;
    if (!Array.isArray(ops) || ops.length > MAX_LASER_OPS) return null;
    if (!ops.every(isLaserOp)) return null;
    return { from: value.from, kind: 'laser', ops };
  }
  if (value.kind === 'scribbles') {
    const { scribbles } = value;
    if (!Array.isArray(scribbles) || scribbles.length > MAX_SCRIBBLES) {
      return null;
    }
    if (!scribbles.every(isScribble)) return null;
    return { from: value.from, kind: 'scribbles', scribbles };
  }
  return null;
}

function isLaserOp(value: unknown): value is LaserOp {
  if (!isRecord(value) || !isId(value.id)) return false;
  if (value.op === 'done' || value.op === 'drop') return true;
  return (
    value.op === 'add' &&
    typeof value.at === 'number' &&
    Number.isInteger(value.at) &&
    value.at >= 0 &&
    isCoords(value.points, MAX_LASER_COORDS, 2)
  );
}

function isScribble(value: unknown): value is ScribbleWire {
  return (
    isRecord(value) &&
    isId(value.id) &&
    (value.state === 'active' || value.state === 'stopping') &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    value.size > 0 &&
    isCoords(value.points, MAX_SCRIBBLE_COORDS, 3)
  );
}

function isCoords(value: unknown, max: number, stride: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.length % stride === 0 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  );
}
