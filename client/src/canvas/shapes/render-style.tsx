import type { ReactElement } from 'react';
import type { FillStyle, StrokeDash, Vec } from '@whiteboard/shared';
import {
  getPerfectDashProps,
  type DashProps,
  type PerfectDashOptions,
} from './perfect-dash';
import { synthesizeDrawPaths } from './geometry-synthesis';

/**
 * Dash attributes for a stroke of `length`, distributed so both of its ends
 * land on a whole dash. See {@link getPerfectDashProps}.
 *
 * `length` is the arc length of the path being stroked, in the same units as
 * `size` — every caller already has to flatten its geometry for hit-testing, so
 * this is measured from that same polyline rather than a second approximation
 * of the shape.
 */
export function dashProps(
  dash: StrokeDash,
  size: number,
  length: number,
  opts: PerfectDashOptions = {},
): DashProps {
  return getPerfectDashProps(length, size, { ...opts, style: dash });
}

export function strokeLineCap(dash: StrokeDash): 'round' | undefined {
  return dash === 'dotted' ? 'round' : undefined;
}

/**
 * The outline of a closed straight-edged shape, with each edge dashed on its
 * own arc length rather than the whole perimeter's.
 *
 * Dashing a perimeter in one pass lets a dash straddle a corner and puts the
 * pattern's phase at each corner at the mercy of the lengths of the edges
 * before it, so two sides of the same rectangle disagree about where their
 * dashes sit. Per-edge, every corner is the centre of a dash: each edge
 * overhangs its ends by half a dash, and the two halves meeting at a vertex
 * read as the single dash that turns the corner.
 */
export function DashedOutline({
  points,
  dash,
  color,
  size,
}: {
  points: readonly Vec[];
  dash: Extract<StrokeDash, 'dashed' | 'dotted'>;
  color: string;
  size: number;
}): ReactElement {
  return (
    <>
      {points.map((from, i) => {
        const to = points[(i + 1) % points.length]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        return (
          <line
            key={i}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={color}
            strokeWidth={size}
            // Round, so the half-dashes arriving at a vertex from either side
            // close over the corner instead of leaving a wedge of it unpainted.
            strokeLinecap="round"
            {...dashProps(dash, size, length)}
          />
        );
      })}
    </>
  );
}

/** Deterministic two-pass outline used by the `draw` stroke style. */
export function DrawnOutline({
  points,
  seed,
  color,
  size,
  closed = false,
}: {
  points: readonly Vec[];
  seed: string;
  color: string;
  size: number;
  closed?: boolean;
}): ReactElement {
  const paths = synthesizeDrawPaths(points, { seed, size, closed });
  return (
    <>
      {paths.map((d, pass) => (
        <path
          key={pass}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={size}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

export interface FillResult {
  fill: string;
  fillOpacity?: number;
  /** A <pattern> element to place in <defs> (for hatch/crosshatch). */
  pattern?: ReactElement;
}

function HatchPattern({
  id,
  color,
  crosshatch,
}: {
  id: string;
  color: string;
  crosshatch: boolean;
}): ReactElement {
  return (
    <pattern
      id={id}
      width={7}
      height={7}
      patternUnits="userSpaceOnUse"
      patternTransform="rotate(45)"
    >
      <line x1={0} y1={0} x2={0} y2={7} stroke={color} strokeWidth={1} />
      {crosshatch ? (
        <line x1={0} y1={0} x2={7} y2={0} stroke={color} strokeWidth={1} />
      ) : null}
    </pattern>
  );
}

/** Resolve fill attributes for a shape, deriving fills from its stroke color. */
export function fillFor(
  id: string,
  color: string,
  fillStyle: FillStyle,
): FillResult {
  if (fillStyle === 'solid') return { fill: color, fillOpacity: 0.18 };
  if (fillStyle === 'hatch' || fillStyle === 'crosshatch') {
    const pid = `hatch-${id}`;
    return {
      fill: `url(#${pid})`,
      pattern: (
        <HatchPattern
          id={pid}
          color={color}
          crosshatch={fillStyle === 'crosshatch'}
        />
      ),
    };
  }
  return { fill: 'none' };
}
