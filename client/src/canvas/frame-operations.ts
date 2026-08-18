import {
  type Bounds,
  type FrameShape,
  type Point,
  type Shape,
  boundsCenter,
  isContainerType,
  rotatePoint,
} from '@whiteboard/shared';
import type { Editor } from './editor';
import {
  frameContainsBounds,
  frameContainsPoint,
  frameOverlapsBounds,
} from './frame-geometry';
import { containerBounds, descendantsOf } from './hierarchy';
import { isVisible } from './selectable';
import { shapeRotatedBounds } from './shape-bounds';
import { shapeRegistry } from './shapes/shape-registry';

function shapeContainerBounds(shapes: Shape[], shape: Shape): Bounds | null {
  return shape.type === 'group'
    ? containerBounds(shapes, shape.id)
    : shapeRotatedBounds(shape);
}

function shapePageCorners(shapes: Shape[], shape: Shape): Point[] {
  if (shape.type === 'group') {
    const bounds = containerBounds(shapes, shape.id);
    return bounds
      ? [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
        ]
      : [];
  }
  const util = shapeRegistry.getFor(shape);
  if (!util) return [];
  const raw = util.getBounds(shape as never);
  const stroke =
    shape.type === 'rectangle' ||
    shape.type === 'ellipse' ||
    shape.type === 'polygon'
      ? shape.props.size / 2
      : 0;
  const bounds = {
    minX: raw.minX - stroke,
    minY: raw.minY - stroke,
    maxX: raw.maxX + stroke,
    maxY: raw.maxY + stroke,
  };
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  if (!shape.rotation) return corners;
  const center = boundsCenter(bounds);
  return corners.map((point) => rotatePoint(point, center, shape.rotation));
}

/** Topmost unlocked frame containing `point`, excluding moving subtrees. */
export function topFrameAtPoint(
  shapes: readonly Shape[],
  point: Point,
  excludeIds: ReadonlySet<string> = new Set(),
): FrameShape | null {
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  let best: FrameShape | null = null;
  let bestDepth = -1;
  for (let index = shapes.length - 1; index >= 0; index--) {
    const shape = shapes[index]!;
    if (
      shape.type !== 'frame' ||
      shape.locked ||
      !isVisible(shape) ||
      excludeIds.has(shape.id)
    ) {
      continue;
    }
    if (!frameContainsPoint(shape, point)) continue;
    const depth = containerDepth(shape, byId);
    if (depth > bestDepth) {
      best = shape;
      bestDepth = depth;
    }
  }
  return best;
}

/** Topmost frame whose clip polygon overlaps a moving root's visible bounds. */
export function topFrameOverlappingShape(
  shapes: Shape[],
  moving: Shape,
  excludeIds: ReadonlySet<string> = new Set(),
): FrameShape | null {
  const bounds = shapeContainerBounds(shapes, moving);
  if (!bounds) return null;
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  let best: FrameShape | null = null;
  let bestDepth = -1;
  for (let index = shapes.length - 1; index >= 0; index--) {
    const shape = shapes[index]!;
    if (
      shape.type !== 'frame' ||
      shape.locked ||
      !isVisible(shape) ||
      excludeIds.has(shape.id)
    ) {
      continue;
    }
    if (!frameOverlapsBounds(shape, bounds)) continue;
    const depth = containerDepth(shape, byId);
    if (depth > bestDepth) {
      best = shape;
      bestDepth = depth;
    }
  }
  return best;
}

function containerDepth(
  shape: Shape,
  byId: ReadonlyMap<string, Shape>,
): number {
  let depth = 0;
  let current: Shape | undefined = shape;
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    depth++;
    current = parent;
  }
  return depth;
}

/**
 * Capture sibling roots completely enclosed by a newly-created frame. World
 * coordinates stay untouched in this engine; changing `parentId` alone keeps
 * every pixel invariant while activating clipping and container movement.
 */
export function captureEnclosedShapes(
  editor: Editor,
  frameId: string,
): string[] {
  const frame = editor.getShape(frameId);
  if (!frame || frame.type !== 'frame' || frame.locked) return [];
  const shapes = editor.getShapes();
  const parentId = frame.parentId ?? null;
  const captured: string[] = [];
  for (const shape of shapes) {
    if (
      shape.id === frame.id ||
      shape.locked ||
      (shape.parentId ?? null) !== parentId
    ) {
      continue;
    }
    const bounds = shapeContainerBounds(shapes, shape);
    if (bounds && frameContainsBounds(frame, bounds)) captured.push(shape.id);
  }
  if (!captured.length) return captured;
  editor.transact(() => {
    for (const id of captured) editor.updateShape(id, { parentId: frame.id });
  });
  return captured;
}

/** Bounds center used to choose a live frame drop target for any selection root. */
export function shapeDropPoint(shapes: Shape[], shape: Shape): Point | null {
  const bounds = shapeContainerBounds(shapes, shape);
  return bounds ? boundsCenter(bounds) : null;
}

/**
 * Fit a frame to its direct content in the frame's own rotated axes. Children
 * stay fixed in page space; only the viewport rectangle changes.
 */
export function fitFrameToContent(
  editor: Editor,
  frameId: string,
  padding = 10,
): boolean {
  const frame = editor.getShape(frameId);
  if (!frame || frame.type !== 'frame' || frame.locked) return false;
  const shapes = editor.getShapes();
  const children = shapes.filter((shape) => shape.parentId === frame.id);
  if (!children.length) return false;

  const angle = -frame.rotation;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const aligned = (point: Point): Point => ({
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    for (const corner of shapePageCorners(shapes, child)) {
      const point = aligned(corner);
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return false;

  const safePadding = Math.max(0, Number.isFinite(padding) ? padding : 10);
  const w = Math.max(1, maxX - minX + safePadding * 2);
  const h = Math.max(1, maxY - minY + safePadding * 2);
  const alignedCenter = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
  const pageCos = Math.cos(frame.rotation);
  const pageSin = Math.sin(frame.rotation);
  const center = {
    x: alignedCenter.x * pageCos - alignedCenter.y * pageSin,
    y: alignedCenter.x * pageSin + alignedCenter.y * pageCos,
  };
  editor.updateShape(frame.id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h },
  });
  return true;
}

/**
 * Promote direct children that no longer overlap a resized frame. Arrows are
 * deliberately exempt: connectors may cross container boundaries and are not
 * clipped by frames in either the canvas or export renderer.
 */
export function kickoutOccludedFrameChildren(
  editor: Editor,
  frameId: string,
): string[] {
  const frame = editor.getShape(frameId);
  if (!frame || frame.type !== 'frame' || frame.locked) return [];
  const shapes = editor.getShapes();
  const lost: string[] = [];
  for (const child of shapes) {
    if (child.parentId !== frame.id || child.type === 'arrow') continue;
    const bounds = shapeContainerBounds(shapes, child);
    if (bounds && !frameOverlapsBounds(frame, bounds)) lost.push(child.id);
  }
  if (!lost.length) return lost;
  editor.transact(() => {
    for (const id of lost) {
      editor.updateShape(id, { parentId: frame.parentId ?? null });
    }
  });
  return lost;
}

/** Selected roots only: descendants follow their selected container. */
export function selectionRoots(
  editor: Editor,
  ids: readonly string[],
): string[] {
  const selected = new Set(ids);
  const roots: string[] = [];
  for (const id of ids) {
    let shape = editor.getShape(id);
    let nested = false;
    const seen = new Set<string>();
    while (shape?.parentId && !seen.has(shape.parentId)) {
      seen.add(shape.parentId);
      if (selected.has(shape.parentId)) {
        nested = true;
        break;
      }
      shape = editor.getShape(shape.parentId);
    }
    if (!nested) roots.push(id);
  }
  return roots;
}

/** Every id that must be excluded as a frame drop target for these roots. */
export function movingSubtreeIds(
  shapes: Shape[],
  rootIds: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const id of rootIds) {
    out.add(id);
    const shape = shapes.find((candidate) => candidate.id === id);
    if (shape && isContainerType(shape.type)) {
      for (const child of descendantsOf(shapes, id)) out.add(child.id);
    }
  }
  return out;
}
