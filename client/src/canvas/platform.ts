// Platform sniffing, kept in one place because the two facts below change
// *input semantics*, not styling: what a modifier key means on a wheel event,
// and which of two overlapping pinch event families a browser fires.

function ua(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

/**
 * macOS or iOS. On Apple platforms the OS already maps a horizontal trackpad
 * swipe (and Shift + wheel) to `deltaX`, so emulating it a second time would
 * double the pan.
 */
export function isDarwin(): boolean {
  if (typeof navigator === 'undefined') return false;
  // `navigator.platform` is deprecated but still the only reliable signal on
  // Safari, whose UA string says "Macintosh" for iPads too.
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || ua());
}

/**
 * iOS/iPadOS Safari. It fires **both** `TouchEvent` and the proprietary
 * `GestureEvent` for one pinch; honouring both applies the zoom twice.
 * iPadOS reports a desktop UA, so the touch-point count is the tell.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(ua())) return true;
  return /Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1;
}

/**
 * The primary pointer cannot hover and lands blunt — a finger, mostly.
 *
 * Selection controls change shape for it rather than just growing: an
 * invisible target is undiscoverable without hover, and four of them around a
 * small box would leave nothing of the box to grab.
 */
let coarseQuery: MediaQueryList | null | undefined;
export function isCoarsePointer(): boolean {
  if (coarseQuery === undefined) {
    coarseQuery =
      typeof window === 'undefined' || !window.matchMedia
        ? null
        : window.matchMedia('(pointer: coarse)');
  }
  return coarseQuery?.matches ?? false;
}
