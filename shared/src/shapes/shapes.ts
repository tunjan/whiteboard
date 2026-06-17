import type { Vec } from '../geometry';
import type { BaseShape } from './base';

// Style primitives.
export type FillStyle = 'none' | 'solid' | 'hatch' | 'crosshatch';
export type StrokeDash = 'solid' | 'dashed' | 'dotted';

/** Regular/normalized polygons that fit a w x h box. */
export type PolygonKind =
  | 'triangle'
  | 'diamond'
  | 'trapezoid'
  | 'pentagon'
  | 'hexagon';

/** Text font families (mapped to concrete font stacks on the client). */
export type FontFamily = 'sans' | 'serif' | 'mono';

/** Horizontal text alignment. */
export type TextAlign = 'start' | 'middle' | 'end';

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
}

export interface TextProps {
  text: string;
  color: string;
  fontSize: number;
  fontFamily: FontFamily;
  /** Fixed wrap width in world units (0 = auto-grow to content). */
  width: number;
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
}

export interface PlotCurve {
  id: string;
  /** Math expression in terms of `x`, e.g. `sin(x)` or `x^2 - 3`. */
  expression: string;
  color: string;
  enabled: boolean;
}

export interface PlotProps {
  /** Rendered card size in world units. */
  w: number;
  h: number;
  /** Visible x-domain. */
  xMin: number;
  xMax: number;
  /** Visible y-range. */
  yMin: number;
  yMax: number;
  curves: PlotCurve[];
  showGrid: boolean;
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
export type PlotShape = BaseShape<'plot', PlotProps>;
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
  | PlotShape
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
  plot: PlotShape;
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
