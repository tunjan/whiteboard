import type { StrokeDash, Vec } from '@whiteboard/shared';

/**
 * Analytical dash distribution.
 *
 * A plain `stroke-dasharray` repeats a fixed pattern until the path runs out,
 * so where the last dash lands is an accident of the path's length: a stroke
 * can end mid-gap, or on a sliver of a dash a fraction of the others' size, and
 * resizing a shape slides every dash along it. This solves the distribution
 * instead — given the path's arc length, it picks the whole number of dashes
 * that fits best and then stretches dash and gap to span the length exactly, so
 * both ends of a stroke always land on a full dash and stay there while the
 * shape is resized.
 */

/** How a dash pattern meets the end of a path. */
export type DashTerminal =
  /** Overhang half a dash, so the endpoint sits mid-dash. */
  | 'outset'
  /** Retract a full dash, leaving the endpoint clear. */
  | 'skip'
  /** Start the pattern exactly at the endpoint. */
  | 'none';

export interface PerfectDashOptions {
  style?: StrokeDash;
  /** Round the dash count down to a multiple of this. */
  snap?: number;
  start?: DashTerminal;
  end?: DashTerminal;
  /** Dash length as a multiple of the stroke width, before redistribution. */
  lengthRatio?: number;
  /** Distribute around a loop rather than between two ends. */
  closed?: boolean;
  /** Bypass distribution even when a dashed style is selected. */
  forceSolid?: boolean;
  /**
   * Smallest length a dash may be painted with, in the path's own units.
   *
   * A dot is normally a zero-length dash relying on a round linecap to paint
   * it; see `useDotLength` for the zoom at which browsers stop drawing that.
   * Any length added here is taken back out of the gap, so the dashes keep the
   * spacing the distribution gave them.
   */
  minDashLength?: number;
  /**
   * The path is still being drawn, so `totalLength` is not yet its length.
   *
   * Fitting to a length that grows every frame re-solves the distribution every
   * frame, and because each dash is positioned relative to the one before it,
   * every dash already on screen shifts a little — the drawn part of the stroke
   * crawls while the hand is still moving. Nothing is gained by it either: the
   * point of fitting is to land a whole dash on the far end, and the far end is
   * wherever the pointer happens to be right now. So the nominal period is laid
   * from the start instead, unchanging, and the fit happens once the stroke is
   * finished and has an end worth landing on.
   */
  inProgress?: boolean;
}

export interface DashProps {
  strokeDasharray?: string;
  strokeDashoffset?: string;
}

/** Dots are laid out as a dash pattern whose dash is 1/100th of a period. */
const DOT_RATIO = 100;

/** Below this many dashes a dashed path is split by hand; see `getPerfectDashProps`. */
const MIN_DISTRIBUTED_DASHES = 3;

const SOLID: DashProps = {
  strokeDasharray: undefined,
  strokeDashoffset: undefined,
};

/** Hundredths of a unit are already below a device pixel at any usable zoom. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** How far the pattern slides back so a terminal falls where it was asked to. */
function startOffset(terminal: DashTerminal, dashLength: number): number {
  if (terminal === 'outset') return dashLength / 2;
  if (terminal === 'skip') return -dashLength;
  return 0;
}

function emit(
  dashLength: number,
  gapLength: number,
  strokeDashoffset: number,
  minDashLength: number,
): DashProps {
  if (minDashLength > dashLength) {
    // Take the added length back out of the gap so the dashes stay where the
    // distribution put them — unless the whole period is shorter than the
    // minimum, in which case there is nothing to hold on to and an even
    // on/off pattern is all that keeps the stroke from painting solid.
    gapLength = Math.max(
      gapLength - (minDashLength - dashLength),
      minDashLength,
    );
    dashLength = minDashLength;
  }
  return {
    strokeDasharray: `${round(dashLength)} ${round(gapLength)}`,
    strokeDashoffset: String(round(strokeDashoffset)),
  };
}

/**
 * `stroke-dasharray` and `stroke-dashoffset` that spread whole dashes evenly
 * over a path of `totalLength`, or solid attributes if it should not be dashed.
 */
export function getPerfectDashProps(
  totalLength: number,
  strokeWidth: number,
  opts: PerfectDashOptions = {},
): DashProps {
  const {
    closed = false,
    snap = 1,
    start = 'outset',
    end = 'outset',
    lengthRatio = 2,
    style = 'dashed',
    minDashLength = 0,
    inProgress = false,
    forceSolid = false,
  } = opts;

  // `draw` is synthesized as geometry rather than represented by a native SVG
  // dash pattern. Treating it as solid here keeps generic callers safe while
  // the shape renderers route it through geometry-synthesis.ts.
  if (forceSolid || style === 'solid' || style === 'draw') return SOLID;
  if (!(strokeWidth > 0)) return SOLID;

  const dotted = style === 'dotted';
  const ratio = dotted ? DOT_RATIO : 1;
  // The dash length used where the path is long enough to hold whole periods
  // of it. `2 * ratio` of these make one period, dash plus gap.
  const nominalDash = dotted ? strokeWidth / ratio : strokeWidth * lengthRatio;

  // Checked before the length is, because a path that is still growing has no
  // length worth trusting yet. See `inProgress`.
  if (inProgress) {
    return emit(
      nominalDash,
      2 * ratio * nominalDash - nominalDash,
      closed ? 0 : startOffset(start, nominalDash),
      minDashLength,
    );
  }
  if (!(totalLength > 0)) return SOLID;

  // A dash is two stroke widths long, until the path is so short that four of
  // them would not fit — past that the dash tracks the path instead of the pen.
  let dashLength = dotted
    ? nominalDash
    : Math.min(nominalDash, totalLength / 4);
  let gapLength = 0;
  let strokeDashoffset = 0;
  let effectiveLength = totalLength;

  // Terminals lengthen or shorten the span the dashes are fitted to, and the
  // offset slides the pattern back by as much so the path still starts where
  // the caller's geometry does. A loop has no ends to compensate at.
  if (!closed) {
    strokeDashoffset = startOffset(start, dashLength);
    effectiveLength += strokeDashoffset + startOffset(end, dashLength);
  }
  // Two `skip` terminals can retract more than a short path has to give.
  effectiveLength = Math.max(effectiveLength, 0);

  let dashCount = Math.floor(effectiveLength / dashLength / (2 * ratio));
  dashCount -= dashCount % snap;

  if (dashCount < MIN_DISTRIBUTED_DASHES && !dotted) {
    // Too short to read as a dashed line: either draw it solid, or split it
    // into exactly one dash, one gap and one dash so it still reads as dashed.
    if (effectiveLength / strokeWidth < 4) {
      dashLength = effectiveLength;
      gapLength = 0;
    } else {
      dashLength = effectiveLength / 3;
      gapLength = effectiveLength / 3;
    }
  } else {
    // A path shorter than one dot period rounds down to zero dashes, which
    // would divide by it below. One dot is the least that can still be drawn.
    dashCount = Math.max(1, dashCount);
    dashLength = effectiveLength / dashCount / (2 * ratio);
    if (closed) {
      // Half a dash of offset puts a dash centre on the path's seam, so the
      // point where a loop closes is not visible as a break in the pattern.
      strokeDashoffset = dashLength / 2;
      gapLength = (effectiveLength - dashCount * dashLength) / dashCount;
    } else {
      gapLength =
        (effectiveLength - dashCount * dashLength) / Math.max(1, dashCount - 1);
    }
  }

  return emit(dashLength, gapLength, strokeDashoffset, minDashLength);
}

/** Arc length of a polyline, optionally closing the last vertex to the first. */
export function polylineLength(points: readonly Vec[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y,
    );
  }
  if (closed && points.length > 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    total += Math.hypot(last.x - first.x, last.y - first.y);
  }
  return total;
}

/**
 * Perimeter of an ellipse, by Ramanujan's second approximation.
 *
 * The exact perimeter is an elliptic integral with no closed form. This is
 * within a part in 10^9 for every aspect ratio a drawn ellipse can reach, which
 * is far finer than the sub-pixel rounding the dash lengths get anyway.
 */
export function ellipsePerimeter(rx: number, ry: number): number {
  const a = Math.abs(rx);
  const b = Math.abs(ry);
  if (a + b === 0) return 0;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
