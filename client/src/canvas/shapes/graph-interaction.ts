import type { GraphViewport } from '@whiteboard/shared';

/** A plot's drawing rectangle in world units (see `plotArea` in graph.tsx). */
export interface PlotArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Math coordinates → world point inside the plot rectangle. */
export function graphToScreen(
  point: { x: number; y: number },
  viewport: GraphViewport,
  area: PlotArea,
): { x: number; y: number } {
  const xRange = viewport.xMax - viewport.xMin || 1;
  const yRange = viewport.yMax - viewport.yMin || 1;
  return {
    x: area.x + ((point.x - viewport.xMin) / xRange) * area.w,
    y: area.y + ((viewport.yMax - point.y) / yRange) * area.h,
  };
}

/** Inverse of {@link graphToScreen}: world point inside `area` → math coordinates. */
export function screenToGraph(
  point: { x: number; y: number },
  viewport: GraphViewport,
  area: PlotArea,
): { x: number; y: number } {
  const xRange = viewport.xMax - viewport.xMin || 1;
  const yRange = viewport.yMax - viewport.yMin || 1;
  return {
    x: viewport.xMin + ((point.x - area.x) / area.w) * xRange,
    y: viewport.yMax - ((point.y - area.y) / area.h) * yRange,
  };
}

/**
 * Zoom the viewport by `factor` (factor < 1 zooms in) while holding the math
 * point under `worldPoint` fixed on screen.
 */
export function zoomViewport(
  viewport: GraphViewport,
  area: PlotArea,
  worldPoint: { x: number; y: number },
  factor: number,
): GraphViewport {
  const xRange = viewport.xMax - viewport.xMin || 1;
  const yRange = viewport.yMax - viewport.yMin || 1;
  const anchor = screenToGraph(worldPoint, viewport, area);
  const fracX = (anchor.x - viewport.xMin) / xRange;
  const fracY = (anchor.y - viewport.yMin) / yRange;
  const newXRange = xRange * factor;
  const newYRange = yRange * factor;
  const xMin = anchor.x - fracX * newXRange;
  const yMin = anchor.y - fracY * newYRange;
  return {
    xMin,
    xMax: xMin + newXRange,
    yMin,
    yMax: yMin + newYRange,
  };
}

/**
 * Shift the visible window by a screen-space delta in world pixels. A positive
 * `dxWorld`/`dyWorld` moves the window right/down (matching wheel deltas).
 */
export function panViewport(
  viewport: GraphViewport,
  area: PlotArea,
  dxWorld: number,
  dyWorld: number,
): GraphViewport {
  const xRange = viewport.xMax - viewport.xMin || 1;
  const yRange = viewport.yMax - viewport.yMin || 1;
  const dxMath = (dxWorld / area.w) * xRange;
  const dyMath = (dyWorld / area.h) * yRange;
  return {
    xMin: viewport.xMin + dxMath,
    xMax: viewport.xMax + dxMath,
    yMin: viewport.yMin - dyMath,
    yMax: viewport.yMax - dyMath,
  };
}
