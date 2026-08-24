import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackgroundType } from './grid';
import {
  DEFAULT_PENCIL_DYNAMICS,
  DEFAULT_PENCIL_STABILIZATION,
} from './shapes/ink';

/**
 * How the eraser treats what it sweeps over. `object` removes a whole shape the
 * moment the swipe touches it; `precision` cuts pen strokes and lines where the
 * swipe actually crosses them and keeps the surviving pieces. Shapes that have no
 * meaningful half — boxes, text, arrows, polygons — are removed whole in both.
 */
export type EraserMode = 'object' | 'precision';

interface CanvasUiStore {
  background: BackgroundType;
  /** Whether shape alignment, spacing, resize, and handle snapping is active. */
  snappingEnabled: boolean;
  /** Whether the eraser removes whole shapes or cuts through ink. */
  eraserMode: EraserMode;
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
  /**
   * Whether the live stroke is drawn out to the browser's predicted pointer
   * position, ahead of the last real sample.
   *
   * Off by default. Prediction is extrapolation: it buys back about a frame of
   * the latency between the hand and the ink, and pays for it with a tip that
   * can lead the hand into a turn and then correct itself. Which of the two is
   * more distracting is a matter of taste and of hardware, so it is a choice
   * rather than a default. Local render only — the tail is never written to the
   * document, so this preference cannot change what peers or the board receive.
   */
  pencilPrediction: boolean;
  /** Whether the on-canvas performance overlay (FPS/frame time) is shown. */
  debugPerformance: boolean;
  /**
   * Resolution multiplier for exported and copied PNGs, in raster pixels per
   * board unit. PNG is lossless, so this — not a compression quality — is the
   * only thing that trades file size against sharpness.
   */
  pngExportScale: number;
  setBackground: (background: BackgroundType) => void;
  setSnappingEnabled: (snappingEnabled: boolean) => void;
  setEraserMode: (eraserMode: EraserMode) => void;
  setPencilStabilization: (pencilStabilization: number) => void;
  setPencilThinning: (pencilThinning: number) => void;
  setPencilSmoothing: (pencilSmoothing: number) => void;
  setPencilSimulatePressure: (pencilSimulatePressure: boolean) => void;
  setPencilStartTaper: (pencilStartTaper: number) => void;
  setPencilEndTaper: (pencilEndTaper: boolean) => void;
  setPencilPrediction: (pencilPrediction: boolean) => void;
  setDebugPerformance: (debugPerformance: boolean) => void;
  setPngExportScale: (pngExportScale: number) => void;
  resetPencil: () => void;
}

/** Offered PNG export resolutions, as a multiplier of the board's own units. */
export const PNG_EXPORT_SCALES = [1, 2, 3, 4] as const;
/** Matches the 2x cap the export used to derive from `devicePixelRatio`. */
export const DEFAULT_PNG_EXPORT_SCALE = 2;

const PENCIL_DEFAULTS = {
  pencilStabilization: DEFAULT_PENCIL_STABILIZATION,
  pencilThinning: DEFAULT_PENCIL_DYNAMICS.thinning,
  pencilSmoothing: DEFAULT_PENCIL_DYNAMICS.smoothing,
  pencilSimulatePressure: DEFAULT_PENCIL_DYNAMICS.simulatePressure,
  pencilStartTaper: 0,
  pencilEndTaper: DEFAULT_PENCIL_DYNAMICS.endTaper,
  pencilPrediction: false,
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

function migrateCanvasUiStore(persistedState: unknown): CanvasUiStore {
  const state = persistedState as Partial<CanvasUiStore>;
  const isUnchangedBrushPreset =
    state.pencilThinning === PREVIOUS_PENCIL_DEFAULTS.pencilThinning &&
    state.pencilSmoothing === PREVIOUS_PENCIL_DEFAULTS.pencilSmoothing &&
    state.pencilSimulatePressure ===
      PREVIOUS_PENCIL_DEFAULTS.pencilSimulatePressure &&
    state.pencilStartTaper === PREVIOUS_PENCIL_DEFAULTS.pencilStartTaper &&
    state.pencilEndTaper === PREVIOUS_PENCIL_DEFAULTS.pencilEndTaper;

  return {
    snappingEnabled: true,
    ...(isUnchangedBrushPreset
      ? { ...state, ...PENCIL_DEFAULTS }
      : state),
  } as CanvasUiStore;
}

// Local, per-user canvas UI preferences shown in the Settings dialog.
export const useCanvasUiStore = create<CanvasUiStore>()(
  persist(
    (set) => ({
      background: 'graph',
      snappingEnabled: true,
      eraserMode: 'object',
      debugPerformance: false,
      pngExportScale: DEFAULT_PNG_EXPORT_SCALE,
      ...PENCIL_DEFAULTS,
      setBackground: (background) => set({ background }),
      setSnappingEnabled: (snappingEnabled) => set({ snappingEnabled }),
      setEraserMode: (eraserMode) => set({ eraserMode }),
      setPencilStabilization: (pencilStabilization) =>
        set({ pencilStabilization }),
      setPencilThinning: (pencilThinning) => set({ pencilThinning }),
      setPencilSmoothing: (pencilSmoothing) => set({ pencilSmoothing }),
      setPencilSimulatePressure: (pencilSimulatePressure) =>
        set({ pencilSimulatePressure }),
      setPencilStartTaper: (pencilStartTaper) => set({ pencilStartTaper }),
      setPencilEndTaper: (pencilEndTaper) => set({ pencilEndTaper }),
      setPencilPrediction: (pencilPrediction) => set({ pencilPrediction }),
      setDebugPerformance: (debugPerformance) => set({ debugPerformance }),
      setPngExportScale: (pngExportScale) => set({ pngExportScale }),
      resetPencil: () => set({ ...PENCIL_DEFAULTS }),
    }),
    {
      name: 'whiteboard:canvas-ui',
      version: 2,
      migrate: migrateCanvasUiStore,
    },
  ),
);
