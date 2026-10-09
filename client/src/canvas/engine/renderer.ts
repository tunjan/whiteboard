import type { ComponentType } from 'react';

/**
 * The seam between the scene and the thing that draws it.
 *
 * A renderer owns the committed shape scene and nothing else. Screen-space
 * overlays — selection, hover, comments, laser, live ink, the editors — stay in
 * React above it: they are already drawn in viewport coordinates and would not
 * change shape under a different rasterizer.
 *
 * `CanvasScene` is the shared contract, and a renderer subscribes to it
 * directly, so the port carries no `upsert`, `remove`, or `setCamera`. Picking
 * is absent for the same reason: `engine/hit-test` runs on model geometry and
 * never reads rendered output, so it serves every implementation unchanged.
 *
 * The port is a component rather than an imperative `mount(host)` because shape
 * content reads app stores through hooks — a nested React root would lose that
 * context and change StrictMode semantics. Implementations still do their real
 * work imperatively inside layout effects, as `FlatShapeLayer` does today.
 */
export interface ShapeRendererProps {
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export interface ShapeRenderer {
  /** The implementation also publishes this as `data-canvas-engine`. */
  readonly id: string;
  readonly Component: ComponentType<ShapeRendererProps>;
}
