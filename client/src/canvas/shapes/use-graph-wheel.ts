import { useEffect, useRef, type RefObject } from 'react';
import type { GraphShape } from '@whiteboard/shared';
import { breakUndoCapture, editor } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import { normalizeWheelDelta } from '../use-wheel';
import {
  createGraphViewportWriter,
  type GraphViewportWriter,
} from './graph-viewport-writer';

// Wheel-zoom feel, mirrored from the board camera (use-wheel.ts).
const WHEEL_MAX_ZOOM_DELTA = 10;
// Continuous wheel gestures coalesce into one undo step until this idle gap.
const WHEEL_UNDO_IDLE_MS = 300;

export interface GraphWheel {
  event: WheelEvent;
  /** Normalised wheel travel, in screen pixels. */
  delta: { x: number; y: number };
  /**
   * With Ctrl/⌘ held (a trackpad pinch reports as that too), what to scale
   * the visible range by: below 1 zooms in. Null for a plain wheel.
   */
  zoom: number | null;
  shape: GraphShape;
  element: SVGGElement;
  writer: GraphViewportWriter;
}

/**
 * While the graph is the sole selection, the wheel drives its view instead of
 * the board camera. stopPropagation keeps the canvas's own native wheel
 * listener (which moves the camera) from also firing. Writes coalesce to one
 * per frame, and a continuous gesture is one undo step.
 */
export function useGraphWheel(
  target: RefObject<SVGGElement | null>,
  shapeId: string,
  onWheel: (wheel: GraphWheel) => void,
): void {
  // The latest handler, read at event time, so re-renders don't re-subscribe.
  const handler = useRef(onWheel);
  handler.current = onWheel;

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let undoTimer: number | null = null;
    const writer = createGraphViewportWriter(shapeId, () => {
      if (undoTimer !== null) window.clearTimeout(undoTimer);
      undoTimer = window.setTimeout(() => {
        undoTimer = null;
        breakUndoCapture();
      }, WHEEL_UNDO_IDLE_MS);
    });
    const listener = (event: WheelEvent) => {
      const selected = useSelectionStore.getState().selectedIds;
      if (selected.length !== 1 || selected[0] !== shapeId) return;
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== 'graph') return;
      event.preventDefault();
      event.stopPropagation();
      const delta = normalizeWheelDelta(event);
      let zoom: number | null = null;
      if (event.ctrlKey || event.metaKey) {
        const step = Math.min(WHEEL_MAX_ZOOM_DELTA, Math.max(-WHEEL_MAX_ZOOM_DELTA, delta.y));
        // Match the camera direction: scroll up = zoom in = smaller range.
        zoom = 1 / (1 - step / 100);
      }
      handler.current({ event, delta, zoom, shape, element, writer });
    };
    element.addEventListener('wheel', listener, { passive: false });
    return () => {
      element.removeEventListener('wheel', listener);
      // Don't strand the tail of a gesture that ended on unmount.
      writer.flush();
      if (undoTimer !== null) {
        window.clearTimeout(undoTimer);
        // The gesture is over for good, so close its undo step now rather
        // than letting the next unrelated edit join it.
        breakUndoCapture();
      }
    };
  }, [target, shapeId]);
}
