import { create } from 'zustand';
import type { DrawPoint } from '@whiteboard/shared';

/**
 * Predicted tail of the stroke being drawn locally, in shape-local
 * coordinates. Rendered after the shape's committed points so the visible ink
 * reaches the browser's predicted pointer position — cutting perceived input
 * lag — while the document (and therefore every peer) only ever receives real
 * samples. Cleared the moment the stroke finishes or is cancelled.
 */
interface StrokePredictionStore {
  /** Shape id of the in-progress local stroke, or null when idle. */
  shapeId: string | null;
  /** Predicted points, local to the shape's origin. Never persisted. */
  points: DrawPoint[];
  setPrediction: (shapeId: string, points: DrawPoint[]) => void;
  clearPrediction: () => void;
}

const EMPTY: DrawPoint[] = [];

export const useStrokePredictionStore = create<StrokePredictionStore>(
  (set) => ({
    shapeId: null,
    points: EMPTY,
    setPrediction: (shapeId, points) => set({ shapeId, points }),
    clearPrediction: () => set({ shapeId: null, points: EMPTY }),
  }),
);
