import type { Shape } from '@whiteboard/shared';

/**
 * A partial update to a shape. `props` is a shallow merge into the shape's
 * typed prop bag (loosely typed here; call sites pass the right shape's props).
 */
export type ShapePatch = Partial<
  Pick<
    Shape,
    'x' | 'y' | 'rotation' | 'index' | 'parentId' | 'locked' | 'hidden' | 'opacity'
  >
> & {
  props?: Record<string, unknown>;
};

/**
 * The central document API that tools and the canvas mutate through. Every
 * content change flows through here so it can later be backed by the CRDT
 * (Phase 14+) with undo/redo, without tools changing.
 *
 * This interface grows additively as features land (selection, z-order, ...).
 */
export interface Editor {
  getShape(id: string): Shape | undefined;
  /** Shapes on the current page, in ascending z-order. */
  getShapes(): Shape[];
  createShape(shape: Shape): void;
  updateShape(id: string, patch: ShapePatch): void;
  deleteShapes(ids: string[]): void;
}
