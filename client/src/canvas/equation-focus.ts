/**
 * One-shot hand-off from the equation tool to the equation panel: only a
 * freshly placed equation grabs the formula field. Selecting an existing one
 * leaves focus on the canvas, so Delete, arrow-nudge and tool hotkeys keep
 * working (the global key handler ignores events from inside a <math-field>).
 */
let pendingFocusId: string | null = null;

export function requestEquationFocus(id: string): void {
  pendingFocusId = id;
}

/** True once, for the shape that was just placed. */
export function consumeEquationFocus(id: string): boolean {
  if (pendingFocusId !== id) return false;
  pendingFocusId = null;
  return true;
}
