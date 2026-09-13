import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  boundsContainsPoint,
  pointInPolygon,
  pointsBounds,
  rotatePoint,
  segmentsIntersect,
  segmentToSegmentDistance,
} from '@whiteboard/shared';
import { containerBounds } from './hierarchy';
import { shapeRotatedBounds } from './shape-bounds';
import {
  arrowPoints,
  curvePoints,
  tangentAnchor,
} from './shapes/line-geometry';
import { maxInkRadius } from './shapes/ink';
import { normalizedPolygonPoints } from './shapes/polygon-geometry';
import { shapeRegistry } from './shapes/shape-registry';
import type { ShapeHandle } from './shapes/types';

export { shapeRotatedBounds };

export type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CornerHandleId = Extract<ResizeHandleId, 'nw' | 'ne' | 'se' | 'sw'>;
export type RotationHandleId = `rotate-${CornerHandleId}`;
export type MarqueeMode = 'intersect' | 'wrap';

type Segment = readonly [Point, Point];

interface RegionGeometry {
  kind: 'region';
  outline: Point[];
}

interface StrokeGeometry {
  kind: 'stroke';
  segments: Segment[];
  radius: number;
}

type MarqueeGeometry = RegionGeometry | StrokeGeometry;

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

/**
 * The corner rotation zone is a square of this many resize-hit-target extents,
 * centred that same distance diagonally outside the corner. So it fills the
 * quadrant from the corner outwards and stops there, which is what keeps it
 * clear of the corner's own resize target.
 */
const ROTATE_CORNER_FACTOR = 1.62;
/**
 * Screen-px radius of a resize or shape handle's grab zone. Shared so the
 * circle the overlay draws around a hovered handle is the circle the select
 * tool actually tests against.
 */
export const HANDLE_HIT_SCREEN = 10;
/** Screen-px side of a drawn resize handle. Shared with the overlay. */
export const HANDLE_SCREEN = 7;
/**
 * The unit every degeneracy threshold below is a multiple of: the nominal
 * screen size of a handle. Kept separate from `HANDLE_SCREEN` (what a handle is
 * painted at) because it measures the room a handle *needs*, grip zone
 * included, not the square that is drawn.
 */
const HANDLE_UNIT_SCREEN = 8;
/**
 * Below two handle units on an axis (16 screen px) a box cannot carry both of
 * the corners on that axis' short edges without them overlapping.
 */
const TINY_SCREEN = 2 * HANDLE_UNIT_SCREEN;
/**
 * Below four handle units on an axis (32 screen px) the two opposing hit
 * targets on that axis would meet in the middle and leave no band of the
 * interior free to grab the shape by.
 */
const SMALL_SCREEN = 4 * HANDLE_UNIT_SCREEN;
/** Screen-px half-extent of a resize handle's hit target on a fine pointer. */
const HIT_TARGET_SCREEN = 6;
/** Fingers are blunter than cursors, so every touch target grows by this. */
const COARSE_HIT_FACTOR = 1.75;
/**
 * Applied to every hit target regardless of pointer: the raw extent is sized
 * for the widest handle spacing, and trimming it keeps neighbouring targets
 * from touching on a box that is merely small rather than tiny.
 */
const HIT_TARGET_TRIM = 0.75;
/** A corner's square target is this multiple of the larger axis extent. */
const CORNER_HIT_FACTOR = 1.5;
/** Touch rotate knob offset from the box, as a multiple of the hit extent. */
const MOBILE_ROTATE_OFFSET = 1.5;

/**
 * The eight handles in clockwise order from the top, so that adding a step per
 * 45 degrees rotates a handle to the one that now occupies its place. Used to
 * pick a cursor for a handle on a rotated box.
 */
export const ORDERED_RESIZE_HANDLES = [
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
  'nw',
] as const;

/** The handle that sits where `handle` does once the box turns by `rotation`. */
export function rotateResizeHandle(
  handle: ResizeHandleId,
  rotation: number,
): ResizeHandleId {
  const turn = Math.PI * 2;
  const normalized = ((rotation % turn) + turn) % turn;
  const steps = Math.round(normalized / (Math.PI / 4));
  const index = ORDERED_RESIZE_HANDLES.indexOf(
    handle as (typeof ORDERED_RESIZE_HANDLES)[number],
  );
  return ORDERED_RESIZE_HANDLES[(index + steps) % 8]!;
}

export interface SelectionInfo {
  ids: string[];
  /** World AABB enclosing the displayed selection box. */
  bounds: Bounds;
  /**
   * The selection box in the frame where it is axis-aligned: page space
   * rotated about the origin by `-rotation`. Equals `bounds` when `rotation`
   * is 0. Group resize scales in this frame and rotates the result back, which
   * is what lets an oriented multi-selection resize along its own axes.
   */
  alignedBounds: Bounds;
  /** Shared page rotation, or 0 when selected elements have mixed rotations. */
  rotation: number;
  center: Point;
  /** Oriented corners of the selection box in world space. */
  corners: { nw: Point; ne: Point; se: Point; sw: Point };
  /** Generic resize handles; empty when the shape exposes custom handles. */
  handles: { id: ResizeHandleId; point: Point }[];
  /**
   * Invisible rotation targets just beyond each corner. `extent` is the square
   * half-extent of the zone in world units, measured along the box axes: the
   * zone turns with the box, so a hit test has to run in the box's own frame.
   */
  rotationHandles: { id: RotationHandleId; point: Point; extent: number }[];
  /**
   * Single visible rotation knob for coarse pointers, which get no corner
   * zones: a finger cannot hover to discover an invisible target, and four of
   * them around a small box would swallow the box. Null on fine pointers.
   */
  mobileRotateHandle: { point: Point; radius: number } | null;
  /**
   * Half-extent of a resize handle's hit target along each box axis, in world
   * units. Per-axis because a box that is short on one axis has its targets on
   * that axis halved, so the two opposing ones leave the middle free.
   */
  hitTarget: { x: number; y: number };
  /** Shape-specific handles (e.g. connector endpoints/bend); null otherwise. */
  customHandles: ShapeHandle[] | null;
  isSingle: boolean;
}

function pageRotation(shape: Shape): number {
  if (shape.type === 'group') return 0;
  return Math.atan2(Math.sin(shape.rotation), Math.cos(shape.rotation));
}

function sharedSelectionRotation(shapes: Shape[]): number {
  const first = shapes[0];
  if (!first) return 0;
  const shared = pageRotation(first);
  for (let i = 1; i < shapes.length; i++) {
    if (pageRotation(shapes[i]!) !== shared) return 0;
  }
  return shared;
}

function shapeControlBounds(shape: Shape, allShapes: Shape[]): Bounds | null {
  if (shape.type === 'group') return containerBounds(allShapes, shape.id);
  return shapeRegistry.getFor(shape)?.getBounds(shape as never) ?? null;
}

function boundsCorners(bounds: Bounds): Point[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/**
 * The corners of one shape's own oriented box, in world space, clockwise from
 * its top-left. Used for the membership outlines a multi-selection draws around
 * each of its elements: the axis-aligned envelope of a rotated shape stands
 * well clear of it on every side, which reads as the selection having caught
 * something bigger than what is actually in it. Null for an empty group, which
 * has no box.
 */
export function shapeOutlineCorners(
  shape: Shape,
  /** All page shapes. Only read when `shape` is a group. */
  allShapes: Shape[],
): Point[] | null {
  const bounds = shapeControlBounds(shape, allShapes);
  if (!bounds) return null;
  const corners = boundsCorners(bounds);
  const rotation = pageRotation(shape);
  if (!rotation) return corners;
  const center = boundsCenter(bounds);
  return corners.map((corner) => rotatePoint(corner, center, rotation));
}

/**
 * How degenerate the box is, in the two senses that change what it can carry.
 *
 * *Tiny* on an axis means the handles on that axis' short edges would overlap,
 * so the set has to be culled. *Small* means they still fit but their grab
 * zones would meet across the middle, leaving nowhere to grab the shape
 * itself — that one is answered by shrinking the zones rather than by dropping
 * handles, so the box keeps its full set right down to the tiny threshold.
 */
interface SelectionScale {
  isTinyX: boolean;
  isTinyY: boolean;
  isSmallX: boolean;
  isSmallY: boolean;
  hitTarget: { x: number; y: number };
}

function selectionScale(
  width: number,
  height: number,
  zoom: number,
  coarse: boolean,
): SelectionScale {
  const tiny = TINY_SCREEN / zoom;
  const small = SMALL_SCREEN / zoom;
  const isSmallX = width < small;
  const isSmallY = height < small;
  const base = (HIT_TARGET_SCREEN / zoom) * (coarse ? COARSE_HIT_FACTOR : 1);
  const trim = HIT_TARGET_TRIM * (coarse ? COARSE_HIT_FACTOR : 1);
  return {
    isTinyX: width < tiny,
    isTinyY: height < tiny,
    isSmallX,
    isSmallY,
    hitTarget: {
      x: (isSmallX ? base / 2 : base) * trim,
      y: (isSmallY ? base / 2 : base) * trim,
    },
  };
}

/**
 * Culls the handle set down to what the box has room for, in stages.
 *
 * A box tiny on either axis keeps only the two corners of one diagonal: the
 * other two would sit on top of them, and the edge handles between them have
 * no room at all. A box tiny on *both* axes keeps a single corner, so that
 * whatever is left of its interior stays grabbable. Touch drops the edge
 * handles outright — a finger covers the whole edge of a modest box, and the
 * corners it would shadow are the ones that do more.
 */
function degradedHandles(
  ids: readonly ResizeHandleId[],
  scale: SelectionScale,
  coarse: boolean,
): ResizeHandleId[] {
  const showOnlyOneHandle = scale.isTinyX && scale.isTinyY;
  if (showOnlyOneHandle) return ids.filter((id) => id === 'nw');
  const hideAlternateCorners = scale.isTinyX || scale.isTinyY;
  return ids.filter((id) => {
    const isCorner = id.length === 2;
    if (!isCorner) return !hideAlternateCorners && !coarse;
    return !hideAlternateCorners || id === 'nw' || id === 'se';
  });
}

/**
 * Half-side of a corner rotation zone, in world units: the nominal resize hit
 * extent scaled up, so the zone stays a fixed screen size and always the same
 * amount bigger than the corner target it sits beyond. The nominal extent
 * rather than the box's own `hitTarget` — that one is trimmed and halved to
 * keep neighbouring targets apart *inside* the box, which is not a constraint
 * out where these zones sit.
 */
function cornerZoneExtent(zoom: number): number {
  return (HIT_TARGET_SCREEN / zoom) * ROTATE_CORNER_FACTOR;
}

/**
 * Where the touch rotate knob sits, in the box's own frame with the origin at
 * its top-left corner. Above the box by default. Media keeps its top edge
 * clear — a finger there covers the frame of the picture people are aiming at —
 * so images and video take the lane below instead, except while the box is
 * turned far enough (between 1.6 and 2.4 quarter turns) that "below" has swung
 * back up under the contextual toolbar. A narrow box puts the knob out to the
 * left, where it cannot cover what little width there is.
 */
function mobileRotateOffset(
  scale: SelectionScale,
  width: number,
  height: number,
  isMedia: boolean,
  rotation: number,
): Point {
  const { x: hx, y: hy } = scale.hitTarget;
  if (scale.isSmallX) {
    return { x: -hx * MOBILE_ROTATE_OFFSET, y: height / 2 };
  }
  const quarterTurns = clampRotation(rotation) / (Math.PI / 2);
  const nearToolbar = quarterTurns > 1.6 && quarterTurns < 2.4;
  return {
    x: width / 2,
    y:
      isMedia && !nearToolbar
        ? height + hy * MOBILE_ROTATE_OFFSET
        : -hy * MOBILE_ROTATE_OFFSET,
  };
}

/** Selection rotation on [0, 2pi), the interval the knob's lane test assumes. */
function clampRotation(rotation: number): number {
  const turn = Math.PI * 2;
  return ((rotation % turn) + turn) % turn;
}

/** Media reads top-edge-first, so its rotate knob moves out of that lane. */
function isMediaShape(shape: Shape | null): boolean {
  return shape?.type === 'image' || shape?.type === 'video';
}

/** Screen-constant, but never smaller than a fingertip at low zoom. */
function mobileRotateRadius(zoom: number): number {
  return Math.max(14 / zoom, 20 / Math.max(1, zoom));
}

/** The box's own axis-aligned frame: page space rotated about the origin. */
function alignedFrameBounds(
  corners: { nw: Point; ne: Point; se: Point; sw: Point },
  rotation: number,
): Bounds {
  const points = [corners.nw, corners.ne, corners.se, corners.sw];
  return pointsBounds(
    rotation ? points.map((p) => rotateFromOrigin(p, -rotation)) : points,
  );
}

function rotateFromOrigin(point: Point, angle: number): Point {
  if (!angle) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

export function getSelectionInfo(
  /** All page shapes. Only read for a single group selection, whose box derives
   *  from its descendants — every other path uses `ids` alone. */
  shapes: Shape[],
  ids: string[],
  zoom: number,
  /** O(1) id lookup. Callers that already index their shapes (tools via
   *  `editor.getShape`, layers via their selection record) should pass one:
   *  without it this scans the whole document on every call, which lands on the
   *  per-frame path during drags and pans. Selection order never matters here —
   *  the single-shape path takes `ids[0]` and the multi path unions bounds. */
  getShape?: (id: string) => Shape | undefined,
  /** Touch or pen without hover: bigger targets, one visible rotate knob. */
  coarsePointer = false,
): SelectionInfo | null {
  if (ids.length === 0) return null;
  const selected: Shape[] = [];
  if (getShape) {
    for (const id of ids) {
      const shape = getShape(id);
      if (shape) selected.push(shape);
    }
  } else {
    const idSet = new Set(ids);
    for (const shape of shapes) if (idSet.has(shape.id)) selected.push(shape);
  }
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
    // suppress the generic box. Frames use the same oriented box mechanics as
    // other rectangular shapes; their descendants are expanded by the select
    // tool so a frame rotation carries its whole subtree.
    const noHandles = shape.locked || isGroup;
    const customHandles = noHandles ? null : (util.getHandles?.(shape) ?? null);
    const scale = selectionScale(
      maxX - minX,
      maxY - minY,
      zoom,
      coarsePointer,
    );

    let handles: { id: ResizeHandleId; point: Point }[] = [];
    let rotationHandles: SelectionInfo['rotationHandles'] = [];
    let mobileRotateHandle: SelectionInfo['mobileRotateHandle'] = null;
    if (!noHandles && !customHandles) {
      // Text has two intentional resize gestures: corners scale typography;
      // horizontal side handles set a fixed wrap width. Vertical-only handles
      // would imply a height constraint the text model deliberately does not
      // have, so they are omitted.
      const resizeHandles =
        shape.type === 'text'
          ? (['nw', 'ne', 'e', 'se', 'sw', 'w'] as ResizeHandleId[])
          : RESIZE_HANDLES;
      handles = degradedHandles(resizeHandles, scale, coarsePointer).map(
        (id) => ({ id, point: handlePts[id] }),
      );
      // A corner zone on a tiny box would cover the corner handle it sits
      // beyond, so rotation gives way to resizing there.
      const canRotate = !scale.isTinyX && !scale.isTinyY;
      const d = cornerZoneExtent(zoom);
      if (canRotate && !coarsePointer) {
        rotationHandles = [
          { id: 'rotate-nw', point: rot(minX - d, minY - d), extent: d },
          { id: 'rotate-ne', point: rot(maxX + d, minY - d), extent: d },
          { id: 'rotate-se', point: rot(maxX + d, maxY + d), extent: d },
          { id: 'rotate-sw', point: rot(minX - d, maxY + d), extent: d },
        ];
      }
      // The knob replaces the corner zones on touch, and goes once the box is
      // small on both axes: at that size it would sit further from the shape
      // than the shape is wide.
      if (coarsePointer && !(scale.isSmallX && scale.isSmallY)) {
        const offset = mobileRotateOffset(
          scale,
          maxX - minX,
          maxY - minY,
          isMediaShape(shape),
          rotation,
        );
        mobileRotateHandle = {
          point: rot(minX + offset.x, minY + offset.y),
          radius: mobileRotateRadius(zoom),
        };
      }
    }

    return {
      ids: [shape.id],
      bounds,
      alignedBounds: alignedFrameBounds(corners, rotation),
      rotation,
      center,
      corners,
      handles,
      rotationHandles,
      mobileRotateHandle,
      hitTarget: scale.hitTarget,
      customHandles,
      isSingle: true,
    };
  }

  // Multi-selection: preserve a shared element orientation. Project every
  // rotated element corner into that aligned frame, find the tight AABB there,
  // then rotate the resulting controller back into page space.
  const rotation = sharedSelectionRotation(selected);
  const alignedPoints: Point[] = [];
  for (const shape of selected) {
    const shapeBounds = shapeControlBounds(shape, shapes);
    if (!shapeBounds) continue;
    const shapeCenter = boundsCenter(shapeBounds);
    for (const corner of boundsCorners(shapeBounds)) {
      const world =
        pageRotation(shape) !== 0
          ? rotatePoint(corner, shapeCenter, pageRotation(shape))
          : corner;
      alignedPoints.push(rotateFromOrigin(world, -rotation));
    }
  }
  if (alignedPoints.length === 0) return null;
  const alignedBounds = pointsBounds(alignedPoints);
  const { minX, minY, maxX, maxY } = alignedBounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const fromAligned = (x: number, y: number) =>
    rotateFromOrigin({ x, y }, rotation);
  const groupPts: Record<ResizeHandleId, Point> = {
    nw: fromAligned(minX, minY),
    n: fromAligned(midX, minY),
    ne: fromAligned(maxX, minY),
    e: fromAligned(maxX, midY),
    se: fromAligned(maxX, maxY),
    s: fromAligned(midX, maxY),
    sw: fromAligned(minX, maxY),
    w: fromAligned(minX, midY),
  };
  const corners = {
    nw: groupPts.nw,
    ne: groupPts.ne,
    se: groupPts.se,
    sw: groupPts.sw,
  };
  const bounds = pointsBounds(Object.values(corners));
  const center = fromAligned(midX, midY);
  const canRotateAll = selected.every(
    (shape) => !shape.locked && shape.type !== 'group',
  );
  const resizable = selected.some((shape) => !shape.locked);
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = selectionScale(width, height, zoom, coarsePointer);
  const showCornerRotate =
    canRotateAll && !coarsePointer && !scale.isTinyX && !scale.isTinyY;
  const showMobileRotate =
    canRotateAll && coarsePointer && !(scale.isSmallX && scale.isSmallY);
  // A multi-selection has no single shape to read as media, so its knob keeps
  // the default lane above the box.
  const knob = mobileRotateOffset(scale, width, height, false, rotation);
  const d = cornerZoneExtent(zoom);
  return {
    ids: selected.map((s) => s.id),
    bounds,
    alignedBounds,
    rotation,
    center,
    corners,
    handles: resizable
      ? degradedHandles(RESIZE_HANDLES, scale, coarsePointer).map((id) => ({
          id,
          point: groupPts[id],
        }))
      : [],
    rotationHandles: showCornerRotate
      ? [
          { id: 'rotate-nw', point: fromAligned(minX - d, minY - d), extent: d },
          { id: 'rotate-ne', point: fromAligned(maxX + d, minY - d), extent: d },
          { id: 'rotate-se', point: fromAligned(maxX + d, maxY + d), extent: d },
          { id: 'rotate-sw', point: fromAligned(minX - d, maxY + d), extent: d },
        ]
      : [],
    mobileRotateHandle: showMobileRotate
      ? {
          point: fromAligned(minX + knob.x, minY + knob.y),
          radius: mobileRotateRadius(zoom),
        }
      : null,
    hitTarget: scale.hitTarget,
    customHandles: null,
    isSingle: false,
  };
}

/**
 * Half-extents, in world units and along the box's own axes, of the area that
 * grabs `handle`. A corner is a square centred on it; an edge handle is the
 * band running the whole length of that edge, so a side can be grabbed
 * anywhere along it rather than only at its midpoint.
 */
export function selectionHandleExtent(
  info: SelectionInfo,
  handle: ResizeHandleId,
): Point {
  const { x: hx, y: hy } = info.hitTarget;
  if (handle.length === 2) {
    const corner = CORNER_HIT_FACTOR * Math.max(hx, hy);
    return { x: corner, y: corner };
  }
  const width = info.alignedBounds.maxX - info.alignedBounds.minX;
  const height = info.alignedBounds.maxY - info.alignedBounds.minY;
  return handle === 'n' || handle === 's'
    ? { x: width / 2, y: hy }
    : { x: hx, y: height / 2 };
}

/**
 * The resize handle under a world point, or null. Corners are tested before
 * edges so the stretch of band an edge shares with a corner does not steal it.
 */
export function hitSelectionHandle(
  info: SelectionInfo,
  point: Point,
): ResizeHandleId | null {
  const hits = (handle: { id: ResizeHandleId; point: Point }): boolean => {
    const local = rotateFromOrigin(
      { x: point.x - handle.point.x, y: point.y - handle.point.y },
      -info.rotation,
    );
    const extent = selectionHandleExtent(info, handle.id);
    return Math.abs(local.x) <= extent.x && Math.abs(local.y) <= extent.y;
  };
  for (const handle of info.handles) {
    if (handle.id.length === 2 && hits(handle)) return handle.id;
  }
  for (const handle of info.handles) {
    if (handle.id.length === 1 && hits(handle)) return handle.id;
  }
  return null;
}

/**
 * Tests a shape against the active marquee rule using the geometry it visibly
 * contributes to the canvas. Filled shapes are evaluated as regions; outlined
 * boxes and freehand/connector shapes are evaluated as stroked paths. Frames
 * are container-like and therefore always require full enclosure.
 */
export function matchesMarquee(
  shape: Shape,
  marquee: Bounds,
  mode: MarqueeMode,
): boolean {
  const geometry = marqueeGeometry(shape);
  if (!geometry) return false;
  return mode === 'wrap' || shape.type === 'frame'
    ? geometryIsContained(geometry, marquee)
    : geometryTouchesBounds(geometry, marquee);
}

/**
 * Whether a marquee reaches a shape-backed clipping mask. The current shape
 * model uses frames as masks, but keeping this geometry-based avoids assuming
 * they will always remain unrotated axis-aligned boxes.
 */
export function marqueeIntersectsMask(
  shape: Shape,
  marquee: Bounds,
  pointer: Point,
): boolean {
  const geometry = marqueeGeometry(shape);
  if (!geometry || geometry.kind !== 'region') return false;
  return (
    polygonTouchesBounds(geometry.outline, marquee) ||
    pointInPolygon(pointer, geometry.outline)
  );
}

function marqueeGeometry(shape: Shape): MarqueeGeometry | null {
  switch (shape.type) {
    case 'group':
      return null;
    case 'rectangle': {
      const outline = rotatedBoxOutline(shape);
      return shape.props.fillStyle === 'none'
        ? strokeGeometry(outline, shape.props.size / 2, true)
        : { kind: 'region', outline };
    }
    case 'ellipse': {
      const outline = ellipseOutline(shape);
      return shape.props.fillStyle === 'none'
        ? strokeGeometry(outline, shape.props.size / 2, true)
        : { kind: 'region', outline };
    }
    case 'polygon': {
      const local = normalizedPolygonPoints(shape.props.kind).map((p) => ({
        x: shape.x + p.x * shape.props.w,
        y: shape.y + p.y * shape.props.h,
      }));
      const outline = rotateOutline(shape, local, {
        x: shape.x + shape.props.w / 2,
        y: shape.y + shape.props.h / 2,
      });
      return shape.props.fillStyle === 'none'
        ? strokeGeometry(outline, shape.props.size / 2, true)
        : { kind: 'region', outline };
    }
    case 'line': {
      const points = localPointsToWorld(
        shape,
        curvePoints(
          shape.props.points,
          shape.props.bend ?? 0,
          shape.props.spline ?? 'linear',
        ),
      );
      return strokeGeometry(points, shape.props.size / 2, false);
    }
    case 'arrow': {
      const topology =
        shape.props.topology ??
        (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight');
      const curve = arrowPoints(
        shape.props.points,
        topology,
        shape.props.bend ?? 0,
      );
      const segments = outlineSegments(localPointsToWorld(shape, curve), false);
      if (shape.props.points.length >= 2) {
        const first = curve[0]!;
        const last = curve[curve.length - 1]!;
        if (shape.props.arrowStart) {
          segments.push(
            ...arrowHeadSegments(
              localPointToWorld(shape, tangentAnchor(curve, true)),
              localPointToWorld(shape, first),
              shape.props.size,
            ),
          );
        }
        if (shape.props.arrowEnd) {
          segments.push(
            ...arrowHeadSegments(
              localPointToWorld(shape, tangentAnchor(curve, false)),
              localPointToWorld(shape, last),
              shape.props.size,
            ),
          );
        }
      }
      return { kind: 'stroke', segments, radius: shape.props.size / 2 };
    }
    case 'draw': {
      const points = localPointsToWorld(shape, shape.props.points);
      return strokeGeometry(
        points,
        maxInkRadius(shape.props.size, shape.props),
        shape.props.isClosed,
      );
    }
    case 'text':
    case 'image':
    case 'sticker':
    case 'video':
    case 'bookmark':
    case 'graph':
    case 'equation':
    case 'frame':
      return { kind: 'region', outline: rotatedBoxOutline(shape) };
  }
}

function rotatedBoxOutline(shape: Exclude<Shape, { type: 'group' }>): Point[] {
  const util = shapeRegistry.getFor(shape);
  if (!util) return [];
  const bounds = util.getBounds(shape as never);
  return rotateOutline(shape, boxOutline(bounds), boundsCenter(bounds));
}

function ellipseOutline(shape: Extract<Shape, { type: 'ellipse' }>): Point[] {
  const cx = shape.x + shape.props.w / 2;
  const cy = shape.y + shape.props.h / 2;
  const points: Point[] = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    points.push({
      x: cx + (shape.props.w / 2) * Math.cos(theta),
      y: cy + (shape.props.h / 2) * Math.sin(theta),
    });
  }
  return rotateOutline(shape, points, { x: cx, y: cy });
}

/**
 * World-space pivot a polyline shape rotates about: the center of its local
 * point bounds. O(n) in the shape's point count (and it re-derives the curve for
 * connectors), so callers converting many points must compute it once rather
 * than per point — a 2000-point stroke made that the difference between a linear
 * and a quadratic marquee test.
 */
function polylineRotationCenter(
  shape: Extract<Shape, { type: 'line' | 'arrow' | 'draw' }>,
): Point {
  const points =
    shape.type === 'draw'
      ? shape.props.points
      : curvePoints(shape.props.points, shape.props.bend ?? 0);
  const localBounds = pointsBounds(points);
  return {
    x: shape.x + (localBounds.minX + localBounds.maxX) / 2,
    y: shape.y + (localBounds.minY + localBounds.maxY) / 2,
  };
}

function localPointsToWorld(
  shape: Extract<Shape, { type: 'line' | 'arrow' | 'draw' }>,
  points: readonly Point[],
): Point[] {
  if (!shape.rotation) {
    return points.map((point) => ({
      x: shape.x + point.x,
      y: shape.y + point.y,
    }));
  }
  const center = polylineRotationCenter(shape);
  return points.map((point) =>
    rotatePoint(
      { x: shape.x + point.x, y: shape.y + point.y },
      center,
      shape.rotation,
    ),
  );
}

function localPointToWorld(
  shape: Extract<Shape, { type: 'line' | 'arrow' | 'draw' }>,
  point: Point,
): Point {
  const world = { x: shape.x + point.x, y: shape.y + point.y };
  if (!shape.rotation) return world;
  return rotatePoint(world, polylineRotationCenter(shape), shape.rotation);
}

function rotateOutline(
  shape: Shape,
  points: readonly Point[],
  center: Point,
): Point[] {
  return shape.rotation
    ? points.map((point) => rotatePoint(point, center, shape.rotation))
    : [...points];
}

function strokeGeometry(
  points: readonly Point[],
  radius: number,
  closed: boolean,
): StrokeGeometry {
  return { kind: 'stroke', segments: outlineSegments(points, closed), radius };
}

function boxOutline(bounds: Bounds): Point[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function outlineSegments(points: readonly Point[], closed: boolean): Segment[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0]!, points[0]!]];
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    segments.push([points[i - 1]!, points[i]!]);
  }
  if (closed) segments.push([points[points.length - 1]!, points[0]!]);
  return segments;
}

function arrowHeadSegments(from: Point, to: Point, size: number): Segment[] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(8, size * 3.5);
  const spread = Math.PI / 7;
  const a = {
    x: to.x - length * Math.cos(angle - spread),
    y: to.y - length * Math.sin(angle - spread),
  };
  const b = {
    x: to.x - length * Math.cos(angle + spread),
    y: to.y - length * Math.sin(angle + spread),
  };
  return [
    [a, to],
    [to, b],
  ];
}

function geometryIsContained(
  geometry: MarqueeGeometry,
  bounds: Bounds,
): boolean {
  if (geometry.kind === 'region') {
    return (
      geometry.outline.length > 0 &&
      geometry.outline.every((point) => boundsContainsPoint(bounds, point))
    );
  }
  const inset = {
    minX: bounds.minX + geometry.radius,
    minY: bounds.minY + geometry.radius,
    maxX: bounds.maxX - geometry.radius,
    maxY: bounds.maxY - geometry.radius,
  };
  return (
    inset.minX <= inset.maxX &&
    inset.minY <= inset.maxY &&
    geometry.segments.length > 0 &&
    geometry.segments.every(
      ([a, b]) =>
        boundsContainsPoint(inset, a) && boundsContainsPoint(inset, b),
    )
  );
}

function geometryTouchesBounds(
  geometry: MarqueeGeometry,
  bounds: Bounds,
): boolean {
  if (geometry.kind === 'region')
    return polygonTouchesBounds(geometry.outline, bounds);
  // The marquee's own edges are the same for every segment; a freehand stroke
  // has one segment per point, so rebuilding them inside the loop allocated
  // 8 objects per point on each drag frame.
  const marqueeEdges = outlineSegments(boxOutline(bounds), true);
  return geometry.segments.some((segment) =>
    strokeTouchesBounds(segment, geometry.radius, bounds, marqueeEdges),
  );
}

function polygonTouchesBounds(
  polygon: readonly Point[],
  bounds: Bounds,
): boolean {
  if (polygon.length === 0) return false;
  if (polygon.some((point) => boundsContainsPoint(bounds, point))) return true;
  const corners = boxOutline(bounds);
  if (corners.some((corner) => pointInPolygon(corner, polygon))) return true;
  const polygonEdges = outlineSegments(polygon, true);
  const rectEdges = outlineSegments(corners, true);
  return polygonEdges.some(([a, b]) =>
    rectEdges.some(([c, d]) => segmentsIntersect(a, b, c, d)),
  );
}

function strokeTouchesBounds(
  segment: Segment,
  radius: number,
  bounds: Bounds,
  /** `bounds`' own edges, hoisted by the caller (see `geometryTouchesBounds`). */
  edges: Segment[],
): boolean {
  const [a, b] = segment;
  if (boundsContainsPoint(bounds, a) || boundsContainsPoint(bounds, b))
    return true;
  return edges.some(([c, d]) => segmentToSegmentDistance(a, b, c, d) <= radius);
}
