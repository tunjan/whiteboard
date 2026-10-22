import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BackgroundType } from './grid';
import type { RasterCacheMode } from './raster-grid';
import type { FingerAction } from './touch-input';
import {
  DEFAULT_PENCIL_DYNAMICS,
  DEFAULT_PENCIL_STABILIZATION,
  REFERENCE_PENCIL_DYNAMICS,
  type EndTaperMode,
  type PencilPressureCurve,
} from './shapes/ink';

/**
 * How the eraser treats what it sweeps over. `object` removes a whole shape the
 * moment the swipe touches it; `precision` cuts pen strokes and lines where the
 * swipe actually crosses them and keeps the surviving pieces. Shapes that have no
 * meaningful half — boxes, text, arrows, polygons — are removed whole in both.
 */
export type EraserMode = 'object' | 'precision';

/**
 * Which implementation draws the committed shapes — see `shape-renderer.ts`.
 *
 * Spelled out here rather than imported from the renderer table: the table
 * imports both layers, and a preference store that pulled them in would make
 * every consumer of a checkbox depend on the whole canvas.
 */
export type ShapeRendererChoice = 'auto' | 'dom-svg' | 'canvas-2d';

/** Where the tool bar docks: a row along the bottom, or a rail down the left. */
export type ToolbarPlacement = 'bottom' | 'left';

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
  /**
   * How newly drawn strokes finish: a round cap, a taper the lift has to earn
   * by being a flick, or the pointed brush finish over the whole stroke.
   */
  pencilEndTaper: EndTaperMode;
  /**
   * How much force it takes to reach a given width. Inert on a pointer with no
   * pressure signal at all, which draws one width whatever this says.
   */
  pencilPressureCurve: PencilPressureCurve;
  /**
   * How strongly a leaning stylus broadens the nib, 0..1. Reads a hardware
   * channel only a stylus has, so it does nothing for a mouse or a finger.
   */
  pencilTilt: number;
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
  /**
   * What one finger on the glass does — see {@link FingerAction}. The tablet
   * counterpart of the pen settings above: those shape the stroke a stylus
   * lays down, this decides whether a finger is allowed to lay one at all.
   */
  fingerAction: FingerAction;
  /**
   * Whether a stylus has ever been used on this device. Written by the canvas
   * the first time a `pen` pointer arrives, and read only by `fingerAction`'s
   * `auto`, which has nothing else to go on: a tablet reports the same coarse
   * pointer whether or not its owner has a Pencil.
   */
  penSeen: boolean;
  /**
   * Whether a mouse wheel scrolls the board the opposite way.
   *
   * Applies to a wheel and nothing else: a trackpad's two-finger scroll already
   * follows the system's own natural-scrolling setting, and reversing it here
   * would fight that setting and its inertia. `wheelPointerProfile` decides
   * which events count.
   */
  invertScroll: boolean;
  /**
   * Whether the spatial overview of the page is shown in the corner.
   *
   * Off until asked for. It is the largest object the board's chrome can put
   * on the screen and it answers a question — where am I on the page — that
   * only comes up on a page big enough to get lost on. Shown by default it
   * outweighed the drawing it was a map of.
   */
  minimapVisible: boolean;
  /**
   * Where the tool bar docks. The left rail gives a widescreen board back its
   * bottom edge, where students write, at the cost of height it rarely needs.
   */
  toolbarPlacement: ToolbarPlacement;
  /** Whether the on-canvas performance overlay (FPS/frame time) is shown. */
  debugPerformance: boolean;
  /**
   * Which renderer draws the committed shapes. Changing it remounts the shape
   * layer — the scene's signal graph is rebuilt from the document, exactly as
   * a page switch does — so it is a preference, not a per-frame setting.
   *
   * `?renderer=` still wins over it, so a link can pin one implementation for
   * an A/B without disturbing whatever the person on the other end prefers.
   * `auto` picks by page size — see `AUTO_CANVAS_2D_SHAPES`.
   */
  shapeRenderer: ShapeRendererChoice;
  /**
   * Whether the DOM/SVG layer caches the shape tree into raster tiles.
   * `auto` is the measured gate — Firefox, on a scene with something in it —
   * and the two explicit values are for looking at the difference on one
   * machine. Inert under the Canvas2D renderer, which has no SVG to cache.
   */
  rasterCache: RasterCacheMode;
  /**
   * Whether to drop the chrome's decoration on a machine that cannot spare it.
   * The `backdrop-filter` under the toolbar and the four corner HUDs used to
   * be the whole of this setting and is now gone from the stylesheet outright
   * — it re-read and re-blurred the board on every frame of a pan or a zoom,
   * about twenty points of GPU. What is left is the glass layer's own
   * ornament: with this on, the toolbar's sheen and bevel planes are dropped
   * and its capsules fall back to a plain opaque surface.
   */
  lowGraphics: boolean;
  /**
   * Whether the grid fades out toward the screen edges, the way it does on the
   * loading veil. Off by default: at the edges it hides the grid you might be
   * lining something up against.
   */
  groundFade: boolean;
  /**
   * Whether the tutor is shown when a student stops paying attention. Tutor-only
   * in effect: every client publishes its own attention facts, but nothing is
   * rendered except in a tutor's participant list and toasts.
   */
  attentionAlertsEnabled: boolean;
  /** Seconds without input before a present student reads as idle. */
  attentionIdleSeconds: number;
  /** Seconds in another window before a student reads as away. */
  attentionAwaySeconds: number;
  /**
   * Most pages one pasted PDF may place on the board at once. A longer document
   * asks which range to import instead of refusing outright.
   *
   * Tutor-only in the sense the attention thresholds are: this is a local
   * preference, and only a tutor is shown the control. A student pasting a PDF
   * gets the default and no way to raise it.
   */
  pdfPageLimit: number;
  /**
   * Resolution multiplier for exported and copied PNGs, in raster pixels per
   * board unit. PNG is lossless, so this — not a compression quality — is the
   * only thing that trades file size against sharpness.
   */
  pngExportScale: number;
  setBackground: (background: BackgroundType) => void;
  setMinimapVisible: (minimapVisible: boolean) => void;
  setToolbarPlacement: (toolbarPlacement: ToolbarPlacement) => void;
  setGroundFade: (groundFade: boolean) => void;
  setInvertScroll: (invertScroll: boolean) => void;
  setSnappingEnabled: (snappingEnabled: boolean) => void;
  setEraserMode: (eraserMode: EraserMode) => void;
  setPencilStabilization: (pencilStabilization: number) => void;
  setPencilThinning: (pencilThinning: number) => void;
  setPencilSmoothing: (pencilSmoothing: number) => void;
  setPencilSimulatePressure: (pencilSimulatePressure: boolean) => void;
  setPencilStartTaper: (pencilStartTaper: number) => void;
  setPencilEndTaper: (pencilEndTaper: EndTaperMode) => void;
  setPencilPressureCurve: (pencilPressureCurve: PencilPressureCurve) => void;
  setPencilTilt: (pencilTilt: number) => void;
  setPencilPrediction: (pencilPrediction: boolean) => void;
  setFingerAction: (fingerAction: FingerAction) => void;
  /** Record that a stylus has been used here. Idempotent, called per stroke. */
  notePenSeen: () => void;
  setDebugPerformance: (debugPerformance: boolean) => void;
  setShapeRenderer: (shapeRenderer: ShapeRendererChoice) => void;
  setRasterCache: (rasterCache: RasterCacheMode) => void;
  setLowGraphics: (lowGraphics: boolean) => void;
  setAttentionAlertsEnabled: (attentionAlertsEnabled: boolean) => void;
  setAttentionIdleSeconds: (attentionIdleSeconds: number) => void;
  setAttentionAwaySeconds: (attentionAwaySeconds: number) => void;
  setPdfPageLimit: (pdfPageLimit: number) => void;
  setPngExportScale: (pngExportScale: number) => void;
  resetPencil: () => void;
}

/**
 * Bounds for the attention thresholds. Idle starts high because a student
 * working something out on paper is still in the lesson; away starts low
 * because switching windows is unambiguous, but not so low that a glance at
 * another app trips it.
 */
export const ATTENTION_IDLE_RANGE = { min: 30, max: 300, step: 15 } as const;
export const ATTENTION_AWAY_RANGE = { min: 1, max: 120, step: 1 } as const;

/**
 * Bounds for the PDF import limit. Ten covers the worksheet and past-paper
 * extract this exists for; the ceiling is where rasterizing a document starts
 * to cost more than the board gains from having it inline.
 */
export const PDF_PAGE_LIMIT_RANGE = { min: 1, max: 50, step: 1 } as const;

/** Offered PNG export resolutions, as a multiplier of the board's own units. */
export const PNG_EXPORT_SCALES = [1, 2, 3, 4] as const;
/** Matches the 2x cap the export used to derive from `devicePixelRatio`. */
export const DEFAULT_PNG_EXPORT_SCALE = 2;

const PENCIL_DEFAULTS = {
  pencilStabilization: DEFAULT_PENCIL_STABILIZATION,
  pencilThinning: DEFAULT_PENCIL_DYNAMICS.thinning,
  pencilSmoothing: REFERENCE_PENCIL_DYNAMICS.smoothing,
  pencilSimulatePressure: REFERENCE_PENCIL_DYNAMICS.simulatePressure,
  pencilStartTaper: 0,
  // A lift that was still moving gets a taper and one that stopped does not,
  // which is what a nib does. The unconditional pointed finish is still on the
  // menu as `full`.
  pencilEndTaper: 'off',
  pencilPressureCurve: 'medium',
  pencilTilt: REFERENCE_PENCIL_DYNAMICS.tiltAmount,
  pencilPrediction: false,
} as const;

/**
 * Pen presets shipped as defaults by earlier releases.
 *
 * A stored preset that still matches one of these exactly was never touched,
 * and adopting the current defaults for it is how someone who has no opinion
 * about their pen gets the pen the release ships. Anyone who moved even one
 * control falls out of every entry here and keeps precisely what they chose —
 * which is the whole reason these are matched in full rather than field by
 * field.
 *
 * `brush` made every mouse and touch stroke a pressure brush with a pointed
 * finish; `rounded` replaced it with the predictable pencil that stops where
 * the pointer stops.
 */
const PREVIOUS_PENCIL_PRESETS = [
  {
    pencilThinning: 0.5,
    pencilSmoothing: 0.5,
    pencilSimulatePressure: false,
    pencilStartTaper: 0,
    pencilEndTaper: 'velocity',
    pencilStabilization: DEFAULT_PENCIL_STABILIZATION,
    pencilPressureCurve: 'medium',
    pencilTilt: 0.5,
    pencilPrediction: false,
  },
  {
    pencilThinning: 0.5,
    pencilSmoothing: 0.5,
    pencilSimulatePressure: true,
    pencilStartTaper: 0,
    pencilEndTaper: true,
  },
  {
    pencilThinning: DEFAULT_PENCIL_DYNAMICS.thinning,
    pencilSmoothing: DEFAULT_PENCIL_DYNAMICS.smoothing,
    pencilSimulatePressure: DEFAULT_PENCIL_DYNAMICS.simulatePressure,
    pencilStartTaper: 0,
    pencilEndTaper: false,
  },
] as const;

/**
 * `pencilEndTaper` was a switch before it was a mode. Read the old boolean as
 * the two positions it actually had — off, or the pointed finish over the
 * whole stroke — rather than as the new default, so nobody's pen changes shape
 * because the control it was set with grew a third option.
 */
function endTaperModeFrom(value: unknown): EndTaperMode {
  if (value === 'off' || value === 'velocity' || value === 'full') return value;
  return value === true ? 'full' : 'off';
}

/**
 * `dom-svg` was the only default before `auto` existed, so a saved `dom-svg` is
 * indistinguishable from never having opened the menu and moves to `auto`.
 * `canvas-2d` could only have been picked on purpose, so it stays.
 */
function shapeRendererFrom(value: unknown): ShapeRendererChoice | undefined {
  return value === 'canvas-2d' ? value : undefined;
}

function migrateCanvasUiStore(persistedState: unknown): CanvasUiStore {
  const { shapeRenderer, ...rest } = persistedState as Partial<CanvasUiStore>;
  const kept = shapeRendererFrom(shapeRenderer);
  const state: Partial<CanvasUiStore> = kept
    ? { ...rest, shapeRenderer: kept }
    : rest;
  const isUnchangedPreset = PREVIOUS_PENCIL_PRESETS.some(
    (preset) => Object.entries(preset).every(
      ([key, value]) => (state as Record<string, unknown>)[key] === value,
    ),
  );

  if (isUnchangedPreset) {
    return {
      snappingEnabled: true,
      ...state,
      ...PENCIL_DEFAULTS,
    } as CanvasUiStore;
  }
  // Keys added since this state was written are left absent rather than set to
  // `undefined`, so zustand's merge fills them from the initial state.
  return {
    snappingEnabled: true,
    ...state,
    ...('pencilEndTaper' in state
      ? { pencilEndTaper: endTaperModeFrom(state.pencilEndTaper) }
      : {}),
  } as CanvasUiStore;
}

/**
 * Mirror the preference onto the document root, where the stylesheet can see
 * it. It gates a CSS effect rather than a React one, so it has to be an
 * attribute and not a prop threaded to five call sites — the same reason the
 * theme is a class on `<html>` rather than context.
 */
export function applyLowGraphics(lowGraphics: boolean): void {
  document.documentElement.toggleAttribute('data-low-graphics', lowGraphics);
}

// Local, per-user canvas UI preferences shown in the Settings dialog.
export const useCanvasUiStore = create<CanvasUiStore>()(
  persist(
    (set) => ({
      background: 'graph',
      snappingEnabled: true,
      eraserMode: 'object',
      invertScroll: false,
      minimapVisible: false,
      toolbarPlacement: 'bottom',
      debugPerformance: false,
      shapeRenderer: 'auto',
      rasterCache: 'auto',
      lowGraphics: false,
      groundFade: false,
      attentionAlertsEnabled: true,
      attentionIdleSeconds: 90,
      attentionAwaySeconds: 15,
      pdfPageLimit: 10,
      pngExportScale: DEFAULT_PNG_EXPORT_SCALE,
      fingerAction: 'auto',
      penSeen: false,
      ...PENCIL_DEFAULTS,
      setBackground: (background) => set({ background }),
      setMinimapVisible: (minimapVisible) => set({ minimapVisible }),
      setToolbarPlacement: (toolbarPlacement) => set({ toolbarPlacement }),
      setGroundFade: (groundFade) => set({ groundFade }),
      setInvertScroll: (invertScroll) => set({ invertScroll }),
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
      setPencilPressureCurve: (pencilPressureCurve) =>
        set({ pencilPressureCurve }),
      setPencilTilt: (pencilTilt) => set({ pencilTilt }),
      setPencilPrediction: (pencilPrediction) => set({ pencilPrediction }),
      setFingerAction: (fingerAction) => set({ fingerAction }),
      notePenSeen: () => {
        if (!useCanvasUiStore.getState().penSeen) set({ penSeen: true });
      },
      setDebugPerformance: (debugPerformance) => set({ debugPerformance }),
      setShapeRenderer: (shapeRenderer) => set({ shapeRenderer }),
      setRasterCache: (rasterCache) => set({ rasterCache }),
      setLowGraphics: (lowGraphics) => {
        applyLowGraphics(lowGraphics);
        set({ lowGraphics });
      },
      setAttentionAlertsEnabled: (attentionAlertsEnabled) =>
        set({ attentionAlertsEnabled }),
      setAttentionIdleSeconds: (attentionIdleSeconds) =>
        set({ attentionIdleSeconds }),
      setAttentionAwaySeconds: (attentionAwaySeconds) =>
        set({ attentionAwaySeconds }),
      setPdfPageLimit: (pdfPageLimit) => set({ pdfPageLimit }),
      setPngExportScale: (pngExportScale) => set({ pngExportScale }),
      resetPencil: () => set({ ...PENCIL_DEFAULTS }),
    }),
    {
      name: 'whiteboard:canvas-ui',
      version: 5,
      migrate: migrateCanvasUiStore,
      onRehydrateStorage: () => (state) => {
        if (state) applyLowGraphics(state.lowGraphics);
      },
    },
  ),
);
