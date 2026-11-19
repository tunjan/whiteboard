import { paletteColors, type PaletteColor } from '@/canvas/use-style-store';
import { useThemeStore, type Theme } from '@/use-theme-store';

// Curve colors: the same drawing palette as the pen (use-style-store.ts),
// assigned round-robin as expressions are added and read against the current
// theme so a curve always clears its canvas. `theme` defaults to the live
// value for callers outside React render (e.g. creating a new expression);
// components that need to re-render on a theme flip pass their subscribed
// value instead.
export function graphColors(
  theme: Theme = useThemeStore.getState().theme,
): PaletteColor[] {
  return paletteColors(theme);
}

/** Blue, red, green, orange, violet: the order new curves take, so the
 * first two always contrast. */
const CURVE_SLOTS = [4, 11, 8, 7, 3];

/** The colours new curves are assigned round-robin, drawn for `theme`. */
export function curveColors(
  theme: Theme = useThemeStore.getState().theme,
): PaletteColor[] {
  const colors = graphColors(theme);
  return CURVE_SLOTS.map((slot) => colors[slot]!);
}

/** Looks up a curve color's name in the current palette, if it's still on it. */
export function graphColorName(
  color: string,
  theme: Theme = useThemeStore.getState().theme,
): string {
  return graphColors(theme).find((c) => c.value === color)?.name ?? 'Custom color';
}
