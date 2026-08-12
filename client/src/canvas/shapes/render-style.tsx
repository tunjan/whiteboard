import type { ReactElement } from 'react';
import type { FillStyle, StrokeDash } from '@whiteboard/shared';

/**
 * strokeDasharray for a dash style at a given stroke width (or undefined).
 *
 * `dotLength` overrides the zero length a dot normally has; see
 * {@link useDotLength}. It defaults to 0, so callers that don't pass one keep
 * the plain round dot.
 */
export function strokeDashArray(
  dash: StrokeDash,
  size: number,
  dotLength = 0,
): string | undefined {
  if (dash === 'dashed') return `${size * 2.5} ${size * 2}`;
  // dot = zero-length dash with round linecaps.
  if (dash === 'dotted') return `${dotLength} ${size * 1.8}`;
  return undefined;
}

export function strokeLineCap(dash: StrokeDash): 'round' | undefined {
  return dash === 'dotted' ? 'round' : undefined;
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
        <HatchPattern id={pid} color={color} crosshatch={fillStyle === 'crosshatch'} />
      ),
    };
  }
  return { fill: 'none' };
}
