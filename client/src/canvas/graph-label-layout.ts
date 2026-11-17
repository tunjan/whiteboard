type Point = { x: number; y: number };

/** Air kept between a label and any line, so text never touches a stroke. */
const LINE_CLEARANCE = 2;

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelRequest {
  /** Anchor dot centre, in screen units. */
  x: number;
  y: number;
  /** Rendered text advance width. */
  width: number;
  /** A dot to keep clear that needs no label of its own. */
  silent?: boolean;
}

export interface PlacedLabel {
  /** Text origin: `x` honours `anchor`, `y` is the baseline. */
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

export interface LabelLayoutOptions {
  fontSize: number;
  /** Radius around each dot that no label may cover. */
  dotRadius: number;
  /** Gap between the dot centre and the nearest label edge. */
  offset: number;
  /** Boxes labels must avoid besides dots, e.g. axis tick labels. */
  obstacles?: readonly LabelBox[];
  /** Polylines labels must not touch, e.g. the curves and axes. */
  lines?: readonly (readonly Point[])[];
}

// Preferred slots, in order: above-right, above-left, below-right,
// below-left, then level with the dot on either side.
const SLOTS = [
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
] as const;

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

// Each segment's own bounds: conservative on a long diagonal, but sampled
// curves are short segments, and this runs for every slot of every label.
export function touchesLine(box: LabelBox, line: readonly Point[]): boolean {
  const left = box.x - LINE_CLEARANCE;
  const right = box.x + box.w + LINE_CLEARANCE;
  const top = box.y - LINE_CLEARANCE;
  const bottom = box.y + box.h + LINE_CLEARANCE;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    if (
      Math.max(a.x, b.x) >= left &&
      Math.min(a.x, b.x) <= right &&
      Math.max(a.y, b.y) >= top &&
      Math.min(a.y, b.y) <= bottom
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Greedy point-label placement. Requests are placed in order, so callers put
 * the most important points first. Each label takes the first slot that stays
 * inside `bounds` and clears every dot, obstacle, line and earlier label; a
 * label with no free slot is dropped (`null`) rather than drawn over anything.
 */
export function placePointLabels(
  requests: readonly LabelRequest[],
  bounds: LabelBox,
  options: LabelLayoutOptions,
): (PlacedLabel | null)[] {
  const { fontSize, dotRadius, offset, lines = [] } = options;
  // Digits and parentheses: cap height above the baseline, a little below.
  const ascent = fontSize * 0.8;
  const height = fontSize;
  const taken: LabelBox[] = [
    ...(options.obstacles ?? []),
    ...requests.map((r) => ({
      x: r.x - dotRadius,
      y: r.y - dotRadius,
      w: dotRadius * 2,
      h: dotRadius * 2,
    })),
  ];

  return requests.map((request) => {
    if (request.silent) return null;
    for (const slot of SLOTS) {
      const left =
        slot.dx > 0 ? request.x + offset : request.x - offset - request.width;
      const top =
        slot.dy < 0
          ? request.y - offset - height
          : slot.dy > 0
            ? request.y + offset
            : request.y - height / 2;
      const box = { x: left, y: top, w: request.width, h: height };
      if (
        box.x < bounds.x ||
        box.y < bounds.y ||
        box.x + box.w > bounds.x + bounds.w ||
        box.y + box.h > bounds.y + bounds.h
      ) {
        continue;
      }
      if (taken.some((other) => overlaps(box, other))) continue;
      if (lines.some((line) => touchesLine(box, line))) continue;
      taken.push(box);
      return {
        x: slot.dx > 0 ? box.x : box.x + box.w,
        y: box.y + ascent,
        anchor: slot.dx > 0 ? 'start' : 'end',
      };
    }
    return null;
  });
}
