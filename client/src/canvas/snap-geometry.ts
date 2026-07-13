import {
  type Point,
  type Shape,
  boundsCenter,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import type { PointSnapTarget } from './snapping';
import { curvePoints } from './shapes/line-geometry';
import { normalizedPolygonPoints } from './shapes/polygon-geometry';
import { shapeRegistry } from './shapes/shape-registry';

function rotate(points: Point[], center: Point, angle: number): Point[] {
  return angle ? points.map((point) => rotatePoint(point, center, angle)) : points;
}

function boxTarget(shape: Shape): PointSnapTarget | null {
  const util = shapeRegistry.getFor(shape);
  if (!util) return null;
  const bounds = util.getBounds(shape as never);
  const center = boundsCenter(bounds);
  const midX = center.x;
  const midY = center.y;
  const rawOutline = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  const outline = rotate(rawOutline, center, shape.rotation);
  const points = rotate(
    [
      ...rawOutline,
      { x: midX, y: bounds.minY },
      { x: bounds.maxX, y: midY },
      { x: midX, y: bounds.maxY },
      { x: bounds.minX, y: midY },
      center,
    ],
    center,
    shape.rotation,
  );
  return { points, outline, closed: true };
}

function ellipseTarget(shape: Extract<Shape, { type: 'ellipse' }>): PointSnapTarget {
  const center = {
    x: shape.x + shape.props.w / 2,
    y: shape.y + shape.props.h / 2,
  };
  const outline: Point[] = [];
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    outline.push({
      x: center.x + Math.cos(angle) * shape.props.w / 2,
      y: center.y + Math.sin(angle) * shape.props.h / 2,
    });
  }
  const rotated = rotate(outline, center, shape.rotation);
  return {
    outline: rotated,
    closed: true,
    points: [rotated[0]!, rotated[16]!, rotated[32]!, rotated[48]!, center],
  };
}

function polygonTarget(shape: Extract<Shape, { type: 'polygon' }>): PointSnapTarget {
  const center = {
    x: shape.x + shape.props.w / 2,
    y: shape.y + shape.props.h / 2,
  };
  const outline = rotate(
    normalizedPolygonPoints(shape.props.kind).map((point) => ({
      x: shape.x + point.x * shape.props.w,
      y: shape.y + point.y * shape.props.h,
    })),
    center,
    shape.rotation,
  );
  return { outline, closed: true, points: [...outline, center] };
}

function connectorTarget(
  shape: Extract<Shape, { type: 'line' | 'arrow' }>,
): PointSnapTarget {
  const local = curvePoints(shape.props.points, shape.props.bend ?? 0);
  const bounds = pointsBounds(local);
  const center = {
    x: shape.x + (bounds.minX + bounds.maxX) / 2,
    y: shape.y + (bounds.minY + bounds.maxY) / 2,
  };
  const outline = rotate(
    local.map((point) => ({ x: shape.x + point.x, y: shape.y + point.y })),
    center,
    shape.rotation,
  );
  const points = outline.length > 1
    ? [outline[0]!, outline[outline.length - 1]!]
    : [...outline];
  return { outline, points, closed: false };
}

/** Geometry exposed by a shape when it can be a snap target. */
export function shapeSnapGeometry(shape: Shape): PointSnapTarget | null {
  const util = shapeRegistry.getFor(shape);
  if (!util || util.canSnap === false || shape.type === 'group') return null;
  switch (shape.type) {
    case 'draw':
      return null;
    case 'ellipse':
      return ellipseTarget(shape);
    case 'polygon':
      return polygonTarget(shape);
    case 'line':
    case 'arrow':
      return connectorTarget(shape);
    case 'rectangle':
    case 'text':
    case 'image':
    case 'video':
    case 'graph':
    case 'frame':
      return boxTarget(shape);
  }
}
