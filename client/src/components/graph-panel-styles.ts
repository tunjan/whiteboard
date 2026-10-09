/**
 * The graph panel's shared geometry, read structurally from DESIGN.md and
 * expressed through the app's own tokens (never DESIGN.md's hex values):
 * one surface, groups ruled off by full-bleed hairlines instead of nested
 * cards, 8px on controls and 6px one step in.
 */

/** A group of the panel; the full-bleed hairline above it does the separating. */
export const SECTION = 'flex flex-col gap-2 border-t border-border px-3 py-3';

/** Width only — the track and gliding plate come from ToggleGroup itself. */
export const SEGMENTED_TRACK =
  'min-w-0 flex-1';

export const SEGMENTED_ITEM =
  'h-7 min-w-0 grow basis-0 px-0';

const NO_SPINNER =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

/** A bound typed in place: reads as text until reached. */
export const QUIET_NUMBER =
  'h-7 w-10 shrink-0 rounded-compact border-transparent bg-transparent px-0.5 text-center text-xs tabular-nums text-fg-subtle ' +
  'hover:border-border hover:text-fg focus:border-fg-subtle focus:bg-surface focus:text-fg ' +
  NO_SPINNER;

/** A number that is the point of its row. */
export const NUMBER_FIELD =
  'h-7 rounded-compact px-1.5 text-center text-xs tabular-nums ' + NO_SPINNER;

/** Math symbols (x, y, t, slider names) share the formula's face. */
export const MATH_SYMBOL =
  "font-['KaTeX_Math','KaTeX_Main',serif] italic text-fg select-none";
