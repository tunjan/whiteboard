import type { Vec } from '../geometry';
import type { BaseShape } from './base';

// Style primitives.
export type FillStyle = 'none' | 'solid' | 'hatch' | 'crosshatch';
/** Visual treatment of a vector stroke. */
export type StrokeDash = 'solid' | 'dashed' | 'dotted' | 'draw';

/** How a multi-point line interpolates between its editable vertices. */
export type LineSpline = 'linear' | 'smooth';

/** Principal geometry used by an arrow body. */
export type ArrowTopology = 'straight' | 'arc' | 'elbow';

/** A terminal pinned to a normalized position on another shape's surface. */
export interface ConnectorBinding {
  shapeId: string;
  anchor: Vec;
}

/** Regular/normalized polygons that fit a w x h box. */
export type PolygonKind =
  'triangle' | 'diamond' | 'trapezoid' | 'pentagon' | 'hexagon';

/** Text font families (mapped to concrete font stacks on the client). */
export type FontFamily = 'sans' | 'serif' | 'mono' | 'hand';

/**
 * Selectable text weights. Capped at 400–700 because that is the range every
 * family can actually render: the hand family's variable font stops at 700, and
 * the serif/mono stacks fall back to system faces with only regular and bold.
 */
export type FontWeight = 400 | 500 | 600 | 700;

/** Horizontal text alignment. */
export type TextAlign = 'start' | 'middle' | 'end';

/** Whether text grows to its content or wraps inside a user-defined width. */
export type TextSizingMode = 'auto' | 'fixed';

export interface DrawPoint {
  /** Local x, relative to the shape's origin. */
  x: number;
  /** Local y, relative to the shape's origin. */
  y: number;
  /** Optional pressure 0..1 for variable-width ink. */
  pressure?: number;
  /**
   * How far the stylus barrel was tilted off vertical, as the unit vector it
   * leans along scaled by that lean: `(0, 0)` is a pen held upright and a
   * magnitude of 1 is one laid flat on the page.
   *
   * Two channels rather than an angle pair because this is what the hardware
   * reports (`tiltX`/`tiltY`, normalized off their ±90° range) and because the
   * renderer wants the vector, not the angles: the nib broadens across the
   * direction of lean, so both which way and how far are needed at once.
   * Absent on every non-stylus sample and on every stroke drawn before tilt
   * was recorded.
   */
  tiltX?: number;
  tiltY?: number;
}

/**
 * Serializable pressure curve used by the freehand radius model.
 *
 * `linear`, `ease-out-sine`, `stylus` and `smoothstep` are the automatic
 * curves, chosen from the input the stroke was drawn with. `soft` and `firm`
 * are the two deliberate ends of the pen-response preference: `soft` reaches
 * full width under a light hand, `firm` holds a fine line until the pen is
 * pressed.
 */
export type PressureEasing =
  | 'linear'
  | 'ease-out-sine'
  | 'stylus'
  | 'smoothstep'
  | 'soft'
  | 'firm';

export interface DrawProps {
  /** Versioned geometry keeps existing documents visually stable. */
  inkAlgorithm?: 'reference';
  /** New highlights use a background wash and a foreground tint. */
  inkKind?: 'highlight';
  /** False while samples are arriving; absent means a completed legacy stroke. */
  isComplete?: boolean;
  /** Ink points in shape-local coordinates (append-only under the CRDT). */
  points: DrawPoint[];
  /** Whether the stroke ended near enough to its start to enclose a region. */
  isClosed: boolean;
  color: string;
  size: number;
  /** Stroke dash style. Undefined preserves legacy solid ink. */
  dash?: StrokeDash;
  /** Interior fill, applied only when `isClosed`. Undefined reads as 'none'. */
  fillStyle?: FillStyle;
  /** Whether to derive pressure from pointer velocity instead of hardware pressure. */
  simulatePressure?: boolean;
  /** Pressure curve captured with the stroke; absent preserves legacy rendering. */
  pressureEasing?: PressureEasing;
  /** Whether the opening pressure is conditioned over the first five brush widths. */
  pressureWarmup?: boolean;
  /** Pressure-to-width multiplier. Undefined preserves legacy uniform strokes. */
  thinning?: number;
  /** Softening applied while constructing the outline. */
  smoothing?: number;
  /** EMA-style point streamlining before outline generation. */
  streamline?: number;
  /** Optional taper distance at the beginning of the stroke. */
  startTaper?: number | boolean;
  /** Optional taper distance at the end of the stroke. */
  endTaper?: number | boolean;
  /**
   * How strongly stylus tilt broadens the nib, 0..1. Undefined preserves
   * strokes drawn before tilt was read, which render as an upright pen.
   */
  tiltAmount?: number;
}

export interface RectangleProps {
  w: number;
  h: number;
  color: string;
  fillStyle: FillStyle;
  dash: StrokeDash;
  size: number;
}

export interface EllipseProps {
  w: number;
  h: number;
  color: string;
  fillStyle: FillStyle;
  dash: StrokeDash;
  size: number;
}

export interface PolygonProps {
  w: number;
  h: number;
  kind: PolygonKind;
  color: string;
  fillStyle: FillStyle;
  dash: StrokeDash;
  size: number;
}

export interface LineProps {
  /** Endpoints in shape-local coordinates (first and last are the vertices). */
  points: Vec[];
  color: string;
  size: number;
  dash: StrokeDash;
  /**
   * Curve amount: signed perpendicular offset (world units) of the curve's apex
   * from the chord midpoint. 0 = straight; non-zero bends into a quadratic arc.
   */
  bend: number;
  /** Multi-point interpolation. Omitted legacy lines remain linear. */
  spline?: LineSpline;
  /** Optional centered label. */
  label?: string;
}

export interface ArrowProps {
  points: Vec[];
  color: string;
  size: number;
  dash: StrokeDash;
  arrowStart: boolean;
  arrowEnd: boolean;
  /** See {@link LineProps.bend}. */
  bend: number;
  /** Omitted legacy arrows render as straight, unless their bend is non-zero. */
  topology?: ArrowTopology;
  /** Optional live bindings to closed target shapes. */
  bindings?: {
    start?: ConnectorBinding | null;
    end?: ConnectorBinding | null;
  };
  /** Optional centered label. */
  label?: string;
}

export interface TextProps {
  text: string;
  color: string;
  fontSize: number;
  fontFamily: FontFamily;
  /** Omitted legacy values render at 400. */
  fontWeight?: FontWeight;
  /** Explicit geometry state. Omitted on legacy shapes; inferred from width. */
  sizingMode?: TextSizingMode;
  /** Fixed wrap width in world units. Ignored while sizingMode is auto. */
  width: number;
  /** Unitless line-height multiplier. Omitted legacy values use 1.2. */
  lineHeight?: number;
  align: TextAlign;
}

export interface ImageProps {
  /** Server blob id (content-addressed) backing this image. */
  blobId: string;
  /** Rendered size in world units. */
  w: number;
  h: number;
  /** Intrinsic pixel dimensions (for aspect ratio / re-fit). */
  naturalWidth: number;
  naturalHeight: number;
  /**
   * Blob id of a small copy (`IMAGE_THUMB_PX` on the long side) drawn in place
   * of `blobId` once the image is small on screen. Optional: images uploaded
   * before thumbnails existed, and ones already small, have none and always
   * draw the original. Old clients ignore it.
   */
  thumbBlobId?: string;
  /**
   * Visible sub-rectangle of the source image, as fractions in [0..1]. Omitted
   * means the full image is shown. Scale-invariant, so it survives resizing.
   */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface StickerProps {
  /**
   * Catalog id of the stamp artwork (e.g. "thumbs-up"). Deliberately a plain
   * string, not a union: the catalog lives client-side, so it can grow without
   * a shared-types change, and a peer on an older build renders a fallback
   * glyph instead of failing on an id it doesn't know.
   */
  sticker: string;
  /**
   * Blob id of a user-uploaded sticker's artwork (`/api/blobs/<blobId>`).
   * Absent on the built-in stamps, which draw vector art keyed by `sticker`.
   *
   * Copied onto the shape rather than looked up from the board's sticker
   * library, so a stamp keeps rendering after its library entry is removed.
   */
  blobId?: string;
  /** Rendered size in world units. */
  w: number;
  h: number;
}

export interface VideoProps {
  /** YouTube video id (e.g. "dQw4w9WgXcQ"). */
  videoId: string;
  /** Rendered size in world units. */
  w: number;
  h: number;
}

/**
 * A pasted link, rendered as a preview card. Metadata arrives asynchronously
 * (see the client's `place-link.ts`), so every field but `url` is optional and
 * the card renders from whatever has landed so far.
 */
export interface BookmarkProps {
  /**
   * Target URL. Only http(s) links are ever created, but the value travels
   * through the CRDT, so anything that opens or renders it re-checks the
   * protocol rather than trusting the stored string.
   */
  url: string;
  /** Rendered size in world units. */
  w: number;
  h: number;
  /**
   * Whether the metadata fetch has settled. Stays 'loading' only while it is
   * in flight — a failed unfurl still resolves to 'ready' so a peer that joins
   * afterwards doesn't render a placeholder forever.
   */
  status: 'loading' | 'ready';
  title?: string;
  description?: string;
  /**
   * Blob ids of the unfurled preview image and site icon. The server stores
   * them alongside pasted images rather than the card pointing at the origin,
   * so a card can't phone home from a viewer's browser and PNG export inlines
   * it like any other image.
   */
  imageBlobId?: string;
  faviconBlobId?: string;
}

export interface GraphViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Parameter range swept by a parametric expression like `(cos(t), sin(t))`. */
export interface GraphParametricDomain {
  min: number;
  max: number;
}

export interface GraphExpression {
  id: string;
  /**
   * Explicit expression in `x`, an implicit equation in `x` and `y`, or a
   * coordinate `(a, b)` — a plotted point, or a parametric curve when it
   * references `t`.
   */
  expression: string;
  color: string;
  visible: boolean;
  dash: StrokeDash;
  /** Curve stroke width. Absent on boards saved before this was adjustable. */
  width?: number;
  /** `t` range for parametric expressions. Absent means the default sweep. */
  domain?: GraphParametricDomain;
}

export interface GraphParameter {
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface GraphPoint {
  id: string;
  x: number;
  y: number;
  color: string;
  visible: boolean;
}

export interface GraphProps {
  /** Rendered plot size in world units. */
  w: number;
  h: number;
  viewport: GraphViewport;
  expressions: GraphExpression[];
  parameters: Record<string, GraphParameter>;
  /** Whether tick numbers are shown along the visible axes. */
  showAxisLabels: boolean;
  /**
   * Points from the retired points list, still rendered for boards that have
   * them. New points come from `(x, y)` expressions.
   */
  points?: GraphPoint[];
  /** Render intersection markers for explicit curves. Defaults to false. */
  showIntersections?: boolean;
}

export interface EquationProps {
  /** LaTeX source. */
  latex: string;
  /**
   * Typeset in text style rather than display style: limits beside `\sum`
   * rather than above it, smaller fractions — the conventions for math set in
   * a line of prose. Absent on every equation written before the choice
   * existed, and on every one since that didn't ask for it.
   */
  inline?: boolean;
  /** Applied as currentColor to the MathJax SVG paths. */
  color: string;
  /** Typographic scale in world units. */
  fontSize: number;
  /** Cached rendered size in world units. */
  w: number;
  h: number;
}

/** A group is a pure container: no geometry of its own, bounds = children. */
export type GroupProps = Record<string, never>;

export interface FrameProps {
  /** Frame size in world units (origin at the shape's x,y). */
  w: number;
  h: number;
  /** Title shown above the frame. */
  name: string;
  /** Border and title color. Absent on boards created before colored frames. */
  color?: string;
}

export type DrawShape = BaseShape<'draw', DrawProps>;
export type RectangleShape = BaseShape<'rectangle', RectangleProps>;
export type EllipseShape = BaseShape<'ellipse', EllipseProps>;
export type PolygonShape = BaseShape<'polygon', PolygonProps>;
export type LineShape = BaseShape<'line', LineProps>;
export type ArrowShape = BaseShape<'arrow', ArrowProps>;
export type TextShape = BaseShape<'text', TextProps>;
export type ImageShape = BaseShape<'image', ImageProps>;
export type StickerShape = BaseShape<'sticker', StickerProps>;
export type VideoShape = BaseShape<'video', VideoProps>;
export type BookmarkShape = BaseShape<'bookmark', BookmarkProps>;
export type GraphShape = BaseShape<'graph', GraphProps>;
export type EquationShape = BaseShape<'equation', EquationProps>;
export type GroupShape = BaseShape<'group', GroupProps>;
export type FrameShape = BaseShape<'frame', FrameProps>;

/**
 * The extensible discriminated union of all shapes. Adding a new shape later
 * (equation, graph, image, ...) means adding a variant here and registering a
 * ShapeUtil — never touching the core canvas/selection code.
 */
export type Shape =
  | DrawShape
  | RectangleShape
  | EllipseShape
  | PolygonShape
  | LineShape
  | ArrowShape
  | TextShape
  | ImageShape
  | StickerShape
  | VideoShape
  | BookmarkShape
  | GraphShape
  | EquationShape
  | GroupShape
  | FrameShape;

export type ShapeType = Shape['type'];

/** Type -> concrete shape, for typed registry definitions. */
export interface ShapeMap {
  draw: DrawShape;
  rectangle: RectangleShape;
  ellipse: EllipseShape;
  polygon: PolygonShape;
  line: LineShape;
  arrow: ArrowShape;
  text: TextShape;
  image: ImageShape;
  sticker: StickerShape;
  video: VideoShape;
  bookmark: BookmarkShape;
  graph: GraphShape;
  equation: EquationShape;
  group: GroupShape;
  frame: FrameShape;
}

/** Container shapes own children via `parentId`. */
export function isContainerType(type: ShapeType): boolean {
  return type === 'group' || type === 'frame';
}

export function isShapeType<T extends ShapeType>(
  shape: Shape,
  type: T,
): shape is ShapeMap[T] {
  return shape.type === type;
}
