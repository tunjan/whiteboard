import type { FontFamily } from '@whiteboard/shared';

// Shared text metrics so the SVG renderer, hit-testing, bounds, and the HTML
// edit overlay all agree on size and position.

export const TEXT_FONT_FAMILY =
  "'Inter Variable', system-ui, -apple-system, sans-serif";
export const LINE_HEIGHT_FACTOR = 1.2;

/** Concrete CSS font stacks for each selectable family. */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: TEXT_FONT_FAMILY,
  serif: "'Georgia', 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

/** CSS font stack for a family (defaulting to sans for legacy shapes). */
export function fontStack(family: FontFamily | undefined): string {
  return FONT_STACKS[family ?? 'sans'];
}

let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx = document.createElement('canvas').getContext('2d');
  }
  return ctx;
}

export interface TextMetrics {
  width: number;
  height: number;
}

// Memoize measurements: `measureText` is called from getBounds (every text
// mutation, via the spatial index), hitTest, and the SVG render path, almost
// always with identical (text, size, family) tuples. canvas `measureText` is
// the per-glyph cost we want to pay once. Bounded so live editing (a fresh key
// per keystroke) can't grow it without limit.
const measureCache = new Map<string, TextMetrics>();
const MEASURE_CACHE_MAX = 2000;

/** Measure multi-line text (split on \n) in world units. */
export function measureText(
  text: string,
  fontSize: number,
  family?: FontFamily,
): TextMetrics {
  const cacheKey = `${family ?? 'sans'}|${fontSize}|${text}`;
  const cached = measureCache.get(cacheKey);
  if (cached) return cached;

  const lines = text.length ? text.split('\n') : [''];
  const c = getCtx();
  let maxW = 0;
  if (c) {
    c.font = `${fontSize}px ${fontStack(family)}`;
    for (const line of lines) {
      const w = c.measureText(line || ' ').width;
      if (w > maxW) maxW = w;
    }
  } else {
    maxW = (Math.max(...lines.map((l) => l.length)) || 1) * fontSize * 0.6;
  }
  const metrics: TextMetrics = {
    width: Math.max(maxW, fontSize * 0.5),
    height: lines.length * fontSize * LINE_HEIGHT_FACTOR,
  };
  // Cheap FIFO eviction: drop the oldest entry once over the cap.
  if (measureCache.size >= MEASURE_CACHE_MAX) {
    const oldest = measureCache.keys().next().value;
    if (oldest !== undefined) measureCache.delete(oldest);
  }
  measureCache.set(cacheKey, metrics);
  return metrics;
}
