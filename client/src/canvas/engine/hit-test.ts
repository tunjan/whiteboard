import { pointInPolygon, type Shape, type Point } from '@whiteboard/shared';
import {
  frameContainsPoint,
  frameHeadingLayout,
  pagePointToFrame,
} from '../frame-geometry';
import { shapeRegistry } from '../shapes/shape-registry';
import type { SpatialIndex } from '../spatial-index';
import { paintOrder } from './paint-order';

interface PickScene {
  byId: Map<string, Shape>;
  rank: Map<string, number>;
  frames: Extract<Shape, { type: 'frame' }>[];
}

const cache = new WeakMap<readonly Shape[], PickScene>();

// The snapshot array's identity changes on every edit, so an identity-keyed
// cache alone rebuilds both maps and the paint order on the first pick after
// any edit — and the hover indicator picks on every pointer move, so a peer
// drawing is enough to pay that per frame. Ordinary edits (a move, a recolour,
// a growing stroke) leave paint order alone, so the array that built the cache
// is kept to diff the next one against: when only records changed, the ranks
// carry over and `byId` is patched in place.
let cachedFor: readonly Shape[] | null = null;

const isFrame = (s: Shape): s is Extract<Shape, { type: 'frame' }> =>
  s.type === 'frame';

function buildScene(shapes: readonly Shape[]): PickScene {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  return {
    byId,
    rank: new Map(paintOrder(byId).map((shape, rank) => [shape.id, rank])),
    frames: shapes.filter(isFrame),
  };
}

/** Carry `scene` onto `next`, or null when paint order could have moved. */
function patchScene(
  scene: PickScene,
  previous: readonly Shape[],
  next: readonly Shape[],
): PickScene | null {
  if (previous.length !== next.length) return null;
  const changed: Shape[] = [];
  for (let i = 0; i < next.length; i++) {
    const before = previous[i]!,
      after = next[i]!;
    if (before === after) continue;
    // Paint order reads exactly these three fields; membership is pinned by
    // the ids matching position for position.
    if (
      before.id !== after.id ||
      before.index !== after.index ||
      before.parentId !== after.parentId ||
      before.type !== after.type
    )
      return null;
    changed.push(after);
  }
  for (const shape of changed) {
    scene.byId.set(shape.id, shape);
    if (isFrame(shape)) {
      const at = scene.frames.findIndex((f) => f.id === shape.id);
      if (at >= 0) scene.frames[at] = shape;
    }
  }
  return scene;
}

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
    const last = cachedFor && cache.get(cachedFor);
    const patched = last && patchScene(last, cachedFor!, shapes);
    // A patched scene is mutated in place, so the array it was built for must
    // stop naming it; a fresh build leaves that entry correct and cached.
    if (patched) cache.delete(cachedFor!);
    scene = patched || buildScene(shapes);
    cache.set(shapes, scene);
    cachedFor = shapes;
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
