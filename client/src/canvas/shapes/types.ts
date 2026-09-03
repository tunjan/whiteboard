import type { ReactElement } from 'react';
import type {
  Point,
  Shape,
  ShapeDefinition,
  ShapeMap,
  ShapeType,
} from '@whiteboard/shared';

export interface ShapeComponentProps<T extends ShapeType> {
  shape: ShapeMap[T];
  /** True while this shape is selected (affects nothing rendered by the shape
   * itself, but available for shape-specific affordances later). */
  isSelected?: boolean;
}

/**
 * A draggable affordance specific to a shape (e.g. a line's endpoints or its
 * curve bend), in world coordinates. When a shape exposes handles the selection
 * tool offers them instead of the generic resize/rotate box.
 */
export interface ShapeHandle {
  id: string;
  kind: 'vertex' | 'bend' | 'create' | 'route';
  point: Point;
}

/** Result of dragging a {@link ShapeHandle}: a partial shape update. */
export interface HandleDragResult<T extends ShapeType> {
  x?: number;
  y?: number;
  props?: Partial<ShapeMap[T]['props']>;
}

/**
 * Client-side shape implementation: the pure behavior from the shared
 * {@link ShapeDefinition} plus a React SVG renderer.
 *
 * The renderer must be **pure** (no hooks, no side effects) so the same code
 * can render headlessly for PNG/PDF export later.
 */
export interface ShapeUtil<
  T extends ShapeType = ShapeType,
> extends ShapeDefinition<T> {
  Component: (props: ShapeComponentProps<T>) => ReactElement | null;

  /** Whether this geometry may be used as a snap target. Defaults to true. */
  readonly canSnap?: boolean;

  /** Optional page-space feature points for bounds alignment snapping. */
  getBoundsSnapPoints?(shape: ShapeMap[T]): Point[];

  /**
   * Custom drag handles (in world space). When present, the selection tool
   * shows these and suppresses the generic resize/rotate box.
   */
  getHandles?(shape: ShapeMap[T]): ShapeHandle[];

  /**
   * The shape's own outline, as SVG path data in shape-local coordinates plus
   * the transform that places it in world space — the same pair the renderer
   * draws with, so the two cannot drift apart.
   *
   * Shapes that return one are *traced* by the selection layer instead of being
   * boxed. A rectangle around an open curve is mostly empty space: it says
   * nothing about where the ink is, and it hides whatever it covers.
   */
  getIndicatorPath?(
    shape: ShapeMap[T],
  ): { d: string; transform: string } | null;

  /** Apply a drag of the handle `handleId` to the world point `point`. */
  onHandleDrag?(
    shape: ShapeMap[T],
    handleId: string,
    point: Point,
    opts: { shiftKey: boolean; bindingTarget?: Shape },
  ): HandleDragResult<T>;
}
