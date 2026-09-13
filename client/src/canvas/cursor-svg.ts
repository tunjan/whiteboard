/**
 * Cursor glyphs synthesized to face an arbitrary angle.
 *
 * The native CSS resize cursors land every 45 degrees, so on a box turned to
 * any other angle they point somewhere the edge does not actually move. Drawing
 * the glyph ourselves lets it follow the box exactly.
 *
 * The glyph turns; its drop shadow must not. A shadow that rotated with the
 * cursor would read as the light source orbiting the screen while the user
 * drags, so the offset is counter-rotated by the same angle — leaving it cast
 * down-right from a fixed top-left light whichever way the glyph points.
 */

export interface RotatedCursor {
  /** Glyph path data, drawn inside a 32x32 box. */
  path: string;
  /** Degrees clockwise. The glyph turns about the middle of that box. */
  angle: number;
  /**
   * Applied after the rotation, for a glyph whose path is not already centred
   * on the box — the rotation has to happen about the box's middle, which is
   * also the hotspot, or the cursor's tip drifts off the point it is aimed at.
   */
  translate?: readonly [number, number];
  /** CSS keyword served where the data URI cannot be loaded. */
  fallback: string;
}

const cache = new Map<string, string>();

/** The counter-rotated shadow offset: one light, fixed to the screen. */
function shadowOffset(angle: number): { dx: number; dy: number } {
  const a = -angle * (Math.PI / 180);
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  return { dx: round(cos - sin), dy: round(sin + cos) };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Angle on [0, 360), so equivalent angles share one cache entry. */
function normalizeAngle(angle: number): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

/**
 * A `cursor` value for `glyph`, turned to `angle`. Cached: a drag re-derives
 * the cursor on every pointer move, and the angle repeats within a degree.
 */
export function rotatedCursor(glyph: RotatedCursor): string {
  const angle = normalizeAngle(glyph.angle);
  const key = `${glyph.fallback}|${angle}|${glyph.path}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const { dx, dy } = shadowOffset(angle);
  const [tx, ty] = glyph.translate ?? [0, 0];
  const shift = tx || ty ? ` translate(${tx} ${ty})` : '';
  // Outlined rather than filled: a white halo under a dark glyph is the only
  // thing that keeps a cursor legible over ink of any colour.
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>
      <defs>
        <filter id='shadow' x='-40%' y='-40%' width='180%' height='180%' color-interpolation-filters='sRGB'>
          <feDropShadow dx='${dx}' dy='${dy}' stdDeviation='1.2' flood-opacity='.5'/>
        </filter>
      </defs>
      <g fill='none' transform='rotate(${angle} 16 16)${shift}' filter='url(#shadow)'>
        <path d='${glyph.path}' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/>
        <path d='${glyph.path}' stroke='#202124' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'/>
      </g>
    </svg>
  `;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, ${glyph.fallback}`;
  cache.set(key, cursor);
  return cursor;
}
