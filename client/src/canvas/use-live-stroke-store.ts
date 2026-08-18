import { create } from 'zustand';
import type { DrawPoint, DrawProps, Point } from '@whiteboard/shared';

/**
 * The stroke the local pointer is drawing right now.
 *
 * A live stroke is written to the document once per frame, exactly as before —
 * that is what makes peers watch it appear rather than see it land finished.
 * What changed is where the *local* picture of it comes from. Publishing it
 * through the document snapshot meant every frame of every stroke rebuilt the
 * canvas's derived state and reconciled a React tree the size of the page, to
 * move one path; and because those updates are scheduled rather than flushed,
 * the ink they produced could miss the frame it was computed for.
 *
 * So the shape id — which changes twice a stroke — goes through React, and the
 * geometry — which changes every frame — does not. {@link ActiveStrokeLayer}
 * registers a sink while it is mounted; {@link publishLiveStroke} calls it
 * synchronously from the draw tool's own rAF, so the DOM is right before the
 * browser paints.
 */

/** Everything the active-stroke layer needs to draw one frame of the stroke. */
export interface LiveStrokeFrame {
  /** World position the shape's local coordinates are relative to. */
  origin: Point;
  /** Style and dynamics. `points` on it is unused and may be stale. */
  props: DrawProps;
  /** The shape's own opacity, which the document copy would render it with. */
  opacity: number;
  /** Points committed to the document so far. Read, never retained or mutated. */
  points: DrawPoint[];
  /**
   * Browser-predicted tail past the last real sample, in the same local frame.
   * Drawn so the ink reaches where the pointer is about to be, and never
   * written to the document — peers only ever receive real samples.
   */
  predicted: DrawPoint[];
}

interface LiveStrokeStore {
  /** Id of the stroke being drawn locally, or null when idle. */
  shapeId: string | null;
}

export const useLiveStrokeStore = create<LiveStrokeStore>(() => ({
  shapeId: null,
}));

/** Subscribe to which shape (if any) the active-stroke layer owns. */
export function useLiveStrokeShapeId(): string | null {
  return useLiveStrokeStore((s) => s.shapeId);
}

/**
 * The same id, read without subscribing — for the document store, which checks
 * it on every shape mutation and must not re-render anything to do so.
 */
export function getLiveStrokeShapeId(): string | null {
  return useLiveStrokeStore.getState().shapeId;
}

type LiveStrokeSink = (frame: LiveStrokeFrame) => void;

let sink: LiveStrokeSink | null = null;
let currentFrame: LiveStrokeFrame | null = null;

/**
 * Install the active-stroke layer's imperative renderer; returns the teardown.
 * Only one layer is ever mounted — a second would mean a second canvas.
 */
export function setLiveStrokeSink(next: LiveStrokeSink): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

/**
 * The frame last published, for a layer that has just mounted.
 *
 * Opening a stroke and mounting the layer are one React commit, which lands a
 * frame or so after the tool started drawing, so the layer has to catch up to a
 * stroke already in progress rather than wait for the next pointer move.
 */
export function getLiveStrokeFrame(): LiveStrokeFrame | null {
  return currentFrame;
}

/**
 * Open a live stroke. Two things follow from this id being set: the canvas
 * stops rendering that shape from the document, and the document store stops
 * publishing snapshots for it. Both are the same statement — this layer owns
 * the shape now — so both read it from here rather than tracking it twice.
 */
export function beginLiveStroke(shapeId: string): void {
  currentFrame = null;
  useLiveStrokeStore.setState({ shapeId });
}

/** Draw a frame of the open stroke. Synchronous, and never re-renders React. */
export function publishLiveStroke(frame: LiveStrokeFrame): void {
  currentFrame = frame;
  sink?.(frame);
}

/**
 * Close the live stroke. Call it *before* writing the stroke's final state:
 * with the id cleared, that write publishes a snapshot like any other, and
 * React commits the un-filtered document copy and the unmounted layer together.
 *
 * The overlay is deliberately not cleared imperatively here. Doing so would
 * blank the ink now and restore it only on the commit that follows — one frame
 * with the stroke drawn by nobody.
 */
export function endLiveStroke(): void {
  currentFrame = null;
  if (useLiveStrokeStore.getState().shapeId !== null) {
    useLiveStrokeStore.setState({ shapeId: null });
  }
}
