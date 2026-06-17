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

// Target on-screen spacing for minor gridlines; the actual step is snapped to a
// 1-2-5 sequence so lines never get too dense or too sparse as you zoom.
const TARGET_MINOR_PX = 28;

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
