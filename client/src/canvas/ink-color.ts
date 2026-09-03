import type { Shape } from '@whiteboard/shared';
import { PALETTE } from './use-style-store';

/**
 * Ink is the one swatch whose value depends on the theme: palette slot 0 holds
 * black on the light canvas and white on the dark one. A board is shared, and
 * two people can be looking at it under different themes, so a stroke stored in
 * either of those values is "ink" and must paint as whichever of the two reads
 * against the *viewer's* canvas — black ink drawn in light mode shows up white
 * to someone in dark mode, and the reverse.
 *
 * The substitution is a paint one, not a document one: nothing here writes to a
 * shape, so the two viewers still agree on what the board holds.
 *
 * It resolves through the `--ink` custom property rather than a theme read, so
 * the flip costs no React work on a board holding thousands of shapes — the
 * browser repaints the attribute when the `.dark` class moves. The PNG export
 * and the camera snapshot both already resolve `var()` in paint attributes
 * (`css-vars.ts`), so they follow the exporter's own theme unchanged.
 */
const INK = new Set<string>([PALETTE.light[0]!.value, PALETTE.dark[0]!.value]);

/** The paint attribute ink resolves through. */
export const INK_PAINT = 'var(--ink)';

/** `color` as it should be painted: ink follows the viewer, everything else is itself. */
export function inkPaint(color: string): string {
  return INK.has(color) ? INK_PAINT : color;
}

/** The shape as it should be painted — see {@link inkPaint}. */
export function inkShape<T extends Shape>(shape: T): T {
  const { color } = shape.props as { color?: unknown };
  if (typeof color !== 'string') return shape;
  const paint = inkPaint(color);
  if (paint === color) return shape;
  return { ...shape, props: { ...shape.props, color: paint } };
}
