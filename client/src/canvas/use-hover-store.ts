import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';
import { selectionTargetId } from './hierarchy';
import { SHAPE_HIT_SCREEN, topmostHit } from './tools/select-tool';
import { useCameraStore } from './use-camera-store';
import { editor } from './use-document-store';
import { useEnteredGroupStore } from './use-entered-group-store';

interface HoverStore {
  /**
   * The shape a click would select right now, or null. Not the shape under the
   * pointer: a child of a group resolves to the group, because that is what the
   * click would catch.
   */
  hoveredId: string | null;
}

/**
 * What the select tool is pointing at.
 *
 * A thin stroke is a few pixels wide at any zoom, and on a busy page there is
 * no way to tell from the cursor alone which of several overlapping shapes a
 * click is about to grab. So the picking question is asked on hover — through
 * the same {@link topmostHit} the click uses, so the two cannot disagree — and
 * the answer is outlined.
 *
 * The hit test is an R-tree lookup and costs nothing to repeat per pointer
 * move. What must not be repeated is the render: the id is written only when it
 * actually changes, so moving the pointer within one shape (or across empty
 * canvas) re-renders nothing.
 */
export const useHoverStore = create<HoverStore>(() => ({ hoveredId: null }));

function setHovered(hoveredId: string | null): void {
  if (useHoverStore.getState().hoveredId === hoveredId) return;
  useHoverStore.setState({ hoveredId });
}

/** Resolve and publish what is under `world`. */
export function updateHoverAt(world: Point): void {
  const zoom = useCameraStore.getState().camera.z;
  const hit = topmostHit(editor.getShapes(), world, SHAPE_HIT_SCREEN / zoom);
  setHovered(
    hit
      ? selectionTargetId(
          editor.getShape,
          hit,
          useEnteredGroupStore.getState().enteredGroupId,
        )
      : null,
  );
}

/** Forget the hover: the pointer left the canvas, or is busy doing something. */
export function clearHover(): void {
  setHovered(null);
}
