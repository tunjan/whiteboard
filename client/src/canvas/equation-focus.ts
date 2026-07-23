/** One-shot hand-off to the equation panel. Placement and the explicit Enter
 * edit command request focus; ordinary pointer selection intentionally does
 * not, so Delete, arrow-nudge, and tool hotkeys keep working. */
let pendingFocusId: string | null = null;
const focusListeners = new Set<(id: string) => void>();

export function requestEquationFocus(id: string): void {
  pendingFocusId = id;
  for (const listener of focusListeners) listener(id);
}

/** True once, for the shape that was just placed. */
export function consumeEquationFocus(id: string): boolean {
  if (pendingFocusId !== id) return false;
  pendingFocusId = null;
  return true;
}

/** Receive focus requests while an equation panel is already mounted. */
export function subscribeEquationFocus(
  listener: (id: string) => void,
): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}
