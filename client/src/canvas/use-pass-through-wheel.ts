import { useEffect, type RefObject } from 'react';

// Wheel events this hook re-dispatched. Forwarding lands the copy on the canvas
// surface, which is not inside any pass-through root, so this is belt and
// braces against a nested root ever forwarding the same event twice.
const forwarded = new WeakSet<WheelEvent>();

/** The parts of an element that decide whether a wheel belongs to it. */
export interface ScrollMetrics {
  overflowX: string;
  overflowY: string;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Whether an element consumes the wheel itself. Both halves matter: a panel
 * declaring `overflow-y: auto` that happens to fit its content has nothing to
 * scroll and should let the board have the event, and an overflowing element
 * that clips (`hidden`) never scrolls no matter how tall its content is.
 */
export function consumesWheel(m: ScrollMetrics): boolean {
  const scrollable = (overflow: string) =>
    overflow === 'auto' || overflow === 'scroll';
  return (
    (scrollable(m.overflowY) && m.scrollHeight > m.clientHeight) ||
    (scrollable(m.overflowX) && m.scrollWidth > m.clientWidth)
  );
}

/**
 * Whether the wheel is over something inside `root` that can genuinely scroll —
 * the graph panel's expression list, a long document list. That element owns
 * the event and the board must not steal it.
 */
function overScrollableContent(
  target: EventTarget | null,
  root: HTMLElement,
): boolean {
  let el = target instanceof HTMLElement ? target : null;
  while (el) {
    const style = getComputedStyle(el);
    if (
      consumesWheel({
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      })
    ) {
      return true;
    }
    if (el === root) return false;
    el = el.parentElement;
  }
  return false;
}

/**
 * Let the wheel reach the board through floating UI.
 *
 * The toolbar, board chrome and tool panels are siblings of the canvas, not
 * descendants, so `useWheel`'s listener on the canvas never sees a wheel that
 * starts over them — scrolling with the pointer a few pixels off the board
 * simply did nothing. This forwards those events: anything that is not over
 * real scrollable content is cancelled and re-dispatched as an identical
 * `WheelEvent` on `[data-canvas-surface]`, where the canvas handles it as a
 * normal pan or zoom.
 *
 * The copy carries the original `clientX`/`clientY`, so a ctrl+wheel zoom stays
 * anchored under the pointer rather than jumping to the board's center.
 */
export function usePassThroughWheelEvents(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (forwarded.has(e)) return;
      if (overScrollableContent(e.target, el)) return;
      const surface =
        document.querySelector<HTMLElement>('[data-canvas-surface]');
      if (!surface) return;
      // Must precede the dispatch: the canvas relies on the page not scrolling
      // out from under it, and only the original event is cancelable here.
      e.preventDefault();
      // A `WheelEvent` init dictionary reads its members off the source event's
      // prototype accessors, so this clones the deltas, modifiers and pointer
      // position without restating them.
      const copy = new WheelEvent('wheel', e);
      forwarded.add(copy);
      surface.dispatchEvent(copy);
    };

    // Non-passive: the handler cancels the event to stop the page scrolling.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
