import type { DrawPoint } from '@whiteboard/shared';
import {
  buildInkCenterline,
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

/**
 * Legacy simulated-pressure strokes keep the flat response they were drawn
 * with. Their width comes from sample spacing rather than from a real reading,
 * and re-shaping it would rewrite how every stroke saved before that looks.
 */
const linearPressureEasing = (pressure: number): number => pressure;

/**
 * Pressure response for strokes carrying a real signal — stylus hardware or
 * the draw tool's velocity measurement.
 *
 * Smoothstep pins 0, 0.5 and 1 to themselves, so a stroke held at neutral
 * pressure keeps exactly the width it had and nothing about the default pencil
 * moves. What changes is the slope either side of neutral, which is where a
 * hand actually varies: it runs at 1.5x, so ordinary pressure changes carry
 * more weight, while the extremes ease off instead of clipping flat.
 */
const smoothPressureEasing = (pressure: number): number =>
  pressure * pressure * (3 - 2 * pressure);

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
 * filling the variable-width freehand-engine outline. Built on the engine's own
 * conditioned centerline (final point pinned to the raw lift position), so a
 * dashed stroke follows exactly the line its solid twin would.
 */
export function getInkCenterlinePath(
  points: DrawPoint[],
  size: number,
  streamlineAmount = 0.5,
): string {
  const line = buildInkCenterline(points, size, streamlineAmount, true);
  const len = line.count;
  if (len < 2) return '';
  const sx = line.x;
  const sy = line.y;
  if (len === 2) {
    return `M ${sx[0]!.toFixed(2)} ${sy[0]!.toFixed(2)} L ${sx[1]!.toFixed(2)} ${sy[1]!.toFixed(2)}`;
  }
  const parts = [`M ${sx[0]!.toFixed(2)} ${sy[0]!.toFixed(2)} Q`];
  for (let i = 1; i < len - 1; i++) {
    parts.push(
      ` ${sx[i]!.toFixed(2)} ${sy[i]!.toFixed(2)} ${mid(sx[i]!, sx[i + 1]!).toFixed(2)} ${mid(sy[i]!, sy[i + 1]!).toFixed(2)}`,
    );
  }
  parts.push(` L ${sx[len - 1]!.toFixed(2)} ${sy[len - 1]!.toFixed(2)}`);
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
  engineOptions.easing = engineOptions.simulatePressure
    ? linearPressureEasing
    : smoothPressureEasing;
  engineOptions.startTaper = dynamics.startTaper ?? 0;
  engineOptions.endTaper = dynamics.endTaper ?? false;
  return getFreehandPathData(points, engineOptions);
}
