import {
  type Bounds,
  type FrameShape,
  type Point,
  pointInPolygon,
  rotatePoint,
  segmentsIntersect,
} from '@whiteboard/shared';

export type FrameHeadingSide = 0 | 1 | 2 | 3;

/** Screen-space frame-title metrics, converted to world units by `zoom`. */
export const FRAME_HEADING_FONT_SCREEN = 13;
export const FRAME_HEADING_HEIGHT_SCREEN = 22;
export const FRAME_HEADING_GAP_SCREEN = 4;
const FRAME_HEADING_MIN_WIDTH_SCREEN = 32;
const FRAME_HEADING_EXTRA_WIDTH_SCREEN = 12;
const FRAME_HEADING_TEXT_PADDING_SCREEN = 6;
const FRAME_HEADING_GLYPH_SCREEN = 7.1;

const TAU = Math.PI * 2;

function canonicalRotation(rotation: number): number {
  return ((rotation % TAU) + TAU) % TAU;
}

function signedRotation(rotation: number): number {
  const canonical = canonicalRotation(rotation);
  return canonical > Math.PI ? canonical - TAU : canonical;
}

/**
 * Local edge that is visually uppermost after the frame rotates. The 45-degree
 * phase offset keeps the title on one edge until the next edge is clearly more
 * horizontal, avoiding jitter around right angles.
 */
export function frameHeadingSide(rotation: number): FrameHeadingSide {
  const scaled =
    ((canonicalRotation(rotation) + Math.PI / 4) * (2 / Math.PI) + 4) % 4;
  return Math.floor(scaled) as FrameHeadingSide;
}

/** Rotation applied inside the frame before its own page rotation. */
export function frameHeadingSideAngle(side: FrameHeadingSide): number {
  switch (side) {
    case 0:
      return 0;
    case 1:
      return -Math.PI / 2;
    case 2:
      return Math.PI;
    case 3:
      return Math.PI / 2;
  }
}

/** SVG transform that maps the canonical top heading onto `side`. */
export function frameHeadingSideTransform(
  side: FrameHeadingSide,
  w: number,
  h: number,
): string | undefined {
  switch (side) {
    case 0:
      return undefined;
    case 1:
      return `translate(0 ${h}) rotate(-90)`;
    case 2:
      return `translate(${w} ${h}) rotate(180)`;
    case 3:
      return `translate(${w} 0) rotate(90)`;
  }
}

/** Map an upright frame-local point to its page-space position. */
export function framePointToPage(frame: FrameShape, point: Point): Point {
  const center = {
    x: frame.x + frame.props.w / 2,
    y: frame.y + frame.props.h / 2,
  };
  const world = { x: frame.x + point.x, y: frame.y + point.y };
  return frame.rotation ? rotatePoint(world, center, frame.rotation) : world;
}

/** Map a page point into the frame's upright local coordinate system. */
export function pagePointToFrame(frame: FrameShape, point: Point): Point {
  const center = {
    x: frame.x + frame.props.w / 2,
    y: frame.y + frame.props.h / 2,
  };
  const upright = frame.rotation
    ? rotatePoint(point, center, -frame.rotation)
    : point;
  return { x: upright.x - frame.x, y: upright.y - frame.y };
}

/** Page-space clip polygon for the frame body. */
export function framePolygon(frame: FrameShape): Point[] {
  return [
    framePointToPage(frame, { x: 0, y: 0 }),
    framePointToPage(frame, { x: frame.props.w, y: 0 }),
    framePointToPage(frame, { x: frame.props.w, y: frame.props.h }),
    framePointToPage(frame, { x: 0, y: frame.props.h }),
  ];
}

/** Exact point containment for upright or rotated frames. */
export function frameContainsPoint(frame: FrameShape, point: Point): boolean {
  const local = pagePointToFrame(frame, point);
  return (
    local.x >= 0 &&
    local.x <= frame.props.w &&
    local.y >= 0 &&
    local.y <= frame.props.h
  );
}

export function boundsPolygon(bounds: Bounds): Point[] {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

/** True when two closed polygons overlap or one contains the other. */
export function polygonsOverlap(
  a: readonly Point[],
  b: readonly Point[],
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (a.some((point) => pointInPolygon(point, b))) return true;
  if (b.some((point) => pointInPolygon(point, a))) return true;
  for (let ai = 0; ai < a.length; ai++) {
    const a0 = a[ai]!;
    const a1 = a[(ai + 1) % a.length]!;
    for (let bi = 0; bi < b.length; bi++) {
      const b0 = b[bi]!;
      const b1 = b[(bi + 1) % b.length]!;
      if (segmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

export function frameOverlapsBounds(
  frame: FrameShape,
  bounds: Bounds,
): boolean {
  return polygonsOverlap(framePolygon(frame), boundsPolygon(bounds));
}

export function frameContainsBounds(
  frame: FrameShape,
  bounds: Bounds,
): boolean {
  return boundsPolygon(bounds).every((point) =>
    frameContainsPoint(frame, point),
  );
}

function transformHeadingPoint(
  point: Point,
  side: FrameHeadingSide,
  w: number,
  h: number,
): Point {
  const angle = frameHeadingSideAngle(side);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotated = {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
  switch (side) {
    case 0:
      return rotated;
    case 1:
      return { x: rotated.x, y: rotated.y + h };
    case 2:
      return { x: rotated.x + w, y: rotated.y + h };
    case 3:
      return { x: rotated.x + w, y: rotated.y };
  }
}

export interface FrameHeadingLayout {
  side: FrameHeadingSide;
  /** Canonical top-heading rectangle before the side transform. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page-space rotation after the frame and side rotations compose. */
  pageRotation: number;
  /** Page-space corners, beginning at the label's visual top-left. */
  corners: [Point, Point, Point, Point];
}

/**
 * Zoom-compensated heading layout. Width is estimated deterministically so the
 * same pure renderer works on-canvas and in the headless PNG export.
 */
export function frameHeadingLayout(
  frame: FrameShape,
  zoom: number,
): FrameHeadingLayout {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const side = frameHeadingSide(frame.rotation);
  const edge = side % 2 === 0 ? frame.props.w : frame.props.h;
  const minWidth = FRAME_HEADING_MIN_WIDTH_SCREEN / z;
  const maxWidth = edge + FRAME_HEADING_EXTRA_WIDTH_SCREEN / z;
  const measured =
    (Math.max(1, frame.props.name.trim().length) * FRAME_HEADING_GLYPH_SCREEN +
      FRAME_HEADING_TEXT_PADDING_SCREEN * 2) /
    z;
  const width = Math.min(maxWidth, Math.max(minWidth, measured));
  const height = FRAME_HEADING_HEIGHT_SCREEN / z;
  const gap = FRAME_HEADING_GAP_SCREEN / z;
  const x = 0;
  const y = -(height + gap);
  const canonical: [Point, Point, Point, Point] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const corners = canonical.map((point) =>
    framePointToPage(
      frame,
      transformHeadingPoint(point, side, frame.props.w, frame.props.h),
    ),
  ) as [Point, Point, Point, Point];
  return {
    side,
    x,
    y,
    width,
    height,
    pageRotation: signedRotation(frame.rotation + frameHeadingSideAngle(side)),
    corners,
  };
}

/** Deterministic ellipsis matching the heading's estimated text metrics. */
export function frameHeadingText(
  name: string,
  layout: Pick<FrameHeadingLayout, 'width'>,
  zoom: number,
): string {
  const value = name.trim() || 'Frame';
  const screenWidth = layout.width * (zoom > 0 ? zoom : 1);
  const available = Math.max(
    1,
    screenWidth - FRAME_HEADING_TEXT_PADDING_SCREEN * 2,
  );
  const maxChars = Math.max(
    1,
    Math.floor(available / FRAME_HEADING_GLYPH_SCREEN),
  );
  if (value.length <= maxChars) return value;
  if (maxChars === 1) return '…';
  return `${value.slice(0, maxChars - 1)}…`;
}
