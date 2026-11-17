import type { Camera } from './camera';

export type BackgroundType =
  'blank' | 'dot' | 'graph' | 'coordinate' | 'isometric' | 'triangle';

export const BACKGROUND_TYPES: readonly BackgroundType[] = [
  'blank',
  'dot',
  'graph',
  'coordinate',
  'isometric',
  'triangle',
];

export const BACKGROUND_LABELS: Record<BackgroundType, string> = {
  blank: 'Blank',
  dot: 'Dot grid',
  graph: 'Graph paper',
  coordinate: 'Coordinate plane',
  isometric: 'Isometric',
  triangle: 'Triangle grid',
};

export function isTriangleGrid(
  type: BackgroundType,
): type is 'isometric' | 'triangle' {
  return type === 'isometric' || type === 'triangle';
}

/**
 * One repeat of a triangular lattice whose parallel rules sit `step` apart, so
 * the major level (5 × step) is a sublattice of the minor one. `isometric`
 * keeps one family vertical with the others at ±30°; `triangle` keeps one
 * horizontal with the others at ±60°. Diagonals run a tile past each edge so
 * a clipped tile still leaves its neighbour the other half of the stroke.
 */
export function triangleTile(type: 'isometric' | 'triangle', step: number) {
  const side = (2 * step) / Math.sqrt(3);
  const upright = type === 'isometric';
  const w = upright ? 2 * step : side;
  const h = upright ? side : 2 * step;
  const rules = [0, step, 2 * step].map((p) =>
    upright ? [p, 0, p, h] : [0, p, w, p],
  );
  return {
    w,
    h,
    lines: [...rules, [-w, -h, 2 * w, 2 * h], [-w, 2 * h, 2 * w, -h]],
  };
}

/**
 * Fades the grid out toward the edges of the screen, so it reads as a sheet of
 * paper under the chrome rather than a texture running into it. Shared by the
 * loading veil and the board's own grid (when `groundFade` is on) so the two
 * are the same sheet at handoff.
 */
export const GROUND_FADE_MASK =
  'radial-gradient(ellipse 62% 58% at 50% 45%, black 20%, transparent 100%)';

export interface GridLevels {
  /** Minor grid step, in world units. */
  minorStep: number;
  /** Major grid step (minor x 5), in world units. */
  majorStep: number;
  /** Minor step projected to screen px. */
  minorScreen: number;
  /** Major step projected to screen px. */
  majorScreen: number;
  /** Screen x of world x=0. */
  originX: number;
  /** Screen y of world y=0. */
  originY: number;
}

export interface DotGridLayer {
  /** Stable identifier for React keys / SVG pattern ids. */
  id: string;
  /** Grid step, in world units. */
  step: number;
  /** Grid step projected to screen px. */
  screenStep: number;
  /** Screen phase of the lattice in [0, screenStep), pinned to world space. */
  offsetX: number;
  offsetY: number;
  /** Visibility after zoom-based level-of-detail fading. */
  opacity: number;
  /** Screen-space dot radius. */
  radius: number;
}

// Target on-screen spacing for minor gridlines; the actual step is snapped to a
// 1-2-5 sequence so lines never get too dense or too sparse as you zoom.
const TARGET_MINOR_PX = 28;

export const DOT_GRID_BASE_STEP = 8;

/** Dot-grid lattices, in base grid units, coarsest first. */
const DOT_GRID_STEPS = [64, 16, 4, 1] as const;

/**
 * Every lattice fades in by the same rule, in two stages on log spacing: up
 * to `DOT_MINOR_OPACITY` while its dots go from `DOT_FADE_FROM_PX` to
 * `DOT_MINOR_PX` apart on screen, so dense dots read as a lighter minor grid
 * under the major one, then on to fully opaque at `DOT_FADE_TO_PX`, where it
 * takes over as the major grid. The coarsest lattice is always opaque so the
 * grid never vanishes.
 */
const DOT_FADE_FROM_PX = 6;
const DOT_MINOR_PX = 20;
const DOT_FADE_TO_PX = 32;
const DOT_MINOR_OPACITY = 0.35;

/** Screen-space dot radius, in px. */
const DOT_GRID_RADIUS = 1;

/** Snap a raw world distance to the nearest 1-2-5 x 10^n value. */
export function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let mult: number;
  if (norm < 1.5) mult = 1;
  else if (norm < 3.5) mult = 2;
  else if (norm < 7.5) mult = 5;
  else mult = 10;
  return mult * pow;
}

export function getGridLevels(camera: Camera): GridLevels {
  const minorStep = niceStep(TARGET_MINOR_PX / camera.z);
  const majorStep = minorStep * 5;
  return {
    minorStep,
    majorStep,
    minorScreen: minorStep * camera.z,
    majorScreen: majorStep * camera.z,
    originX: -camera.x * camera.z,
    originY: -camera.y * camera.z,
  };
}

function logRamp(value: number, from: number, to: number): number {
  const t = Math.log(value / from) / Math.log(to / from);
  return Math.min(1, Math.max(0, t));
}

function dotLevelOpacity(screenStep: number): number {
  return (
    DOT_MINOR_OPACITY * logRamp(screenStep, DOT_FADE_FROM_PX, DOT_MINOR_PX) +
    (1 - DOT_MINOR_OPACITY) * logRamp(screenStep, DOT_MINOR_PX, DOT_FADE_TO_PX)
  );
}

/**
 * Fixed-world dot-grid layers, 8/32/128/512 world units apart. Each layer is
 * phased with a positive modulo of the camera offset, keeping the wallpaper
 * pinned to world coordinates while only rendering viewport-sized patterns.
 * The offset is rounded to device pixels so a radius-1 dot centres on a pixel
 * corner (a crisp 2x2 block) whenever the step is whole, as at every zoom
 * notch.
 */
export function getDotGridLayers(
  camera: Camera,
  pixelRatio = 1,
): DotGridLayer[] {
  const originX = Math.round(-camera.x * camera.z * pixelRatio) / pixelRatio;
  const originY = Math.round(-camera.y * camera.z * pixelRatio) / pixelRatio;
  const layers = DOT_GRID_STEPS.map((step, i) => {
    const worldStep = step * DOT_GRID_BASE_STEP;
    const screenStep = worldStep * camera.z;
    return {
      id: `dot-${step}`,
      step: worldStep,
      screenStep,
      offsetX: pmod(originX, screenStep),
      offsetY: pmod(originY, screenStep),
      opacity: i === 0 ? 1 : dotLevelOpacity(screenStep),
      radius: DOT_GRID_RADIUS,
    };
  });
  // Every coarser lattice is contained in the finest fully visible lattice, so
  // stop painting shared dots repeatedly. Renderers draw all layers in one
  // opaque ink and apply the dot alpha once to the group, so dropping a layer
  // under an opaque one changes nothing on screen.
  let first = 0;
  for (let i = 0; i < layers.length; i++) {
    if (layers[i]!.opacity === 1) first = i;
  }
  return layers.slice(first);
}

/** Spacing of the fully visible dot lattice at zoom 1, in screen px. */
export const DOT_GRID_REST_PX = getDotGridLayers({ x: 0, y: 0, z: 1 })[0]!
  .screenStep;

export function getSnapGridStep(
  background: BackgroundType,
  camera: Camera,
): number | null {
  if (background === 'blank') return null;
  if (background === 'dot') {
    // Snap to the finest lattice that reads as visible, not to dots that are
    // still a faint haze or packed below a pixel apart.
    let step = DOT_GRID_BASE_STEP;
    for (const layer of getDotGridLayers(camera)) {
      if (layer.opacity >= 0.5) step = layer.step;
    }
    return step;
  }
  return getGridLevels(camera).minorStep;
}

export function snapCoordinateToGrid(value: number, gridStep: number): number {
  return Math.round(value / gridStep) * gridStep;
}

/** Positive modulo (JS `%` keeps the sign of the dividend). */
export function pmod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** World coordinates that are multiples of `step` within [start, end]. */
export function tickValues(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  if (step <= 0) return out;
  const first = Math.ceil(start / step) * step;
  // Guard against pathological counts.
  for (let v = first, i = 0; v <= end && i < 1000; v += step, i++) {
    out.push(v);
  }
  return out;
}

/** Format an axis label, trimming float noise. */
export function formatAxisLabel(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 100000 || abs < 0.001) return value.toExponential(0);
  return Number(value.toPrecision(6)).toString();
}
