/** One-shot hand-off to the equation panel. Placement and the explicit Enter
 * edit command request focus; ordinary pointer selection intentionally does
 * not, so Delete, arrow-nudge, and tool hotkeys keep working. */
let pendingFocusId: string | null = null;
const focusListeners = new Set<(id: string) => void>();

export function requestEquationFocus(id: string): void {
  pendingFocusId = id;
  for (const listener of focusListeners) listener(id);
}

/**
 * Whether `id` is still waiting for the caret. A peek, not a take: the request
 * is only cleared by `resolveEquationFocus`, once focus has really landed.
 *
 * Clearing it at mount instead was the old behaviour, and it lost the focus
 * outright under StrictMode — which mounts, tears down, and re-mounts every
 * effect. The teardown cancelled the panel's pending focus frame, and the
 * second mount found the request already spent, so nothing rescheduled it.
 */
export function hasEquationFocusRequest(id: string): boolean {
  return pendingFocusId === id;
}

/** Retire the request for `id`: focus arrived, or the panel gave up chasing it.
 * Either way it must not ambush a later, ordinary selection of the same shape. */
export function resolveEquationFocus(id: string): void {
  if (pendingFocusId === id) pendingFocusId = null;
}

/** Receive focus requests while an equation panel is already mounted. */
export function subscribeEquationFocus(
  listener: (id: string) => void,
): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}
