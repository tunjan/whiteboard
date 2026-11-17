import { unionBounds, type Bounds } from '@whiteboard/shared';

export interface Line {
  ids: string[];
  bounds: Bounds;
}

/**
 * Group shapes into lines of working, top to bottom, splitting only where a
 * band of blank space crosses the whole page: a gap of more than a third of
 * the typical shape's height. Not by overlap between shapes — a fraction's
 * numerator and denominator barely overlap the "x =" beside them, and would
 * come apart into three lines.
 *
 * ponytail: rows only. Two columns of working side by side become one line
 * each row, and lines written with no gap between them merge, so a mark covers
 * both; split on horizontal gaps too if that turns out to matter.
 */
export function linesOf(shapes: { id: string; bounds: Bounds }[]): Line[] {
  const heights = shapes.map((s) => s.bounds.maxY - s.bounds.minY).sort((a, b) => a - b);
  const gap = (heights[Math.floor(heights.length / 2)] ?? 0) / 3;
  const lines: Line[] = [];
  for (const { id, bounds } of [...shapes].sort((a, b) => a.bounds.minY - b.bounds.minY)) {
    const last = lines.at(-1);
    if (last && bounds.minY - last.bounds.maxY <= gap) {
      last.ids.push(id);
      last.bounds = unionBounds(last.bounds, bounds);
    } else {
      lines.push({ ids: [id], bounds });
    }
  }
  return lines;
}

/**
 * Blank space that ends a block of working, in typical shape heights — the
 * scale `linesOf` splits on. Sideways, wider than the space between the terms
 * of one line, so a line comes whole but a second column across a wide gap
 * does not; downwards, a blank line or so.
 */
const BLOCK_GAP_X = 3;
const BLOCK_GAP_Y = 2;

/**
 * Most lines one check reads, so the image and the bill stay bounded. Two
 * thirds of what is left after the edited lines goes above them: a step is
 * only wrong relative to the ones before it.
 */
export const MAX_BLOCK_LINES = 12;

/**
 * The contiguous block of working that holds `edited`, as the ids of whole
 * lines above and below it: every shape within the gaps above of one already
 * in, grown from the edited shapes, then capped to the lines nearest them.
 */
export function blockAround(
  shapes: { id: string; bounds: Bounds }[],
  edited: Iterable<string>,
): string[] {
  const seeds = new Set(edited);
  const heights = shapes.map((s) => s.bounds.maxY - s.bounds.minY).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)] ?? 0;
  const gx = h * BLOCK_GAP_X;
  const gy = h * BLOCK_GAP_Y;
  const block = shapes.filter((s) => seeds.has(s.id));
  if (!block.length) return [];
  // Far enough to hold the line cap at a generous line pitch, so a dense page
  // isn't flooded end to end. ponytail: the grow is O(block × band); index
  // the band if a page's band ever runs to thousands of strokes.
  const reach = MAX_BLOCK_LINES * gy * 2;
  const seedBounds = block.map((s) => s.bounds).reduce(unionBounds);
  const rest = shapes.filter(
    (s) =>
      !seeds.has(s.id) &&
      s.bounds.maxY >= seedBounds.minY - reach &&
      s.bounds.minY <= seedBounds.maxY + reach,
  );
  for (let i = 0; i < block.length; i++) {
    const b = block[i]!.bounds;
    for (let j = rest.length - 1; j >= 0; j--) {
      const r = rest[j]!.bounds;
      if (
        r.minX <= b.maxX + gx &&
        r.maxX >= b.minX - gx &&
        r.minY <= b.maxY + gy &&
        r.maxY >= b.minY - gy
      ) {
        block.push(rest[j]!);
        rest.splice(j, 1);
      }
    }
  }

  const lines = linesOf(block);
  const hit = lines.flatMap((l, i) => (l.ids.some((id) => seeds.has(id)) ? [i] : []));
  const last = hit.at(-1)!;
  // More edited lines than the cap: the latest writing is the bottom of it.
  const first = Math.max(hit[0]!, last - MAX_BLOCK_LINES + 1);
  const room = MAX_BLOCK_LINES - (last - first + 1);
  const below = Math.min(lines.length - 1 - last, room - Math.min(first, Math.ceil((room * 2) / 3)));
  const above = Math.min(first, room - below);
  return lines.slice(first - above, last + below + 1).flatMap((l) => l.ids);
}
