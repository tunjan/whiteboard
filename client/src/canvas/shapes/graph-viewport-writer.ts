import type { GraphViewport } from '@whiteboard/shared';
import { editor } from '../use-document-store';

export interface GraphViewportWriter {
  readonly shapeId: string;
  /**
   * Apply `edit` on top of any viewport not yet written, so several input
   * events within one frame compose. Written on the next animation frame.
   */
  update(edit: (viewport: GraphViewport) => GraphViewport): void;
  /** Write whatever is pending now, and cancel the scheduled frame. */
  flush(): void;
}

/**
 * Coalesce a gesture's viewport edits into one document write per frame.
 *
 * Wheel and pinch events outrun frames — a trackpad emits well over 100 a
 * second, and each one written straight through is a shape update the CRDT
 * keeps and every peer receives. `onCommit` runs after each write, for callers
 * that manage their own undo grouping.
 */
export function createGraphViewportWriter(
  shapeId: string,
  onCommit?: () => void,
): GraphViewportWriter {
  let pending: GraphViewport | null = null;
  let frame = 0;

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pending) return;
    editor.updateShape(shapeId, { props: { viewport: pending } });
    pending = null;
    onCommit?.();
  };

  return {
    shapeId,
    update(edit) {
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== 'graph') return;
      pending = edit(pending ?? shape.props.viewport);
      if (!frame) frame = requestAnimationFrame(flush);
    },
    flush,
  };
}
