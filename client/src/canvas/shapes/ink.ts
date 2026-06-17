import getStroke, { type StrokeOptions } from 'perfect-freehand';
import type { DrawPoint } from '@whiteboard/shared';

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
const ENDPOINT_FILTER_POINTS = 5;

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
  simulatePressure: true,
  thinning: 0.5,
  smoothing: 0.5,
  streamline: pencilStabilizationToStreamline(DEFAULT_PENCIL_STABILIZATION),
  startTaper: 0,
  endTaper: 0,
} as const satisfies Required<InkStrokeDynamics>;

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function pressureOf(point: DrawPoint): number {
  return Math.max(0, Math.min(1, point.pressure ?? 0.5));
}

function withPressure(point: DrawPoint, pressure: number): DrawPoint {
  return { ...point, pressure: Math.max(pressureOf(point), pressure) };
}

function pointDistance(a: DrawPoint, b: DrawPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function filterEndpointJitter(points: DrawPoint[], size: number): DrawPoint[] {
  if (points.length <= 2 || size <= 0) return points.slice();

  const minDistance = size / 3;
  const start = points[0]!;
  let startPressure = pressureOf(start);
  let firstKept = 1;
  const startLimit = Math.min(points.length - 1, ENDPOINT_FILTER_POINTS);

  for (let i = 1; i <= startLimit; i++) {
    const point = points[i]!;
    if (pointDistance(start, point) >= minDistance) break;
    startPressure = Math.max(startPressure, pressureOf(point));
    firstKept = i + 1;
  }

  const trimmedStart = [withPressure(start, startPressure), ...points.slice(firstKept)];
  if (trimmedStart.length <= 2) return trimmedStart;

  const lastIndex = trimmedStart.length - 1;
  const end = trimmedStart[lastIndex]!;
  let endPressure = pressureOf(end);
  let lastPrefixIndex = lastIndex;
  const endLimit = Math.max(0, lastIndex - ENDPOINT_FILTER_POINTS);

  for (let i = lastIndex - 1; i >= endLimit; i--) {
    const point = trimmedStart[i]!;
    if (pointDistance(point, end) >= minDistance) break;
    endPressure = Math.max(endPressure, pressureOf(point));
    lastPrefixIndex = i;
  }

  if (lastPrefixIndex === lastIndex) return trimmedStart;
  return [
    ...trimmedStart.slice(0, lastPrefixIndex),
    withPressure(end, endPressure),
  ];
}

/** Convert a perfect-freehand outline into a filled SVG path (quadratics). */
function outlineToPath(points: number[][]): string {
  const len = points.length;
  if (len === 0) return '';
  const first = points[0]!;
  if (len < 4) {
    return `M ${first[0]!.toFixed(2)} ${first[1]!.toFixed(2)} Z`;
  }
  let d = `M ${first[0]!.toFixed(2)} ${first[1]!.toFixed(2)} Q`;
  for (let i = 1; i < len - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    d += ` ${a[0]!.toFixed(2)} ${a[1]!.toFixed(2)} ${mid(a[0]!, b[0]!).toFixed(2)} ${mid(a[1]!, b[1]!).toFixed(2)}`;
  }
  return `${d} Z`;
}

/** SVG path data for an ink stroke (local coordinates). */
export function getInkPathData(
  points: DrawPoint[],
  size: number,
  last: boolean,
  dynamics: InkStrokeDynamics = {},
): string {
  const input = filterEndpointJitter(points, size).map((p) => [
    p.x,
    p.y,
    pressureOf(p),
  ]);
  const strokeOptions: StrokeOptions = {
    size,
    last,
    thinning: dynamics.thinning ?? 0,
    smoothing: dynamics.smoothing ?? 0.5,
    streamline: dynamics.streamline ?? 0.5,
    simulatePressure: dynamics.simulatePressure ?? false,
    easing: (pressure) => pressure,
    start: {
      cap: !(dynamics.startTaper ?? 0),
      taper: dynamics.startTaper ?? 0,
      easing: (distance) => distance * distance,
    },
    end: {
      cap: !(dynamics.endTaper ?? 0),
      taper: dynamics.endTaper ?? 0,
      easing: (distance) => --distance * distance * distance + 1,
    },
  };
  const outline = getStroke(input, strokeOptions);
  return outlineToPath(outline);
}
