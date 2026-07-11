import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackgroundType } from './grid';
import {
  DEFAULT_PENCIL_DYNAMICS,
  DEFAULT_PENCIL_STABILIZATION,
} from './shapes/ink';

interface CanvasUiStore {
  background: BackgroundType;
  /** Pencil stabilization strength from 0..1 for newly drawn strokes. */
  pencilStabilization: number;
  /** Pressure-to-width multiplier (-1..1) for newly drawn strokes. */
  pencilThinning: number;
  /** Outline softening (0..1) for newly drawn strokes. */
  pencilSmoothing: number;
  /**
   * Whether non-pen pointers (mouse/touch) derive pressure from velocity.
   * Real pens always use hardware pressure regardless of this preference.
   */
  pencilSimulatePressure: boolean;
  /** Taper distance (px) at the start of newly drawn strokes. */
  pencilStartTaper: number;
  /** Whether newly drawn strokes taper to a point at the end. */
  pencilEndTaper: boolean;
  /** Whether the on-canvas performance overlay (FPS/frame time) is shown. */
  debugPerformance: boolean;
  setBackground: (background: BackgroundType) => void;
  setPencilStabilization: (pencilStabilization: number) => void;
  setPencilThinning: (pencilThinning: number) => void;
  setPencilSmoothing: (pencilSmoothing: number) => void;
  setPencilSimulatePressure: (pencilSimulatePressure: boolean) => void;
  setPencilStartTaper: (pencilStartTaper: number) => void;
  setPencilEndTaper: (pencilEndTaper: boolean) => void;
  setDebugPerformance: (debugPerformance: boolean) => void;
  resetPencil: () => void;
}

const PENCIL_DEFAULTS = {
  pencilStabilization: DEFAULT_PENCIL_STABILIZATION,
  pencilThinning: DEFAULT_PENCIL_DYNAMICS.thinning,
  pencilSmoothing: DEFAULT_PENCIL_DYNAMICS.smoothing,
  pencilSimulatePressure: DEFAULT_PENCIL_DYNAMICS.simulatePressure,
  pencilStartTaper: 0,
  pencilEndTaper: DEFAULT_PENCIL_DYNAMICS.endTaper,
} as const;

// The previous release made every mouse/touch stroke behave like a pressure
// brush, including a pointed finish. Only replace that exact untouched preset;
// any person who changed one of the controls keeps their chosen configuration.
const PREVIOUS_PENCIL_DEFAULTS = {
  pencilThinning: 0.5,
  pencilSmoothing: 0.5,
  pencilSimulatePressure: true,
  pencilStartTaper: 0,
  pencilEndTaper: true,
} as const;

function migratePencilDefaults(persistedState: unknown): CanvasUiStore {
  const state = persistedState as Partial<CanvasUiStore>;
  const isUnchangedBrushPreset =
    state.pencilThinning === PREVIOUS_PENCIL_DEFAULTS.pencilThinning &&
    state.pencilSmoothing === PREVIOUS_PENCIL_DEFAULTS.pencilSmoothing &&
    state.pencilSimulatePressure ===
      PREVIOUS_PENCIL_DEFAULTS.pencilSimulatePressure &&
    state.pencilStartTaper === PREVIOUS_PENCIL_DEFAULTS.pencilStartTaper &&
    state.pencilEndTaper === PREVIOUS_PENCIL_DEFAULTS.pencilEndTaper;

  return (isUnchangedBrushPreset
    ? { ...state, ...PENCIL_DEFAULTS }
    : state) as CanvasUiStore;
}

// Local, per-user canvas UI preferences. Moves into the Settings dialog in
// Phase 23; for now a small persisted store.
export const useCanvasUiStore = create<CanvasUiStore>()(
  persist(
    (set) => ({
      background: 'graph',
      debugPerformance: false,
      ...PENCIL_DEFAULTS,
      setBackground: (background) => set({ background }),
      setPencilStabilization: (pencilStabilization) =>
        set({ pencilStabilization }),
      setPencilThinning: (pencilThinning) => set({ pencilThinning }),
      setPencilSmoothing: (pencilSmoothing) => set({ pencilSmoothing }),
      setPencilSimulatePressure: (pencilSimulatePressure) =>
        set({ pencilSimulatePressure }),
      setPencilStartTaper: (pencilStartTaper) => set({ pencilStartTaper }),
      setPencilEndTaper: (pencilEndTaper) => set({ pencilEndTaper }),
      setDebugPerformance: (debugPerformance) => set({ debugPerformance }),
      resetPencil: () => set({ ...PENCIL_DEFAULTS }),
    }),
    {
      name: 'whiteboard:canvas-ui',
      version: 1,
      migrate: migratePencilDefaults,
    },
  ),
);
