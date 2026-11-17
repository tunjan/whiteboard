import type { Graph3dView, GraphViewport } from '@whiteboard/shared';
import { editor } from '../use-document-store';
import { fromPlotViewport, graphAxes, toPlotViewport } from '../graph-scale';

export interface GraphViewportWriter {
  readonly shapeId: string;
  /**
   * Apply `edit` on top of any viewport not yet written, so several input
   * events within one frame compose. Written on the next animation frame.
   * `edit` works in plot space, so pan and zoom on a log axis move by decades.
   */
  update(edit: (viewport: GraphViewport) => GraphViewport): void;
  /** Turn or zoom a 3D graph: `edit` sees its whole view and returns it. */
  update3d(edit: (view: Graph3dState) => Graph3dState): void;
  /** Write whatever is pending now, and cancel the scheduled frame. */
  flush(): void;
}

/** Where a 3D graph is looking: its x/y window and its angle and z range. */
export interface Graph3dState {
  viewport: GraphViewport;
  view3d: Graph3dView;
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
  let pending: Partial<Graph3dState> | null = null;
  let frame = 0;

  const flush = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!pending) return;
    editor.updateShape(shapeId, { props: pending });
    pending = null;
    onCommit?.();
  };
  const schedule = (next: Partial<Graph3dState>) => {
    pending = { ...pending, ...next };
    if (!frame) frame = requestAnimationFrame(flush);
  };

  return {
    shapeId,
    update(edit) {
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== 'graph') return;
      const axes = graphAxes(shape.props);
      const next = fromPlotViewport(
        edit(toPlotViewport(pending?.viewport ?? shape.props.viewport, axes)),
        axes,
      );
      // Zoomed out past 10^308 a log bound overflows; stop at the last window.
      if (!Object.values(next).every(Number.isFinite)) return;
      schedule({ viewport: next });
    },
    update3d(edit) {
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== 'graph') return;
      const view3d = pending?.view3d ?? shape.props.view3d;
      if (!view3d) return;
      const next = edit({ viewport: pending?.viewport ?? shape.props.viewport, view3d });
      const values = [...Object.values(next.viewport), next.view3d.zMin, next.view3d.zMax];
      if (!values.every(Number.isFinite)) return;
      schedule(next);
    },
    flush,
  };
}
