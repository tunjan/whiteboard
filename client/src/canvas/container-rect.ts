import { useEffect, type RefObject } from 'react';

/**
 * The canvas container's viewport rectangle, read once per change instead of
 * once per pointer event.
 *
 * Every pointer sample has to be turned into container-relative coordinates,
 * and `getBoundingClientRect` is a forced synchronous layout — taken at the top
 * of a frame, right after the previous frame's shape mutations, which is the
 * worst moment to ask for one. `Canvas` paid it on every move and, whenever the
 * pen or eraser cursor was mounted, `useHoverCursor` paid it again on the same
 * event.
 *
 * The rectangle itself changes only when the container is resized or the page
 * is scrolled or zoomed, so it is cached and invalidated on exactly those
 * events. It is also invalidated on pointer-down, which costs one read per
 * gesture and guarantees that no gesture can be driven by a rectangle that went
 * stale for a reason not listed here.
 *
 * One canvas surface is mounted at a time — a second would mean a second board
 * — so the cache is a module singleton, like the live-stroke sink.
 */
let tracked: HTMLElement | null = null;
let cached: DOMRect | null = null;

/** Force the next read to measure again. */
export function invalidateContainerRect(): void {
  cached = null;
}

/**
 * The container's rectangle, measured only if the cache is cold or `el` is not
 * the tracked element. Callers that already hold a rect for this event should
 * pass it down rather than call this again.
 */
export function getContainerRect(el: HTMLElement): DOMRect;
export function getContainerRect(el: HTMLElement | null): DOMRect | undefined;
export function getContainerRect(el: HTMLElement | null): DOMRect | undefined {
  if (!el) return undefined;
  if (el !== tracked) return el.getBoundingClientRect();
  cached ??= el.getBoundingClientRect();
  return cached;
}

/**
 * Track `ref`'s element as the canvas container for the life of the component.
 *
 * `scroll` is captured because the listener is on `window`: a scroll in any
 * ancestor moves the container without bubbling. `visualViewport` covers the
 * mobile cases the window events miss — pinch-zooming the page itself, and the
 * on-screen keyboard shrinking the visual viewport under a fixed layout.
 */
export function useContainerRect(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    tracked = el;
    cached = null;

    const invalidate = invalidateContainerRect;
    const ro = new ResizeObserver(invalidate);
    ro.observe(el);
    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', invalidate, {
      capture: true,
      passive: true,
    });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', invalidate);
    vv?.addEventListener('scroll', invalidate);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('scroll', invalidate, { capture: true });
      vv?.removeEventListener('resize', invalidate);
      vv?.removeEventListener('scroll', invalidate);
      if (tracked === el) {
        tracked = null;
        cached = null;
      }
    };
  }, [ref]);
}
