import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  rotatePoint,
  unionBounds,
} from '@whiteboard/shared';
import { containerBounds } from './hierarchy';
import { shapeRotatedBounds } from './shape-bounds';
import { shapeRegistry } from './shapes/shape-registry';
import type { ShapeHandle } from './shapes/types';

export { shapeRotatedBounds };

export type ResizeHandleId =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';
export type HandleId = ResizeHandleId | 'rotate';

export const RESIZE_HANDLES: ResizeHandleId[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
];

/** Screen-px offset of the rotate handle above the top edge. */
const ROTATE_OFFSET = 24;

export interface SelectionInfo {
  ids: string[];
  /** Unrotated world AABB (single: the shape's bounds; multi: union of rotated AABBs). */
  bounds: Bounds;
  /** Single-shape rotation; 0 for multi-selection. */
  rotation: number;
  center: Point;
  /** Oriented corners (rotated for single), world. */
  corners: { nw: Point; ne: Point; se: Point; sw: Point };
  /** Generic resize/rotate box handles (single only); empty for multi or when
   * the shape exposes its own custom handles. */
  handles: { id: HandleId; point: Point }[];
  /** Shape-specific handles (e.g. connector endpoints/bend); null otherwise. */
  customHandles: ShapeHandle[] | null;
  isSingle: boolean;
}

export function getSelectionInfo(
  shapes: Shape[],
  ids: string[],
  zoom: number,
): SelectionInfo | null {
  if (ids.length === 0) return null;
  const idSet = new Set(ids);
  const selected = shapes.filter((s) => idSet.has(s.id));
  if (selected.length === 0) return null;

  const isSingle = selected.length === 1;

  if (isSingle) {
    const shape = selected[0]!;
    const util = shapeRegistry.getFor(shape);
    if (!util) return null;
    const isGroup = shape.type === 'group';
    // Groups derive their box from descendants; an empty group has none.
    const bounds = isGroup
      ? containerBounds(shapes, shape.id)
      : util.getBounds(shape);
    if (!bounds) return null;
    // Groups never rotate; their box is axis-aligned.
    const rotation = isGroup ? 0 : shape.rotation;
    const center = boundsCenter(bounds);
    const rot = (x: number, y: number): Point =>
      rotation ? rotatePoint({ x, y }, center, rotation) : { x, y };

    const { minX, minY, maxX, maxY } = bounds;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const corners = {
      nw: rot(minX, minY),
      ne: rot(maxX, minY),
      se: rot(maxX, maxY),
      sw: rot(minX, maxY),
    };
    const handlePts: Record<ResizeHandleId, Point> = {
      nw: corners.nw,
      n: rot(midX, minY),
      ne: corners.ne,
      e: rot(maxX, midY),
      se: corners.se,
      s: rot(midX, maxY),
      sw: corners.sw,
      w: rot(minX, midY),
    };
    // Groups show a box but move-only (no handles). Locked shapes likewise show
    // a box with no editing affordances. Connectors own their custom handles and
    // suppress the generic box. Frames resize but don't rotate.
    const noHandles = shape.locked || isGroup;
    const customHandles = noHandles ? null : util.getHandles?.(shape) ?? null;

    let handles: { id: HandleId; point: Point }[] = [];
    if (!noHandles && !customHandles) {
      handles = RESIZE_HANDLES.map((id) => ({ id, point: handlePts[id] }));
      if (shape.type !== 'frame') {
        handles.push({
          id: 'rotate',
          point: rot(midX, minY - ROTATE_OFFSET / zoom),
        });
      }
    }

    return {
      ids: [shape.id],
      bounds,
      rotation,
      center,
      corners,
      handles,
      customHandles,
      isSingle: true,
    };
  }

  // Multi-selection: axis-aligned union of each shape's rotated AABB.
  let bounds = shapeRotatedBounds(selected[0]!);
  for (let i = 1; i < selected.length; i++) {
    bounds = unionBounds(bounds, shapeRotatedBounds(selected[i]!));
  }
  const { minX, minY, maxX, maxY } = bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  // Group bounding-box controller: 8 axis-aligned resize handles, no rotation.
  // Suppressed entirely if every selected shape is locked.
  const anyUnlocked = selected.some((s) => !s.locked);
  const groupPts: Record<ResizeHandleId, Point> = {
    nw: { x: minX, y: minY },
    n: { x: midX, y: minY },
    ne: { x: maxX, y: minY },
    e: { x: maxX, y: midY },
    se: { x: maxX, y: maxY },
    s: { x: midX, y: maxY },
    sw: { x: minX, y: maxY },
    w: { x: minX, y: midY },
  };
  return {
    ids: selected.map((s) => s.id),
    bounds,
    rotation: 0,
    center: boundsCenter(bounds),
    corners: {
      nw: { x: minX, y: minY },
      ne: { x: maxX, y: minY },
      se: { x: maxX, y: maxY },
      sw: { x: minX, y: maxY },
    },
    handles: anyUnlocked
      ? RESIZE_HANDLES.map((id) => ({ id, point: groupPts[id] }))
      : [],
    customHandles: null,
    isSingle: false,
  };
}
