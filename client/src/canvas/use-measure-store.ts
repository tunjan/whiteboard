import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';

/**
 * The measure tool's one dimension line, in world coordinates. Local and
 * transient: never in the document, never sent to peers.
 */
export const useMeasureStore = create<{
  span: { a: Point; b: Point } | null;
  set: (a: Point, b: Point) => void;
  clear: () => void;
}>((set) => ({
  span: null,
  set: (a, b) => set({ span: { a, b } }),
  clear: () => set({ span: null }),
}));
