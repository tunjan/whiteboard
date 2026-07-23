import type { Bounds } from '@whiteboard/shared';

type BoundsListener = (bounds: Bounds) => void;

const zoomListeners = new Set<BoundsListener>();

/** Request a camera fit from UI that lives outside the Canvas component. */
export function requestCanvasZoomToBounds(bounds: Bounds): void {
  for (const listener of zoomListeners) listener(bounds);
}

export function subscribeCanvasZoomToBounds(
  listener: BoundsListener,
): () => void {
  zoomListeners.add(listener);
  return () => zoomListeners.delete(listener);
}
