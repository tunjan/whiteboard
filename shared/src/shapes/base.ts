/**
 * Fields common to every shape. `Props` is the per-type typed bag.
 *
 * The reserved optional fields are intentionally additive and unused in Pass 1
 * so later features (grouping/frames, locking, hiding) slot in without
 * reshaping the core shape model.
 */
export interface BaseShape<Type extends string, Props> {
  id: string;
  type: Type;
  /** World position of the shape's local origin (top-left for box shapes). */
  x: number;
  y: number;
  /** Rotation around the shape's center, in radians. */
  rotation: number;
  /** Fractional z-order key — conflict-free reordering under the CRDT. */
  index: string;
  /** Typed, per-type property bag. */
  props: Props;

  // --- Reserved (additive, unused in Pass 1) ---
  /** Parent group/frame id. */
  parentId?: string | null;
  /** Locked shapes are shared and not editable until unlocked. */
  locked?: boolean;
  /** Hidden is a local-only visibility toggle. */
  hidden?: boolean;
  /**
   * Local opacity in [0, 1] (undefined = 1 = fully opaque). The rendered
   * opacity compounds this value with every ancestor container's opacity.
   */
  opacity?: number;
}

/**
 * A stored shape keeps every field above except `props` in one Y.Map entry
 * under this key, not one entry per field. Yjs pays ~150 B of heap per map
 * entry, and a shape had nine of them. The cost: concurrent writes to two of
 * these fields on one shape (one peer moves it while another locks it) no
 * longer merge — the later write of the whole entry wins.
 *
 * The entry is an array in `SHAPE_BASE_FIELDS` order, not an object: an object
 * spells every field name out again in every shape and every update to one.
 * Fields are only ever appended to that list, never reordered.
 */
export const SHAPE_BASE_KEY = 'base';

export const SHAPE_BASE_FIELDS = [
  'id',
  'type',
  'x',
  'y',
  'rotation',
  'index',
  'parentId',
  'locked',
  'hidden',
  'opacity',
] as const;

export type StoredShapeBase = Omit<BaseShape<string, unknown>, 'props'>;

/** The stored entry for the base fields `read` returns. */
export function packShapeBase(read: (field: string) => unknown): unknown[] {
  const packed = SHAPE_BASE_FIELDS.map(read);
  while (packed.length > 0 && packed[packed.length - 1] === undefined) {
    packed.pop();
  }
  return packed;
}

/** The base fields of a stored entry; unset ones are left out. */
export function unpackShapeBase(packed: readonly unknown[]): StoredShapeBase {
  const base: Record<string, unknown> = {};
  for (let i = 0; i < packed.length; i++) {
    if (packed[i] !== undefined) base[SHAPE_BASE_FIELDS[i]!] = packed[i];
  }
  return base as unknown as StoredShapeBase;
}

/** The base fields a stored shape map holds, or null when it has no entry. */
export function readShapeBase(map: {
  get(key: string): unknown;
}): StoredShapeBase | null {
  const packed = map.get(SHAPE_BASE_KEY);
  return Array.isArray(packed) ? unpackShapeBase(packed) : null;
}
