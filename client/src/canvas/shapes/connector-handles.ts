import {
  type ArrowShape,
  type LineShape,
  type Point,
  type Vec,
} from '@whiteboard/shared';
import {
  bindingForPoint,
  connectorLocalToWorld as localToWorld,
  connectorOrigin,
  connectorWorldToLocal as worldToLocal,
  orthogonalRoute,
} from './connector-routing';
import {
  bendFromPoint,
  curveApex,
  segmentMidpoint,
} from './line-geometry';
import type { HandleDragResult, ShapeHandle } from './types';

/** A handle result that keeps a rotated connector's unmoved points in place. */
function placed<T extends LineShape | ArrowShape>(
  shape: T,
  props: Partial<T['props']>,
): { x: number; y: number; props: Partial<T['props']> } {
  return { ...connectorOrigin(shape, props), props };
}

function lockToNeighbor(point: Vec, neighbor: Vec): Vec {
  const dx = point.x - neighbor.x;
  const dy = point.y - neighbor.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: point.x, y: neighbor.y }
    : { x: neighbor.x, y: point.y };
}

export function lineHandles(shape: LineShape): ShapeHandle[] {
  const points = shape.props.points;
  if (points.length < 2) return [];
  const handles: ShapeHandle[] = points.map((point, index) => ({
    id: `vertex:${index}`,
    kind: 'vertex',
    point: localToWorld(shape, point),
  }));
  // Preserve the old single-arc editing affordance on existing bent lines.
  if (points.length === 2 && Math.abs(shape.props.bend ?? 0) >= 0.5) {
    handles.push({
      id: 'bend',
      kind: 'bend',
      point: localToWorld(
        shape,
        curveApex(points[0]!, points[1]!, shape.props.bend ?? 0),
      ),
    });
    return handles;
  }
  for (let index = 0; index < points.length - 1; index++) {
    handles.push({
      id: `create:${index}`,
      kind: 'create',
      point: localToWorld(
        shape,
        segmentMidpoint(
          points,
          index,
          shape.props.bend ?? 0,
          shape.props.spline ?? 'linear',
        ),
      ),
    });
  }
  return handles;
}

export function lineHandleDrag(
  shape: LineShape,
  handleId: string,
  point: Point,
  opts: { shiftKey: boolean },
): HandleDragResult<'line'> {
  const points = shape.props.points;
  let local = worldToLocal(shape, point);
  if (handleId === 'bend') {
    return placed(shape, {
      bend: bendFromPoint(points[0]!, points[points.length - 1]!, local),
    });
  }
  const [kind, rawIndex] = handleId.split(':');
  const index = Number(rawIndex);
  if (!Number.isInteger(index)) return {};
  if (opts.shiftKey) {
    const neighbor =
      kind === 'create'
        ? points[index]
        : points[index === 0 ? 1 : index - 1];
    if (neighbor) local = lockToNeighbor(local, neighbor);
  }
  const next = points.map((vertex) => ({ ...vertex }));
  if (kind === 'create') next.splice(index + 1, 0, local);
  else if (kind === 'vertex' && next[index]) next[index] = local;
  return placed(shape, { points: next, bend: 0 });
}

export function arrowHandles(shape: ArrowShape): ShapeHandle[] {
  const points = shape.props.points;
  if (points.length < 2) return [];
  const topology =
    shape.props.topology ??
    (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight');
  const handles: ShapeHandle[] = [
    { id: 'start', kind: 'vertex', point: localToWorld(shape, points[0]!) },
    {
      id: 'end',
      kind: 'vertex',
      point: localToWorld(shape, points[points.length - 1]!),
    },
  ];
  if (topology !== 'elbow') {
    handles.push({
      id: 'bend',
      kind: 'bend',
      point: localToWorld(
        shape,
        curveApex(
          points[0]!,
          points[points.length - 1]!,
          topology === 'arc' ? shape.props.bend ?? 0 : 0,
        ),
      ),
    });
  }
  return handles;
}

export function arrowHandleDrag(
  shape: ArrowShape,
  handleId: string,
  point: Point,
  opts: { shiftKey: boolean; bindingTarget?: import('@whiteboard/shared').Shape },
): HandleDragResult<'arrow'> {
  const points = shape.props.points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (handleId === 'bend') {
    return placed(shape, {
      topology: 'arc',
      bend: bendFromPoint(first, last, worldToLocal(shape, point)),
      points: [first, last],
    });
  }
  if (handleId !== 'start' && handleId !== 'end') return {};

  const isStart = handleId === 'start';
  const opposite = localToWorld(shape, isStart ? last : first);
  let worldPoint = point;
  let binding = null;
  if (opts.bindingTarget) {
    const result = bindingForPoint(opts.bindingTarget, point, opposite);
    if (result) {
      binding = result.binding;
      worldPoint = result.point;
    }
  }
  let local = worldToLocal(shape, worldPoint);
  if (opts.shiftKey && !binding) local = lockToNeighbor(local, isStart ? last : first);
  const start = isStart ? local : first;
  const end = isStart ? last : local;
  const topology =
    shape.props.topology ??
    (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight');
  return placed(shape, {
    points: topology === 'elbow' ? orthogonalRoute(start, end) : [start, end],
    bindings: {
      ...shape.props.bindings,
      [isStart ? 'start' : 'end']: binding,
    },
  });
}
