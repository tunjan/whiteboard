/**
 * Spring-loaded tool hotkeys: the rule that decides whether a released key
 * gives a borrowed tool back.
 *
 * Tapping a tool key is a mode switch and stays. Holding one is a moment's use
 * of another tool — reach for the eraser, take out a line, carry on drawing —
 * and the moment ends when the key does. The two presses are the same event
 * until the key comes up, so what separates them is what happened in between.
 */

/** A tool hotkey being held down, and the tool it borrowed from. */
export interface SpringHold {
  /** The held key, lowercased, as the matching key-up will report it. */
  key: string;
  /** Tool to return to. */
  from: string;
  /** Tool the key switched to, and the only one worth returning from. */
  to: string;
  /** Timestamp of the key-down, on the same clock as the key-up's. */
  at: number;
  /** Whether the hand used the borrowed tool — drew, erased, dragged. */
  used: boolean;
}

/**
 * The tool a key-up should return to, or null to stay where it is.
 *
 * Returns null for a tap, for a key that isn't the held one, and for a hold
 * whose tool has already been left behind — the toolbar, Escape, or a creation
 * tool completing have moved on, and there is nothing left to give back.
 *
 * `holdMs` only decides the empty-handed case. A press that drew something is
 * a hold however brief it was, which is what `used` records; the clock is for
 * the press that borrows a tool, thinks better of it, and lets go.
 */
export function springReturnTool(
  held: SpringHold | null,
  event: { key: string; timeStamp: number },
  activeToolId: string,
  holdMs: number,
): string | null {
  if (!held || held.key !== event.key.toLowerCase()) return null;
  if (activeToolId !== held.to) return null;
  if (!held.used && event.timeStamp - held.at < holdMs) return null;
  return held.from;
}
