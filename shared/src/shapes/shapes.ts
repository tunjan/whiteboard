import type { Vec } from '../geometry';
import type { BaseShape } from './base';

// Style primitives.
export type FillStyle = 'none' | 'solid' | 'hatch' | 'crosshatch';
export type StrokeDash = 'solid' | 'dashed' | 'dotted';

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
  | 'triangle'
  | 'diamond'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon';

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
}

export interface DrawProps {
  /** Ink points in shape-local coordinates (append-only under the CRDT). */
  points: DrawPoint[];
  isClosed: boolean;
  color: string;
  size: number;
  /** Stroke dash style. Undefined preserves legacy solid ink. */
  dash?: StrokeDash;
  /** Whether to derive pressure from pointer velocity instead of hardware pressure. */
  simulatePressure?: boolean;
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
   * Visible sub-rectangle of the source image, as fractions in [0..1]. Omitted
   * means the full image is shown. Scale-invariant, so it survives resizing.
   */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface VideoProps {
  /** YouTube video id (e.g. "dQw4w9WgXcQ"). */
  videoId: string;
  /** Rendered size in world units. */
  w: number;
  h: number;
}

export interface GraphViewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface GraphExpression {
  id: string;
  /** Explicit expression in `x`, or an implicit equation in `x` and `y`. */
  expression: string;
  color: string;
  visible: boolean;
  dash: StrokeDash;
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
  /** Discrete plotted points. Absent on boards saved before this feature. */
  points?: GraphPoint[];
  /** Render intersection markers for explicit curves. Defaults to false. */
  showIntersections?: boolean;
}

export interface EquationProps {
  /** LaTeX source rendered in display mode. */
  latex: string;
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
}

export type DrawShape = BaseShape<'draw', DrawProps>;
export type RectangleShape = BaseShape<'rectangle', RectangleProps>;
export type EllipseShape = BaseShape<'ellipse', EllipseProps>;
export type PolygonShape = BaseShape<'polygon', PolygonProps>;
export type LineShape = BaseShape<'line', LineProps>;
export type ArrowShape = BaseShape<'arrow', ArrowProps>;
export type TextShape = BaseShape<'text', TextProps>;
export type ImageShape = BaseShape<'image', ImageProps>;
export type VideoShape = BaseShape<'video', VideoProps>;
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
  | VideoShape
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
  video: VideoShape;
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
