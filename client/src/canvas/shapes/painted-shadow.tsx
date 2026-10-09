/**
 * Drop shadows for opaque shapes, painted rather than filtered.
 *
 * An `feDropShadow` has to blur the shape it is applied to, so the browser
 * rasterizes that subtree through a filter graph every time it repaints it —
 * which, on the shape layer, is every frame of a zoom. Measured on a 600×400
 * image that was 4.1ms per rasterize against 2.2ms with no shadow at all; the
 * stack below came in at 2.5ms, so almost all of the filter's cost is paid for
 * an effect that is a hairline at the sizes these shapes use it.
 *
 * The stand-in only works because every caller is opaque and knows its own
 * silhouette: the blurred edge of a solid shape is a function of distance from
 * that outline, so a few copies of the outline inflated outwards, each at the
 * alpha the Gaussian has at that distance, land in the same place. A shape with
 * real transparency — the sticker's cut-out artwork — has no outline to inflate
 * and still needs the filter.
 */

/** Gaussian tail P(X > z) for the standard normal, via Zelen & Severo 26.2.17.
 *  The alpha a blurred edge carries `z` standard deviations outside itself. */
function gaussianTail(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const tail =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? tail : 1 - tail;
}

/** Alpha below which a ring is invisible against the board and not worth drawing. */
const MIN_RING_ALPHA = 0.0005;

export interface PaintedShadowProps {
  /** The caller's outline, as a closed path in the same user space it draws in. */
  d: string;
  /** Downward offset, in world units. */
  dy: number;
  /** Blur radius, matching the `stdDeviation` of the filter this replaces. */
  blur: number;
  /** Peak opacity, matching the `floodOpacity` of the filter this replaces. */
  opacity: number;
}

/**
 * The ring schedule for a shadow of `blur` and peak `opacity`: how far outside
 * the outline each copy sits and the alpha it carries.
 *
 * Shared with the Canvas2D renderer, which paints the same stack as context
 * calls rather than as elements — the arithmetic is the shadow, so it lives in
 * one place and neither renderer can drift from the other.
 */
export function shadowRings(
  blur: number,
  opacity: number,
): { distance: number; alpha: number }[] {
  // A Gaussian is spent by three standard deviations out; enough rings to keep
  // the steps under a world unit, and no more than a soft shadow can show.
  const count = Math.max(2, Math.min(8, Math.round(blur * 1.5) + 1));
  const rings: { distance: number; alpha: number }[] = [];
  let laid = 0; // alpha already composited by the rings outside this one
  // Outermost first, down to zero. The innermost ring has to sit *on* the
  // outline: that is where a blurred edge is darkest (half the peak), and a
  // schedule that stops short of it drops most of the shadow — at blur 1 it
  // left a single ring at 0.005 alpha, which is nothing.
  for (let i = 1; i <= count; i++) {
    const distance = (3 * blur * (count - i)) / count;
    const target = opacity * gaussianTail(distance / blur);
    // Ring alpha that brings the composite of everything so far up to `target`.
    const alpha = 1 - (1 - target) / (1 - laid);
    laid = target;
    if (alpha >= MIN_RING_ALPHA) rings.push({ distance, alpha });
  }
  return rings;
}

export function PaintedShadow({ d, dy, blur, opacity }: PaintedShadowProps) {
  const rings = shadowRings(blur, opacity);
  return (
    <g transform={`translate(0 ${dy})`} pointerEvents="none">
      {rings.map(({ distance, alpha }) => (
        // Filling *and* stroking the outline at twice the distance inflates it
        // outwards by exactly that distance, so one element covers each ring
        // and the shape it grows from can be any closed path.
        <path
          key={distance}
          d={d}
          fill="#000000"
          fillOpacity={alpha}
          stroke="#000000"
          strokeOpacity={alpha}
          strokeWidth={distance * 2}
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

/** The outline of a rounded rect, for callers that draw one as a `<rect>`. */
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + radius} ${y} H${x + w - radius} A${radius} ${radius} 0 0 1 ${x + w} ${y + radius} V${y + h - radius} A${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h} H${x + radius} A${radius} ${radius} 0 0 1 ${x} ${y + h - radius} V${y + radius} A${radius} ${radius} 0 0 1 ${x + radius} ${y} Z`;
}
