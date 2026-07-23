import type { DrawPoint } from '@whiteboard/shared';
import {
  getFreehandPathData,
  type FreehandEngineOptions,
} from './ink-engine';

export interface InkStrokeDynamics {
  simulatePressure?: boolean;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  startTaper?: number | boolean;
  endTaper?: number | boolean;
}

const MIN_STREAMLINE_RAW_WEIGHT = 0.15;
const STREAMLINE_RAW_WEIGHT_RANGE = 0.85;
const RAW_WEIGHT_AT_HALF_STABILIZATION = 0.425;
export const DEFAULT_PENCIL_STABILIZATION = 0.35;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function pencilStabilizationToStreamline(stabilization: number): number {
  const strength = clamp01(stabilization);
  const rawInputWeight =
    strength <= 0.5
      ? lerp(1, RAW_WEIGHT_AT_HALF_STABILIZATION, strength / 0.5)
      : lerp(
          RAW_WEIGHT_AT_HALF_STABILIZATION,
          MIN_STREAMLINE_RAW_WEIGHT,
          (strength - 0.5) / 0.5,
        );

  return clamp01(
    1 -
      (rawInputWeight - MIN_STREAMLINE_RAW_WEIGHT) /
        STREAMLINE_RAW_WEIGHT_RANGE,
  );
}

export const DEFAULT_PENCIL_DYNAMICS = {
  // Mouse and touch do not provide meaningful pressure. A predictable pencil
  // line is a better default than turning small speed changes into a brush.
  simulatePressure: false,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: pencilStabilizationToStreamline(DEFAULT_PENCIL_STABILIZATION),
  startTaper: 0,
  // Round caps make a pencil stop where the pointer stops. The pointed brush
  // finish remains available in Settings for people who want it.
  endTaper: false,
} as const satisfies Required<InkStrokeDynamics>;

const linearPressureEasing = (pressure: number): number => pressure;
/** Reused because the engine is intentionally synchronous and non-reentrant. */
const engineOptions: FreehandEngineOptions = {
  size: 1,
  last: false,
  thinning: 0,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: false,
  easing: linearPressureEasing,
  startTaper: 0,
  endTaper: false,
};

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Smoothed centerline path (quadratic through midpoints) for an ink stroke.
 * Used for dashed/dotted pencils, which stroke a uniform-width line instead of
 * filling the variable-width freehand-engine outline.
 */
export function getInkCenterlinePath(points: DrawPoint[]): string {
  const len = points.length;
  if (len < 2) return '';
  const first = points[0]!;
  if (len === 2) {
    const b = points[1]!;
    return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  const parts = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)} Q`];
  for (let i = 1; i < len - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    parts.push(
      ` ${a.x.toFixed(2)} ${a.y.toFixed(2)} ${mid(a.x, b.x).toFixed(2)} ${mid(a.y, b.y).toFixed(2)}`,
    );
  }
  const last = points[len - 1]!;
  parts.push(` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`);
  return parts.join('');
}

/** SVG path data for an ink stroke (local coordinates). */
export function getInkPathData(
  points: DrawPoint[],
  size: number,
  last: boolean,
  dynamics: InkStrokeDynamics = {},
): string {
  engineOptions.size = size;
  engineOptions.last = last;
  engineOptions.thinning = dynamics.thinning ?? 0;
  engineOptions.smoothing = dynamics.smoothing ?? 0.5;
  engineOptions.streamline = dynamics.streamline ?? 0.5;
  engineOptions.simulatePressure = dynamics.simulatePressure ?? false;
  engineOptions.startTaper = dynamics.startTaper ?? 0;
  engineOptions.endTaper = dynamics.endTaper ?? false;
  return getFreehandPathData(points, engineOptions);
}
