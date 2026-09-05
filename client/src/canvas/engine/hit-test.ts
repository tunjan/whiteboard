import { pointInPolygon, type Shape, type Point } from '@whiteboard/shared';
import {
  frameContainsPoint,
  frameHeadingLayout,
  pagePointToFrame,
} from '../frame-geometry';
import { shapeRegistry } from '../shapes/shape-registry';
import type { SpatialIndex } from '../spatial-index';
import { paintOrder } from './paint-order';

const cache = new WeakMap<
  readonly Shape[],
  {
    byId: Map<string, Shape>;
    rank: Map<string, number>;
    frames: Extract<Shape, { type: 'frame' }>[];
  }
>();

/** Shared picking pipeline for selection, double-click, and context menus. */
export function hitTestCanvas(
  shapes: readonly Shape[],
  index: SpatialIndex,
  point: Point,
  margin: number,
  options: {
    zoom: number;
    isEligible: (shape: Shape) => boolean;
    isHidden?: (id: string) => boolean;
  },
): Shape | null {
  let scene = cache.get(shapes);
  if (!scene) {
    const byId = new Map(shapes.map((s) => [s.id, s]));
    scene = {
      byId,
      rank: new Map(paintOrder(byId).map((shape, rank) => [shape.id, rank])),
      frames: shapes.filter(
        (s): s is Extract<Shape, { type: 'frame' }> => s.type === 'frame',
      ),
    };
    cache.set(shapes, scene);
  }
  const candidates = new Set(
    index.search({
      minX: point.x - margin,
      minY: point.y - margin,
      maxX: point.x + margin,
      maxY: point.y + margin,
    }),
  );
  // Labels live outside model bounds and retain a fixed screen size.
  const headings = new Set(
    scene.frames
      .filter((s) =>
        pointInPolygon(point, frameHeadingLayout(s, options.zoom).corners),
      )
      .map((s) => s.id),
  );
  for (const id of headings) candidates.add(id);
  let emptyFrame: Shape | null = null;
  const orderedCandidates = [...candidates]
    .map((id) => scene.byId.get(id))
    .filter((shape): shape is Shape => !!shape)
    .sort((a, b) => scene.rank.get(b.id)! - scene.rank.get(a.id)!);
  for (const shape of orderedCandidates) {
    if (!options.isEligible(shape) || shape.hidden) continue;
    const seen = new Set([shape.id]);
    let parentId = shape.parentId,
      clipped = false;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = scene.byId.get(parentId);
      if (!parent) break;
      if (
        parent.hidden ||
        options.isHidden?.(parent.id) ||
        (shape.type !== 'arrow' &&
          parent.type === 'frame' &&
          !frameContainsPoint(parent, point))
      ) {
        clipped = true;
        break;
      }
      parentId = parent.parentId;
    }
    if (clipped) continue;
    if (headings.has(shape.id)) return shape;
    if (!shapeRegistry.getFor(shape)?.hitTest(shape, point, margin)) continue;
    if (shape.type === 'frame') {
      const p = pagePointToFrame(shape, point);
      const edge = Math.min(
        Math.abs(p.x),
        Math.abs(p.y),
        Math.abs(p.x - shape.props.w),
        Math.abs(p.y - shape.props.h),
      );
      if (edge <= margin + 0.625 / options.zoom) return shape;
      // Empty frames remain selectable, but their interior yields to geometry.
      emptyFrame ??= shape;
      continue;
    }
    return shape;
  }
  return emptyFrame;
}
