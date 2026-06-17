import type { Point, Vec } from '@whiteboard/shared';
import { bendFromPoint, curveApex } from './line-geometry';
import type { ShapeHandle } from './types';

/** A line/arrow-shaped value: an origin plus a 2-vertex polyline with a bend. */
interface Connector {
  x: number;
  y: number;
  props: { points: Vec[]; bend: number };
}

/**
 * Endpoint + bend handles for a connector (line/arrow), in world coordinates.
 * Shared so both shapes expose identical editing affordances.
 */
export function connectorHandles(s: Connector): ShapeHandle[] {
  const pts = s.props.points;
  if (pts.length < 2) return [];
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const apex = curveApex(a, b, s.props.bend ?? 0);
  return [
    { id: 'start', kind: 'vertex', point: { x: s.x + a.x, y: s.y + a.y } },
    { id: 'end', kind: 'vertex', point: { x: s.x + b.x, y: s.y + b.y } },
    { id: 'bend', kind: 'bend', point: { x: s.x + apex.x, y: s.y + apex.y } },
  ];
}

/** Apply a connector handle drag, returning the changed props (origin fixed). */
export function connectorHandleDrag(
  s: Connector,
  handleId: string,
  p: Point,
): { props: { points?: Vec[]; bend?: number } } {
  const pts = s.props.points;
  const local = { x: p.x - s.x, y: p.y - s.y };
  if (handleId === 'bend') {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    return { props: { bend: bendFromPoint(a, b, local) } };
  }
  const next = pts.map((pt) => ({ ...pt }));
  if (handleId === 'start') next[0] = local;
  else if (handleId === 'end') next[next.length - 1] = local;
  return { props: { points: next } };
}
