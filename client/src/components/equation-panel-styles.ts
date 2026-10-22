/**
 * Atlassian's Text field / Textarea surface: `background.input` with a
 * `border.input` edge, filling on hover and again while focused. The ring on
 * focus is the app-wide one. Radius and padding stay with the call site.
 */
export const FIELD_SURFACE =
  'bg-[var(--ds-background-input)] hover:border-[var(--ds-border-input)] hover:bg-[var(--ds-background-input-hovered)] focus:bg-[var(--ds-background-input-pressed)]';
