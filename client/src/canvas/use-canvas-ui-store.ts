import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackgroundType } from './grid';
import { DEFAULT_PENCIL_STABILIZATION } from './shapes/ink';

interface CanvasUiStore {
  background: BackgroundType;
  /** Pencil stabilization strength from 0..1 for newly drawn strokes. */
  pencilStabilization: number;
  setBackground: (background: BackgroundType) => void;
  setPencilStabilization: (pencilStabilization: number) => void;
}

// Local, per-user canvas UI preferences. Moves into the Settings dialog in
// Phase 23; for now a small persisted store.
export const useCanvasUiStore = create<CanvasUiStore>()(
  persist(
    (set) => ({
      background: 'graph',
      pencilStabilization: DEFAULT_PENCIL_STABILIZATION,
      setBackground: (background) => set({ background }),
      setPencilStabilization: (pencilStabilization) =>
        set({ pencilStabilization }),
    }),
    { name: 'whiteboard:canvas-ui' },
  ),
);
