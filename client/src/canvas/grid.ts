import type { Camera } from './camera';

export type BackgroundType = 'blank' | 'dot' | 'graph' | 'coordinate';

export const BACKGROUND_TYPES: readonly BackgroundType[] = [
  'blank',
  'dot',
  'graph',
  'coordinate',
];

export const BACKGROUND_LABELS: Record<BackgroundType, string> = {
  blank: 'Blank',
  dot: 'Dot grid',
  graph: 'Graph paper',
  coordinate: 'Coordinate plane',
};

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
  /** Dot centre within the pattern tile, phased to world space. */
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

/**
 * Dot-grid levels of detail, coarsest first. `step` is a multiple of the base
 * grid unit; a level fades in linearly from zoom `min` to `mid` and stays fully
 * opaque above `mid`, so coarse dots carry the grid when zoomed out and finer
 * ones appear as you zoom in.
 */
const DOT_GRID_LEVELS = [
  { step: 64, min: -1, mid: 0.15 },
  { step: 16, min: 0.05, mid: 0.375 },
  { step: 4, min: 0.15, mid: 1 },
  { step: 1, min: 0.7, mid: 2.5 },
] as const;

/** Screen-space dot radius, in px. */
const DOT_GRID_RADIUS = 1;
const DOT_GRID_CRISP_OFFSET = 0.5;

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

function dotLevelOpacity(z: number, min: number, mid: number): number {
  if (z >= mid) return 1;
  if (z <= min) return 0;
  return (z - min) / (mid - min);
}

/**
 * Fixed-world dot-grid layers, 8/32/128/512 world units apart. Each layer is
 * phased with a positive modulo of the camera offset (plus a half-pixel nudge
 * so dots sit on pixel centres), keeping the wallpaper pinned to world
 * coordinates while only rendering viewport-sized patterns.
 */
export function getDotGridLayers(camera: Camera): DotGridLayer[] {
  const originX = DOT_GRID_CRISP_OFFSET - camera.x * camera.z;
  const originY = DOT_GRID_CRISP_OFFSET - camera.y * camera.z;
  return DOT_GRID_LEVELS.map(({ step, min, mid }) => {
    const worldStep = step * DOT_GRID_BASE_STEP;
    const screenStep = worldStep * camera.z;
    return {
      id: `dot-${step}`,
      step: worldStep,
      screenStep,
      offsetX: pmod(originX, screenStep),
      offsetY: pmod(originY, screenStep),
      opacity: dotLevelOpacity(camera.z, min, mid),
      radius: DOT_GRID_RADIUS,
    };
  });
}

export function getSnapGridStep(
  background: BackgroundType,
  camera: Camera,
): number | null {
  if (background === 'blank') return null;
  if (background === 'dot') return DOT_GRID_BASE_STEP;
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
