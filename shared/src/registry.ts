import type { Bounds, Point } from './geometry';
import type { ShapeMap, ShapeType } from './shapes/shapes';

/**
 * Pure, framework-agnostic behavior for a shape type. The client extends this
 * with a React renderer (`ShapeUtil`), but everything here is non-visual so it
 * can run on the server or headless (e.g. export, hit-testing, culling).
 *
 * Adding a shape type = implementing one of these + a renderer and registering
 * it. The core canvas iterates the registry and knows nothing about specifics.
 */
export interface ShapeDefinition<T extends ShapeType = ShapeType> {
  readonly type: T;

  /** Default props applied when a tool creates this shape. */
  getDefaultProps(): ShapeMap[T]['props'];

  /** Axis-aligned world bounds of the shape, ignoring its rotation. */
  getBounds(shape: ShapeMap[T]): Bounds;

  /**
   * Hit test a world-space point against the shape. `tolerance` is a world
   * distance (scaled from a screen-pixel threshold by the caller) so thin
   * shapes stay clickable at any zoom.
   */
  hitTest(shape: ShapeMap[T], point: Point, tolerance: number): boolean;

  /** Whether the selection tool offers resize handles for this shape. */
  readonly canResize: boolean;

  /**
   * Fit the shape into a new axis-aligned (unrotated) world bounds. The
   * selection tool computes `newBounds` (already corrected for the shape's
   * rotation so the opposite handle stays put); each shape scales its own
   * geometry. Rotation is preserved by the caller.
   */
  resize(
    initial: ShapeMap[T],
    newBounds: Bounds,
  ): { x: number; y: number; props: ShapeMap[T]['props'] };
}
