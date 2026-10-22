import {
  type ArrowShape,
  type Bounds,
  type ConnectorBinding,
  type LineShape,
  type Point,
  type Shape,
  type Vec,
  boundsCenter,
  closestPointOnSegment,
  distance,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import type { Editor } from '../editor';
import { findClosestCommonContainer } from '../hierarchy';
import { jitterKeyBetween } from '../order';
import { shapeRotatedBounds } from '../shape-bounds';
import { unrotatedPoint } from './box-geometry';
import { shapeRegistry } from './shape-registry';
import { shapeSnapGeometry } from '../snap-geometry';

const ROUTE_MARGIN = 20;
const EPSILON = 1e-5;

export function isBindableShape(shape: Shape): boolean {
  return (
    shape.type !== 'arrow' &&
    shape.type !== 'line' &&
    shape.type !== 'draw' &&
    shape.type !== 'group'
  );
}

function segmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): Point | null {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < EPSILON) return null;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const t = (acx * cdy - acy * cdx) / denominator;
  const u = (acx * aby - acy * abx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) {
    return null;
  }
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/** Project a candidate terminal to the visible perimeter along the incoming ray. */
export function projectToShapeBoundary(
  target: Shape,
  candidate: Point,
  from: Point,
): Point {
  const geometry = shapeSnapGeometry(target);
  if (!geometry?.closed || geometry.outline.length < 2) return candidate;
  const intersections: Point[] = [];
  for (let i = 0; i < geometry.outline.length; i++) {
    const a = geometry.outline[i]!;
    const b = geometry.outline[(i + 1) % geometry.outline.length]!;
    const intersection = segmentIntersection(from, candidate, a, b);
    if (intersection) intersections.push(intersection);
  }
  if (intersections.length) {
    intersections.sort((a, b) => distance(from, a) - distance(from, b));
    return intersections[0]!;
  }

  let closest = geometry.outline[0]!;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < geometry.outline.length; i++) {
    const a = geometry.outline[i]!;
    const b = geometry.outline[(i + 1) % geometry.outline.length]!;
    const point = closestPointOnSegment(candidate, a, b);
    const d = distance(candidate, point);
    if (d < best) {
      best = d;
      closest = point;
    }
  }
  return closest;
}

/** Normalized, rotation-independent surface binding for a world point. */
export function bindingForPoint(
  target: Shape,
  candidate: Point,
  from: Point,
): { binding: ConnectorBinding; point: Point } | null {
  if (!isBindableShape(target)) return null;
  const util = shapeRegistry.getFor(target);
  if (!util) return null;
  const bounds = util.getBounds(target as never);
  const center = boundsCenter(bounds);
  const point = projectToShapeBoundary(target, candidate, from);
  const unrotated = target.rotation
    ? rotatePoint(point, center, -target.rotation)
    : point;
  const width = Math.max(EPSILON, bounds.maxX - bounds.minX);
  const height = Math.max(EPSILON, bounds.maxY - bounds.minY);
  return {
    binding: {
      shapeId: target.id,
      anchor: {
        x: Math.max(
          0.001,
          Math.min(0.999, (unrotated.x - bounds.minX) / width),
        ),
        y: Math.max(
          0.001,
          Math.min(0.999, (unrotated.y - bounds.minY) / height),
        ),
      },
    },
    point,
  };
}

/** Resolve a normalized binding after its target moves, rotates, or resizes. */
export function pointForBinding(
  binding: ConnectorBinding,
  target: Shape,
): Point | null {
  const util = shapeRegistry.getFor(target);
  if (!util || !isBindableShape(target)) return null;
  const bounds = util.getBounds(target as never);
  const center = boundsCenter(bounds);
  const point = {
    x: bounds.minX + binding.anchor.x * (bounds.maxX - bounds.minX),
    y: bounds.minY + binding.anchor.y * (bounds.maxY - bounds.minY),
  };
  return target.rotation ? rotatePoint(point, center, target.rotation) : point;
}

/** Topmost bindable target containing or near a pointer. */
export function findBindableShapeAt(
  shapes: readonly Shape[],
  point: Point,
  tolerance: number,
  excludeId?: string,
): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (shape.id === excludeId || shape.hidden || !isBindableShape(shape))
      continue;
    // A frame is a region, not an object: its empty interior is where arrows
    // are drawn, so only its border binds.
    if (shape.type === 'frame') {
      const local = unrotatedPoint(
        shape.x,
        shape.y,
        shape.props.w,
        shape.props.h,
        shape.rotation,
        point,
      );
      if (
        local.x > shape.x + tolerance &&
        local.x < shape.x + shape.props.w - tolerance &&
        local.y > shape.y + tolerance &&
        local.y < shape.y + shape.props.h - tolerance
      ) {
        continue;
      }
    }
    if (
      shapeRegistry.getFor(shape)?.hitTest(shape as never, point, tolerance)
    ) {
      return shape;
    }
  }
  return null;
}

type Cardinal = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export function bindingDirection(binding: ConnectorBinding): Cardinal {
  const distances = [
    { value: binding.anchor.x, direction: { x: -1, y: 0 } as Cardinal },
    { value: 1 - binding.anchor.x, direction: { x: 1, y: 0 } as Cardinal },
    { value: binding.anchor.y, direction: { x: 0, y: -1 } as Cardinal },
    { value: 1 - binding.anchor.y, direction: { x: 0, y: 1 } as Cardinal },
  ];
  distances.sort((a, b) => a.value - b.value);
  return distances[0]!.direction;
}

/**
 * {@link bindingDirection} is in the target's unrotated box; an elbow route is
 * orthogonal in the connector's own frame. Turn by the difference and take the
 * nearest axis.
 */
function directionInConnector(
  binding: ConnectorBinding,
  target: Shape,
  connector: ConnectorShape,
): Cardinal {
  const direction = bindingDirection(binding);
  const angle = (target.rotation ?? 0) - (connector.rotation ?? 0);
  if (!angle) return direction;
  const turned = rotatePoint(direction, { x: 0, y: 0 }, angle);
  return Math.abs(turned.x) >= Math.abs(turned.y)
    ? { x: turned.x < 0 ? -1 : 1, y: 0 }
    : { x: 0, y: turned.y < 0 ? -1 : 1 };
}

function inflate(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

function pointInside(bounds: Bounds, point: Point): boolean {
  return (
    point.x > bounds.minX + EPSILON &&
    point.x < bounds.maxX - EPSILON &&
    point.y > bounds.minY + EPSILON &&
    point.y < bounds.maxY - EPSILON
  );
}

function segmentBlocked(
  a: Point,
  b: Point,
  obstacles: readonly Bounds[],
): boolean {
  for (const obstacle of obstacles) {
    if (Math.abs(a.x - b.x) < EPSILON) {
      if (
        a.x > obstacle.minX + EPSILON &&
        a.x < obstacle.maxX - EPSILON &&
        Math.max(Math.min(a.y, b.y), obstacle.minY) <
          Math.min(Math.max(a.y, b.y), obstacle.maxY) - EPSILON
      ) {
        return true;
      }
    } else if (
      Math.abs(a.y - b.y) < EPSILON &&
      a.y > obstacle.minY + EPSILON &&
      a.y < obstacle.maxY - EPSILON &&
      Math.max(Math.min(a.x, b.x), obstacle.minX) <
        Math.min(Math.max(a.x, b.x), obstacle.maxX) - EPSILON
    ) {
      return true;
    }
  }
  return false;
}

function simplifyRoute(points: readonly Vec[]): Vec[] {
  const deduped = points.filter(
    (point, index) =>
      index === 0 || distance(point, points[index - 1]!) > EPSILON,
  );
  const out: Vec[] = [];
  for (const point of deduped) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (
      a &&
      b &&
      ((Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - point.x) < EPSILON) ||
        (Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - point.y) < EPSILON))
    ) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

interface SearchState {
  node: number;
  direction: 'h' | 'v' | 'none';
  cost: number;
  previous: string | null;
}

/** Obstacle-aware Manhattan route with a strong cost for every extra turn. */
export function orthogonalRoute(
  start: Vec,
  end: Vec,
  options: {
    startBounds?: Bounds;
    endBounds?: Bounds;
    startDirection?: Cardinal;
    endDirection?: Cardinal;
  } = {},
): Vec[] {
  if (!options.startBounds && !options.endBounds) {
    if (
      Math.abs(start.x - end.x) < EPSILON ||
      Math.abs(start.y - end.y) < EPSILON
    ) {
      return [start, end];
    }
    return simplifyRoute([
      start,
      { x: (start.x + end.x) / 2, y: start.y },
      { x: (start.x + end.x) / 2, y: end.y },
      end,
    ]);
  }

  const startDirection = options.startDirection ?? { x: 0, y: 0 };
  const endDirection = options.endDirection ?? { x: 0, y: 0 };
  const startStub = {
    x: start.x + startDirection.x * (ROUTE_MARGIN + 2),
    y: start.y + startDirection.y * (ROUTE_MARGIN + 2),
  };
  const endStub = {
    x: end.x + endDirection.x * (ROUTE_MARGIN + 2),
    y: end.y + endDirection.y * (ROUTE_MARGIN + 2),
  };
  const obstacles = [options.startBounds, options.endBounds]
    .filter((bounds): bounds is Bounds => Boolean(bounds))
    .map((bounds) => inflate(bounds, ROUTE_MARGIN));
  const xs = new Set<number>([
    startStub.x,
    endStub.x,
    (startStub.x + endStub.x) / 2,
  ]);
  const ys = new Set<number>([
    startStub.y,
    endStub.y,
    (startStub.y + endStub.y) / 2,
  ]);
  for (const bounds of obstacles) {
    xs.add(bounds.minX);
    xs.add(bounds.maxX);
    ys.add(bounds.minY);
    ys.add(bounds.maxY);
  }
  const xValues = [...xs].sort((a, b) => a - b);
  const yValues = [...ys].sort((a, b) => a - b);
  const nodes: Vec[] = [];
  for (const y of yValues) {
    for (const x of xValues) {
      const point = { x, y };
      if (
        !obstacles.some((bounds) => pointInside(bounds, point)) ||
        distance(point, startStub) < EPSILON ||
        distance(point, endStub) < EPSILON
      ) {
        nodes.push(point);
      }
    }
  }
  const nodeIndex = (point: Vec) =>
    nodes.findIndex((candidate) => distance(candidate, point) < EPSILON);
  const startIndex = nodeIndex(startStub);
  const endIndex = nodeIndex(endStub);
  if (startIndex < 0 || endIndex < 0) {
    return simplifyRoute([
      start,
      startStub,
      { x: endStub.x, y: startStub.y },
      endStub,
      end,
    ]);
  }

  const neighbors = nodes.map(
    () => [] as Array<{ node: number; direction: 'h' | 'v'; length: number }>,
  );
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const direction =
        Math.abs(a.y - b.y) < EPSILON
          ? 'h'
          : Math.abs(a.x - b.x) < EPSILON
            ? 'v'
            : null;
      if (!direction || segmentBlocked(a, b, obstacles)) continue;
      const length = distance(a, b);
      neighbors[i]!.push({ node: j, direction, length });
      neighbors[j]!.push({ node: i, direction, length });
    }
  }

  const key = (node: number, direction: SearchState['direction']) =>
    `${node}:${direction}`;
  const queue: SearchState[] = [
    { node: startIndex, direction: 'none', cost: 0, previous: null },
  ];
  const best = new Map<string, SearchState>();
  best.set(key(startIndex, 'none'), queue[0]!);
  let winner: SearchState | null = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    if (best.get(key(current.node, current.direction))?.cost !== current.cost)
      continue;
    if (current.node === endIndex) {
      winner = current;
      break;
    }
    for (const edge of neighbors[current.node]!) {
      const bendPenalty =
        current.direction !== 'none' && current.direction !== edge.direction
          ? 80
          : 0;
      const next: SearchState = {
        node: edge.node,
        direction: edge.direction,
        cost: current.cost + edge.length + bendPenalty,
        previous: key(current.node, current.direction),
      };
      const nextKey = key(next.node, next.direction);
      if ((best.get(nextKey)?.cost ?? Number.POSITIVE_INFINITY) <= next.cost)
        continue;
      best.set(nextKey, next);
      queue.push(next);
    }
  }
  if (!winner) {
    return simplifyRoute([
      start,
      startStub,
      { x: endStub.x, y: startStub.y },
      endStub,
      end,
    ]);
  }
  const middle: Vec[] = [];
  let cursor: SearchState | undefined = winner;
  while (cursor) {
    middle.push(nodes[cursor.node]!);
    cursor = cursor.previous ? best.get(cursor.previous) : undefined;
  }
  middle.reverse();
  return simplifyRoute([start, startStub, ...middle, endStub, end]);
}

type ConnectorShape = ArrowShape | LineShape;

/**
 * The point a connector rotates about: the centre of its drawn body, which is
 * what the renderer and hit test use. For an arc that is not the centre of the
 * two control points.
 */
function connectorCenter(shape: ConnectorShape): Point {
  return boundsCenter(shapeRegistry.getFor(shape)!.getBounds(shape as never));
}

export function connectorLocalToWorld(shape: ConnectorShape, point: Vec): Point {
  const world = { x: shape.x + point.x, y: shape.y + point.y };
  return shape.rotation
    ? rotatePoint(world, connectorCenter(shape), shape.rotation)
    : world;
}

export function connectorWorldToLocal(shape: ConnectorShape, point: Point): Vec {
  const world = shape.rotation
    ? rotatePoint(point, connectorCenter(shape), -shape.rotation)
    : point;
  return { x: world.x - shape.x, y: world.y - shape.y };
}

/**
 * Origin for a rotated connector whose geometry becomes `nextProps`, chosen so
 * points placed with {@link connectorWorldToLocal} land where they were meant
 * to. Changing the points moves the rotation centre, which otherwise swings
 * the whole connector about the old centre.
 */
export function connectorOrigin(
  shape: ConnectorShape,
  nextProps: Partial<ConnectorShape['props']>,
): Point {
  if (!shape.rotation) return { x: shape.x, y: shape.y };
  const before = connectorCenter(shape);
  const after = connectorCenter({
    ...shape,
    props: { ...shape.props, ...nextProps },
  } as ConnectorShape);
  const kept = rotatePoint(after, before, shape.rotation);
  return { x: shape.x + kept.x - after.x, y: shape.y + kept.y - after.y };
}

function localTargetBounds(shape: ArrowShape, target: Shape): Bounds {
  const bounds = shapeRotatedBounds(target);
  const corners = [
    connectorWorldToLocal(shape, { x: bounds.minX, y: bounds.minY }),
    connectorWorldToLocal(shape, { x: bounds.maxX, y: bounds.minY }),
    connectorWorldToLocal(shape, { x: bounds.maxX, y: bounds.maxY }),
    connectorWorldToLocal(shape, { x: bounds.minX, y: bounds.maxY }),
  ];
  return pointsBounds(corners);
}

function pointsEqual(a: readonly Vec[], b: readonly Vec[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (point, index) =>
        Math.abs(point.x - b[index]!.x) < 0.01 &&
        Math.abs(point.y - b[index]!.y) < 0.01,
    )
  );
}

/**
 * Keep bound endpoints and elbow routes synchronized with their target shapes.
 *
 * Runs on every document mutation, which means once per frame for the whole of
 * a stroke or drag. `dirty` is the caller's dirty set already expanded across
 * binding edges (see `BindingGraph.expand`): only arrows in it can need
 * re-resolving, so a drag elsewhere on the page costs nothing. Pass `null` to
 * rescan every arrow — required after a load, page switch, or resync, where no
 * meaningful dirty set exists.
 */
export function syncBoundArrows(
  shapes: readonly Shape[],
  editor: Editor,
  dirty: ReadonlySet<string> | null = null,
  /** The store's own id index for the same snapshot, when the caller has one.
   *  Building the equivalent Map here costs 0.44 ms at 10k shapes and 2.7 ms at
   *  50k — paid on every frame of a drag that moves a bound shape, which is
   *  exactly when candidates exist. Callers without an index (tests) fall back
   *  to building one. */
  byIdIndex?: Pick<ReadonlyMap<string, Shape>, 'get'>,
): void {
  if (dirty?.size === 0) return;

  // Gather the arrows that could need re-resolving. With a dirty set and the
  // store's index, look its ids up instead of scanning the page: that is O(k)
  // in the expanded set rather than O(N) in shapes, every frame of a drag.
  // Without an index (tests), build the Map lazily so the frames that turn out
  // to have no work don't pay its N-entry allocation.
  // Carries the narrowed `bindings` so the resolve loop below keeps the
  // non-undefined type the guard here established.
  const candidates: Array<{
    shape: ArrowShape;
    bindings: NonNullable<ArrowShape['props']['bindings']>;
  }> = [];
  const consider = (shape: Shape | undefined) => {
    if (shape?.type !== 'arrow' || !shape.props.bindings) return;
    candidates.push({ shape, bindings: shape.props.bindings });
  };
  if (dirty && byIdIndex) {
    for (const id of dirty) consider(byIdIndex.get(id));
  } else {
    for (const shape of shapes) {
      if (!dirty || dirty.has(shape.id)) consider(shape);
    }
  }
  if (candidates.length === 0) return;

  const byId =
    byIdIndex ?? new Map(shapes.map((shape) => [shape.id, shape]));
  const updates: Array<{
    id: string;
    x: number;
    y: number;
    points: Vec[];
    bindings: ArrowShape['props']['bindings'];
    parentId: string | null;
    index: string;
  }> = [];
  for (const { shape, bindings: initialBindings } of candidates) {
    const current = shape.props.points;
    const first = current[0];
    const last = current[current.length - 1];
    if (!first || !last) continue;
    let start = first;
    let end = last;
    let bindings = initialBindings;
    const startTarget = bindings.start
      ? byId.get(bindings.start.shapeId)
      : undefined;
    const endTarget = bindings.end ? byId.get(bindings.end.shapeId) : undefined;
    if (bindings.start && startTarget) {
      const point = pointForBinding(bindings.start, startTarget);
      if (point) start = connectorWorldToLocal(shape, point);
    } else if (bindings.start && !startTarget) {
      bindings = { ...bindings, start: null };
    }
    if (bindings.end && endTarget) {
      const point = pointForBinding(bindings.end, endTarget);
      if (point) end = connectorWorldToLocal(shape, point);
    } else if (bindings.end && !endTarget) {
      bindings = { ...bindings, end: null };
    }
    const topology =
      shape.props.topology ??
      (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight');
    const points =
      topology === 'elbow'
        ? orthogonalRoute(start, end, {
            startBounds: startTarget
              ? localTargetBounds(shape, startTarget)
              : undefined,
            endBounds: endTarget
              ? localTargetBounds(shape, endTarget)
              : undefined,
            startDirection:
              bindings.start && startTarget
                ? directionInConnector(bindings.start, startTarget, shape)
                : undefined,
            endDirection:
              bindings.end && endTarget
                ? directionInConnector(bindings.end, endTarget, shape)
                : undefined,
          })
        : [start, end];
    const boundTargets = [startTarget, endTarget].filter(
      (target): target is Shape => Boolean(target),
    );
    let parentId = shape.parentId ?? null;
    if (startTarget && endTarget) {
      parentId =
        findClosestCommonContainer(
          (id) => byId.get(id),
          [startTarget.id, endTarget.id],
        ) ?? null;
    } else if (boundTargets[0]) {
      // A frame target is reached at its border, usually from outside, so the
      // arrow sits beside it: parenting it to the frame would clip it away.
      parentId = boundTargets[0].parentId ?? null;
    }

    // Bound connectors render just above their highest target, but below the
    // next non-arrow layer. This prevents a cross-frame arrow disappearing
    // under the object it is visibly attached to.
    let index = shape.index;
    if (boundTargets.length) {
      const highest = boundTargets.reduce((a, b) =>
        a.index >= b.index ? a : b,
      );
      if (index <= highest.index) {
        let above: string | null = null;
        for (const sibling of shapes) {
          if (
            sibling.type === 'arrow' ||
            sibling.index <= highest.index ||
            (sibling.parentId ?? null) !== parentId
          ) {
            continue;
          }
          if (above === null || sibling.index < above) above = sibling.index;
        }
        index = jitterKeyBetween(highest.index, above);
      }
    }
    if (
      !pointsEqual(points, current) ||
      bindings !== shape.props.bindings ||
      parentId !== (shape.parentId ?? null) ||
      index !== shape.index
    ) {
      const { x, y } = connectorOrigin(shape, { points });
      updates.push({ id: shape.id, x, y, points, bindings, parentId, index });
    }
  }
  if (!updates.length) return;
  editor.transact(() => {
    for (const update of updates) {
      editor.updateShape(update.id, {
        x: update.x,
        y: update.y,
        parentId: update.parentId,
        index: update.index,
        props: { points: update.points, bindings: update.bindings },
      });
    }
  });
}
