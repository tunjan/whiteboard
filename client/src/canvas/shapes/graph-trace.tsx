import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GraphViewport } from '@whiteboard/shared';
import { formatIntersectionLabel } from '../graph-intersections';
import { screenToGraph, type PlotArea } from './graph-interaction';

type Point = { x: number; y: number };

export interface TraceCurve {
  color: string;
  /** Polylines in the shape's drawing coordinates, as the paths are drawn. */
  screens: readonly (readonly Point[])[];
}

/** How close, in screen pixels, the pointer has to come to a curve to trace it. */
const TRACE_REACH_PX = 8;

/**
 * The point on any of `curves` nearest `from`, if one is within `reach`.
 * Projects onto each drawn segment rather than snapping to its vertices, which
 * can sit far apart on a straight stretch.
 */
export function nearestOnCurves(
  curves: readonly TraceCurve[],
  from: Point,
  reach: number,
): { point: Point; color: string } | null {
  let best: { point: Point; color: string } | null = null;
  let bestDistance = reach * reach;
  for (const curve of curves) {
    for (const screen of curve.screens) {
      for (let i = 1; i < screen.length; i += 1) {
        const a = screen[i - 1]!;
        const b = screen[i]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy;
        const t =
          length === 0
            ? 0
            : Math.max(0, Math.min(1, ((from.x - a.x) * dx + (from.y - a.y) * dy) / length));
        const x = a.x + t * dx;
        const y = a.y + t * dy;
        const distance = (x - from.x) ** 2 + (y - from.y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { point: { x, y }, color: curve.color };
        }
      }
    }
  }
  return best;
}

const LABEL_STYLE = {
  fontSize: 13,
  fontWeight: 600 as const,
  fill: 'var(--color-foreground)',
  stroke: 'var(--color-panel)',
  strokeWidth: 3.5,
  paintOrder: 'stroke' as const,
};

/**
 * A dot and its coordinates where the pointer hovers near a curve.
 *
 * Holds its own state so a pointer move re-renders this alone, not the graph
 * and every path in it.
 */
export function GraphTrace({
  target,
  curves,
  viewport,
  area,
}: {
  /** The graph's group: the pointer is read in its coordinates. */
  target: RefObject<SVGGElement | null>;
  curves: readonly TraceCurve[];
  viewport: GraphViewport;
  area: PlotArea;
}) {
  const [hover, setHover] = useState<{ point: Point; color: string } | null>(
    null,
  );
  const latest = useRef({ curves, area });
  latest.current = { curves, area };

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const onMove = (event: PointerEvent) => {
      // Not while dragging the card or drawing over it, and touch has no hover.
      if (event.buttons !== 0 || event.pointerType === 'touch') {
        setHover(null);
        return;
      }
      const matrix = el.getScreenCTM();
      if (!matrix) return;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      const { curves, area } = latest.current;
      const inPlot =
        local.x >= area.x &&
        local.x <= area.x + area.w &&
        local.y >= area.y &&
        local.y <= area.y + area.h;
      const zoom = Math.hypot(matrix.a, matrix.b) || 1;
      setHover(inPlot ? nearestOnCurves(curves, local, TRACE_REACH_PX / zoom) : null);
    };
    const onLeave = () => setHover(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [target]);

  if (!hover) return null;
  const { point, color } = hover;
  const value = screenToGraph(point, viewport, area);
  // Above and to the right, unless that runs off the plot.
  const right = point.x < area.x + area.w - 110;
  const above = point.y > area.y + 24;
  return (
    <g pointerEvents="none">
      <circle
        cx={point.x}
        cy={point.y}
        r={5}
        fill={color}
        stroke="var(--color-panel)"
        strokeWidth={1.75}
      />
      <text
        x={point.x + (right ? 9 : -9)}
        y={point.y + (above ? -9 : 19)}
        textAnchor={right ? 'start' : 'end'}
        {...LABEL_STYLE}
      >
        {formatIntersectionLabel(value)}
      </text>
    </g>
  );
}
