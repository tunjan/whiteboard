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
