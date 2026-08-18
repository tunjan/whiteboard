import {
  type Bounds,
  type Shape,
  boundsCenter,
  rotatePoint,
  unionBounds,
} from '@whiteboard/shared';
import { shapeRegistry } from './shapes/shape-registry';

/** Rotated world AABB of one shape (its bounds rotated about its center). */
export function shapeRotatedBounds(shape: Shape): Bounds {
  const util = shapeRegistry.getFor(shape);
  if (!util)
    return { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y };
  const raw = util.getBounds(shape);
  // Registry bounds describe the model geometry. Expand the box-like outlines
  // here so the spatial index remains a conservative broad phase for the
  // pixels that users can actually select at the edge of a stroke.
  const strokeRadius =
    shape.type === 'rectangle' ||
    shape.type === 'ellipse' ||
    shape.type === 'polygon'
      ? shape.props.size / 2
      : 0;
  const b = {
    minX: raw.minX - strokeRadius,
    // Frame headings are view-adaptive labels, explicitly excluded from model
    // bounds so they never distort snapping, alignment, culling or export.
    minY: raw.minY - strokeRadius,
    maxX: raw.maxX + strokeRadius,
    maxY: raw.maxY + strokeRadius,
  };
  if (!shape.rotation) return b;
  const c = boundsCenter(b);
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => rotatePoint(p, c, shape.rotation));
  let acc: Bounds = {
    minX: corners[0]!.x,
    minY: corners[0]!.y,
    maxX: corners[0]!.x,
    maxY: corners[0]!.y,
  };
  for (const p of corners) {
    acc = unionBounds(acc, { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
  }
  return acc;
}
