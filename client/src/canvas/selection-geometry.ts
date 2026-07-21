import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  boundsContainsPoint,
  distanceToSegment,
  pointInPolygon,
  pointsBounds,
  rotatePoint,
  unionBounds,
} from '@whiteboard/shared';
import { containerBounds } from './hierarchy';
import { shapeRotatedBounds } from './shape-bounds';
import { curvePoints, tangentAnchor } from './shapes/line-geometry';
import { normalizedPolygonPoints } from './shapes/polygon-geometry';
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
export type CornerHandleId = Extract<
  ResizeHandleId,
  'nw' | 'ne' | 'se' | 'sw'
>;
export type RotationHandleId = `rotate-${CornerHandleId}`;
export type MarqueeMode = 'contain' | 'touch';

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

/** Screen-px inset beyond each edge for the invisible corner rotation zones. */
const ROTATE_CORNER_OFFSET = 18;
/** Screen-px radius of each corner rotation hit zone. */
export const ROTATION_HANDLE_HIT_SCREEN = 14;

export interface SelectionInfo {
  ids: string[];
  /** Unrotated world AABB (single: the shape's bounds; multi: union of rotated AABBs). */
  bounds: Bounds;
  /** Single-shape rotation; 0 for multi-selection. */
  rotation: number;
  center: Point;
  /** Oriented corners (rotated for single), world. */
  corners: { nw: Point; ne: Point; se: Point; sw: Point };
  /** Generic resize handles; empty when the shape exposes custom handles. */
  handles: { id: ResizeHandleId; point: Point }[];
  /** Invisible FigJam-style rotation targets just beyond each corner. */
  rotationHandles: { id: RotationHandleId; point: Point }[];
  /** Shape-specific handles (e.g. connector endpoints/bend); null otherwise. */
  customHandles: ShapeHandle[] | null;
  isSingle: boolean;
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
    // suppress the generic box. Frames resize but don't rotate.
    const noHandles = shape.locked || isGroup;
    const customHandles = noHandles ? null : util.getHandles?.(shape) ?? null;

    let handles: { id: ResizeHandleId; point: Point }[] = [];
    let rotationHandles: SelectionInfo['rotationHandles'] = [];
    if (!noHandles && !customHandles) {
      // Text has two intentional resize gestures: corners scale typography;
      // horizontal side handles set a fixed wrap width. Vertical-only handles
      // would imply a height constraint the text model deliberately does not
      // have, so they are omitted.
      const resizeHandles =
        shape.type === 'text'
          ? (['nw', 'ne', 'e', 'se', 'sw', 'w'] as ResizeHandleId[])
          : RESIZE_HANDLES;
      handles = resizeHandles.map((id) => ({ id, point: handlePts[id] }));
      if (shape.type !== 'frame') {
        const d = ROTATE_CORNER_OFFSET / zoom;
        rotationHandles = [
          { id: 'rotate-nw', point: rot(minX - d, minY - d) },
          { id: 'rotate-ne', point: rot(maxX + d, minY - d) },
          { id: 'rotate-se', point: rot(maxX + d, maxY + d) },
          { id: 'rotate-sw', point: rot(minX - d, maxY + d) },
        ];
      }
    }

    return {
      ids: [shape.id],
      bounds,
      rotation,
      center,
      corners,
      handles,
      rotationHandles,
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
    rotationHandles: [],
    customHandles: null,
    isSingle: false,
  };
}

/**
 * Tests a shape against a directional marquee using the geometry it visibly
 * contributes to the canvas. Filled shapes are evaluated as regions; outlined
 * boxes and freehand/connector shapes are evaluated as stroked paths.
 */
export function matchesMarquee(
  shape: Shape,
  marquee: Bounds,
  mode: MarqueeMode,
): boolean {
  const geometry = marqueeGeometry(shape);
  if (!geometry) return false;
  return mode === 'contain'
    ? geometryIsContained(geometry, marquee)
    : geometryTouchesBounds(geometry, marquee);
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
        curvePoints(shape.props.points, shape.props.bend ?? 0),
      );
      return strokeGeometry(points, shape.props.size / 2, false);
    }
    case 'arrow': {
      const curve = curvePoints(shape.props.points, shape.props.bend ?? 0);
      const segments = outlineSegments(localPointsToWorld(shape, curve), false);
      if (shape.props.points.length >= 2) {
        const first = shape.props.points[0]!;
        const last = shape.props.points[shape.props.points.length - 1]!;
        if (shape.props.arrowStart) {
          segments.push(
            ...arrowHeadSegments(
              localPointToWorld(shape, tangentAnchor(shape.props.points, shape.props.bend ?? 0, true)),
              localPointToWorld(shape, first),
              shape.props.size,
            ),
          );
        }
        if (shape.props.arrowEnd) {
          segments.push(
            ...arrowHeadSegments(
              localPointToWorld(shape, tangentAnchor(shape.props.points, shape.props.bend ?? 0, false)),
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
      const radius =
        shape.props.thinning !== undefined && shape.props.thinning < 0
          ? shape.props.size
          : shape.props.size / 2;
      return strokeGeometry(points, radius, shape.props.isClosed);
    }
    case 'text':
    case 'image':
    case 'video':
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

function localPointsToWorld(
  shape: Extract<Shape, { type: 'line' | 'arrow' | 'draw' }>,
  points: readonly Point[],
): Point[] {
  return points.map((point) => localPointToWorld(shape, point));
}

function localPointToWorld(
  shape: Extract<Shape, { type: 'line' | 'arrow' | 'draw' }>,
  point: Point,
): Point {
  const points =
    shape.type === 'draw'
      ? shape.props.points
      : curvePoints(shape.props.points, shape.props.bend ?? 0);
  const localBounds = pointsBounds(points);
  const world = { x: shape.x + point.x, y: shape.y + point.y };
  if (!shape.rotation) return world;
  return rotatePoint(
    world,
    {
      x: shape.x + (localBounds.minX + localBounds.maxX) / 2,
      y: shape.y + (localBounds.minY + localBounds.maxY) / 2,
    },
    shape.rotation,
  );
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
  return [[a, to], [to, b]];
}

function geometryIsContained(geometry: MarqueeGeometry, bounds: Bounds): boolean {
  if (geometry.kind === 'region') {
    return geometry.outline.length > 0 && geometry.outline.every((point) => boundsContainsPoint(bounds, point));
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
    geometry.segments.every(([a, b]) =>
      boundsContainsPoint(inset, a) && boundsContainsPoint(inset, b),
    )
  );
}

function geometryTouchesBounds(geometry: MarqueeGeometry, bounds: Bounds): boolean {
  if (geometry.kind === 'region') return polygonTouchesBounds(geometry.outline, bounds);
  return geometry.segments.some((segment) => strokeTouchesBounds(segment, geometry.radius, bounds));
}

function polygonTouchesBounds(polygon: readonly Point[], bounds: Bounds): boolean {
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

function strokeTouchesBounds(segment: Segment, radius: number, bounds: Bounds): boolean {
  const [a, b] = segment;
  if (boundsContainsPoint(bounds, a) || boundsContainsPoint(bounds, b)) return true;
  const edges = outlineSegments(boxOutline(bounds), true);
  return edges.some(([c, d]) => segmentDistance(a, b, c, d) <= radius);
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = cross(a, b, c);
  const ac = cross(a, b, d);
  const cd = cross(c, d, a);
  const ce = cross(c, d, b);
  if ((ab > 0) !== (ac > 0) && (cd > 0) !== (ce > 0)) return true;
  return (
    (Math.abs(ab) < 1e-8 && pointOnSegment(c, a, b)) ||
    (Math.abs(ac) < 1e-8 && pointOnSegment(d, a, b)) ||
    (Math.abs(cd) < 1e-8 && pointOnSegment(a, c, d)) ||
    (Math.abs(ce) < 1e-8 && pointOnSegment(b, c, d))
  );
}

function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  return (
    point.x >= Math.min(a.x, b.x) - 1e-8 &&
    point.x <= Math.max(a.x, b.x) + 1e-8 &&
    point.y >= Math.min(a.y, b.y) - 1e-8 &&
    point.y <= Math.max(a.y, b.y) + 1e-8
  );
}
