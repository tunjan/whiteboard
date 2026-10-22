/**
 * The graph panel's shared geometry, taken from the Atlassian Design System:
 * one overlay surface, groups divided by `border.default` hairlines, 16px
 * gutters (`space.200`), and form controls built to the Text field spec
 * (1px `border.input`, `radius.medium`, 32px compact height).
 */

/** A group of the panel; the full-bleed hairline above it does the separating. */
export const SECTION = 'flex flex-col gap-3 border-t border-border px-4 py-3';

const NO_SPINNER =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

const FIELD =
  'h-8 min-w-0 rounded-compact px-1.5 text-center text-sm tabular-nums ' +
  NO_SPINNER;

/** Text field, standard appearance. The focus ring is the app-wide one. */
export const NUMBER_FIELD =
  FIELD +
  ' bg-[var(--ds-background-input)] hover:border-[var(--ds-border-input)] hover:bg-[var(--ds-background-input-hovered)] focus:bg-[var(--ds-background-input-pressed)]';

/** Text field, subtle appearance: transparent until hovered or focused. */
export const QUIET_NUMBER =
  FIELD +
  ' border-transparent bg-transparent text-fg-subtle hover:border-transparent hover:bg-[var(--ds-background-input-hovered)] hover:text-fg focus:bg-[var(--ds-background-input-pressed)] focus:text-fg';

/** Math symbols (x, y, t, slider names) share the formula's face. */
export const MATH_SYMBOL =
  "font-['KaTeX_Math','KaTeX_Main',serif] italic text-fg select-none";
