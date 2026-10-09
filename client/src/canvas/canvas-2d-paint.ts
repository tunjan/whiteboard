// What a shape looks like, as instructions a 2D context can carry out.
//
// The DOM renderer hands each shape's util a React tree and lets the browser
// rasterize it. A canvas has no such intermediary, so this module states the
// same visuals as a short list of ops. It builds them from the SAME geometry
// helpers the SVG components use — `curvePath`, `arrowheadPath`,
// `synthesizeDrawPaths`, `mergedRectPath`, `layoutTextProps`, `dashProps` — so
// the only thing restated here is which paint attribute goes where, and the two
// renderers cannot drift apart on the shape of anything.
//
// Ops carry path DATA rather than `Path2D`: building is then pure and testable
// without a DOM, and `compilePaint` turns the strings into `Path2D` once, when
// the entry enters the renderer's cache. Everything that depends on the camera
// — a screen-width stroke, the frame heading's zoom-compensated layout — is
// resolved at paint time instead, because a zoom must not rebuild geometry.
//
// Shapes are built in LOCAL coordinates (the shape's own origin at 0,0), which
// is the space `composeShapeTransform` leaves the context in and the space the
// DOM layer's per-shape container establishes with its own transform.
import type {
  FillStyle,
  FrameShape,
  Shape,
  StrokeDash,
  Vec,
} from '@whiteboard/shared';
import { inkPaint } from './ink-color';
import {
  FRAME_HEADING_FONT_SCREEN,
  frameHeadingLayout,
  frameHeadingText,
} from './frame-geometry';
import { imageHref } from '../board/blobs';
import { squaredCorners, mergedRectPath } from './shapes/image-merge';
import { shadowRings, roundedRectPath } from './shapes/painted-shadow';
import {
  synthesizeDrawPaths,
  ellipseSynthesisPoints,
} from './shapes/geometry-synthesis';
import {
  arrowPath,
  arrowPoints,
  arrowheadPath,
  arrowheadPoints,
  curvePath,
  curvePoints,
  pathMidpoint,
  polylinePath,
  tangentAnchor,
} from './shapes/line-geometry';
import { ellipsePerimeter, polylineLength } from './shapes/perfect-dash';
import { polygonVerticesForBox } from './shapes/polygon-geometry';
import { dashProps, strokeLineCap } from './shapes/render-style';
import { MEDIA_CORNER_RADIUS } from './shapes/style';
import { fontStack, fontWeight, layoutTextProps } from './shapes/text-measure';
import { youtubeThumbnail } from './shapes/video';
import { usesImageThumb, type LodDetail } from './lod';

/** Fill opacity the SVG components give a `solid` fill. */
const SOLID_FILL_OPACITY = 0.18;
/** Cell size and line weight of the hatch fills, in world units. */
const HATCH_SPACING = 7;
const HATCH_WIDTH = 1;

const IMAGE_SHADOW = { dy: 1, blur: 1, opacity: 0.08 };
const VIDEO_SHADOW = { dy: 1, blur: 1, opacity: 0.08 };
const MEDIA_BORDER_WIDTH = 1.5;
const FRAME_BORDER_WIDTH = 1.25;
const LABEL_FONT = "'Inter Variable', system-ui, sans-serif";

export type PaintFill =
  | { kind: 'color'; color: string }
  /** Painted as clipped parallel lines rather than as a tiled bitmap: a
   *  `<pattern>` rasterized once and scaled by the camera goes soft exactly
   *  where someone zoomed in to look at it. */
  | {
      kind: 'hatch';
      color: string;
      crosshatch: boolean;
      /** The local box the lines are laid across — a clip has no bounds. */
      w: number;
      h: number;
    };

export interface PathOp {
  kind: 'path';
  /** SVG path data, in shape-local coordinates. */
  d: string;
  fill?: PaintFill;
  fillAlpha?: number;
  stroke?: string;
  strokeAlpha?: number;
  width?: number;
  /** `width` is screen pixels, not world units — SVG `non-scaling-stroke`. */
  screenWidth?: boolean;
  dash?: number[];
  dashOffset?: number;
  cap?: CanvasLineCap;
  join?: CanvasLineJoin;
  /** Downward offset applied to this op alone, for the painted drop shadows. */
  dy?: number;
}

export interface ImageOp {
  kind: 'image';
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** SVG `preserveAspectRatio`: `none` stretches, `slice` covers, `meet` fits. */
  fit: 'none' | 'slice' | 'meet';
  /** Path data the image is clipped to, for rounded media corners. */
  clip?: string;
  /** Another copy of the same picture to draw while `src` loads, if this
   *  client already holds it — never fetched for the purpose. Crossing the
   *  thumbnail threshold swaps sources, and without this the image would
   *  vanish for the length of a download. */
  fallback?: string;
}

export interface TextOp {
  kind: 'text';
  text: string;
  x: number;
  y: number;
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  fill: string;
  /** The `paint-order="stroke"` halo some labels carry, in world units. */
  halo?: { color: string; width: number };
}

/**
 * The frame's title, which holds its screen size as the camera zooms.
 *
 * Kept as an op rather than resolved into a {@link TextOp} at build time
 * because every term in it — the font size, the ellipsis, which edge it sits
 * on — is a function of the zoom, and rebuilding a frame's geometry on every
 * pinch frame is the cost this renderer exists to remove.
 */
export interface HeadingOp {
  kind: 'heading';
  /** The frame at its local origin; the layout reads its size and rotation. */
  frame: FrameShape;
  color: string;
  halo: string;
}

export type PaintOp = PathOp | ImageOp | TextOp | HeadingOp;

/** What the current zoom has decided about detail, for the builders that care. */
export interface PaintLod {
  /** Strokes finer than this carry no pattern — see `isBelowPatternDetail`. */
  patternCutoff: number;
  detail: LodDetail;
  /** Images this long or shorter draw their thumbnail — see
   *  `imageThumbCutoff`. Absent draws every original. */
  imageThumbCutoff?: number;
}

export interface PaintEnv {
  /** Resolves `var(--name)` paints; hold one per theme. */
  resolve: (input: string) => string;
  lod: PaintLod;
  /** Corner mask for an image flush against its neighbours (`squaredCorners`). */
  corners?: number;
}

/** The types this renderer paints. Everything else is delegated to the DOM. */
export const CANVAS_PAINTED_TYPES: ReadonlySet<string> = new Set([
  'draw',
  'rectangle',
  'ellipse',
  'polygon',
  'line',
  'arrow',
  'text',
  'image',
  'video',
  'frame',
  'group',
]);

/**
 * Types kept in the DOM, and why each one is not a rasterization problem:
 * `sticker` is lucide artwork authored as React elements, `equation` a MathJax
 * SVG document, `graph` owns its own wheel gesture, and `bookmark` is a card of
 * live text. Painting them would mean re-authoring them, and all four are rare
 * enough that a DOM node each costs nothing on the boards this renderer is for.
 */
export const DOM_SHAPE_TYPES: ReadonlySet<string> = new Set([
  'sticker',
  'equation',
  'graph',
  'bookmark',
]);

/** The dash a stroke of `size` actually paints with — the `useLodDash` rule. */
export function lodDash(
  dash: StrokeDash,
  size: number,
  lod: PaintLod,
): StrokeDash {
  return dash !== 'solid' && size < lod.patternCutoff ? 'solid' : dash;
}

/** `stroke-dasharray`/`-dashoffset` as the numbers `setLineDash` wants. */
function dashFor(
  dash: StrokeDash,
  size: number,
  length: number,
  closed = false,
): Pick<PathOp, 'dash' | 'dashOffset'> {
  const props = dashProps(dash, size, length, closed ? { closed } : {});
  if (!props.strokeDasharray) return {};
  return {
    dash: String(props.strokeDasharray)
      .split(/[\s,]+/)
      .map(Number),
    dashOffset: Number(props.strokeDashoffset ?? 0),
  };
}

/** The `d` of a closed polygon through `points`. */
function closedPath(points: readonly Vec[]): string {
  return `${polylinePath(points)} Z`;
}

/** The two-pass hand-drawn outline, as one op per pass. */
function drawnOutline(
  points: readonly Vec[],
  seed: string,
  color: string,
  size: number,
  closed: boolean,
): PathOp[] {
  return synthesizeDrawPaths(points, { seed, size, closed }).map((d) => ({
    kind: 'path' as const,
    d,
    stroke: color,
    width: size,
    cap: 'round' as const,
    join: 'round' as const,
  }));
}

/** Each edge dashed on its own arc length, as `DashedOutline` does. */
function dashedOutline(
  points: readonly Vec[],
  dash: Extract<StrokeDash, 'dashed' | 'dotted'>,
  color: string,
  size: number,
): PathOp[] {
  return points.map((from, i) => {
    const to = points[(i + 1) % points.length]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return {
      kind: 'path' as const,
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      stroke: color,
      width: size,
      cap: 'round' as const,
      ...dashFor(dash, size, length),
    };
  });
}

/** The fill a shape's `fillStyle` asks for, or nothing. */
export function fillOp(
  d: string,
  color: string,
  fillStyle: FillStyle,
  w: number,
  h: number,
): PathOp | null {
  if (fillStyle === 'solid')
    return {
      kind: 'path',
      d,
      fill: { kind: 'color', color },
      fillAlpha: SOLID_FILL_OPACITY,
    };
  if (fillStyle === 'hatch' || fillStyle === 'crosshatch')
    return {
      kind: 'path',
      d,
      fill: {
        kind: 'hatch',
        color,
        crosshatch: fillStyle === 'crosshatch',
        w,
        h,
      },
    };
  return null;
}

/** The label a line or an arrow carries at its midpoint. */
function connectorLabel(
  label: string | undefined,
  points: readonly Vec[],
  size: number,
  color: string,
  background: string,
): TextOp[] {
  const text = label?.trim();
  if (!text) return [];
  const middle = pathMidpoint(points);
  const length = Math.hypot(middle.tangent.x, middle.tangent.y) || 1;
  const fontSize = Math.max(12, size * 3);
  return [
    {
      kind: 'text',
      text,
      x: middle.point.x - (middle.tangent.y / length) * (size + 9),
      y: middle.point.y + (middle.tangent.x / length) * (size + 9),
      font: `${fontSize}px ${LABEL_FONT}`,
      align: 'center',
      baseline: 'middle',
      fill: color,
      halo: { color: background, width: 4 },
    },
  ];
}

/** The painted drop shadow of an opaque silhouette — see `PaintedShadow`. */
function shadowOps(
  d: string,
  { dy, blur, opacity }: { dy: number; blur: number; opacity: number },
): PathOp[] {
  return shadowRings(blur, opacity).map(({ distance, alpha }) => ({
    kind: 'path' as const,
    d,
    dy,
    fill: { kind: 'color' as const, color: '#000000' },
    fillAlpha: alpha,
    stroke: '#000000',
    strokeAlpha: alpha,
    width: distance * 2,
    join: 'round' as const,
  }));
}

/**
 * Every op that draws `shape`, in paint order.
 *
 * `shape` is read for its props and rotation only; its position is carried by
 * the context transform, exactly as the DOM layer carries it on the container.
 */
export function buildPaint(shape: Shape, env: PaintEnv): PaintOp[] {
  const { resolve, lod } = env;
  const paint = (color: string) => resolve(inkPaint(color));
  switch (shape.type) {
    case 'group':
      return [];
    case 'rectangle': {
      const { w, h, fillStyle, size } = shape.props;
      const color = paint(shape.props.color);
      const dash = lodDash(shape.props.dash, size, lod);
      const points: Vec[] = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
      const d = closedPath(points);
      const ops: PaintOp[] = [];
      const fill = fillOp(d, color, fillStyle, w, h);
      if (fill) ops.push(fill);
      if (dash === 'solid')
        ops.push({
          kind: 'path',
          d,
          stroke: color,
          width: size,
          join: 'round',
        });
      else if (dash === 'draw')
        ops.push(...drawnOutline(points, shape.id, color, size, true));
      else ops.push(...dashedOutline(points, dash, color, size));
      return ops;
    }
    case 'ellipse': {
      const { w, h, fillStyle, size } = shape.props;
      const color = paint(shape.props.color);
      const dash = lodDash(shape.props.dash, size, lod);
      const d = ellipsePath(w / 2, h / 2, w / 2, h / 2);
      const ops: PaintOp[] = [];
      const fill = fillOp(d, color, fillStyle, w, h);
      if (fill) ops.push(fill);
      if (dash === 'draw')
        ops.push(
          ...drawnOutline(
            ellipseSynthesisPoints(w / 2, h / 2, w / 2, h / 2),
            shape.id,
            color,
            size,
            true,
          ),
        );
      else
        ops.push({
          kind: 'path',
          d,
          stroke: color,
          width: size,
          cap: strokeLineCap(dash),
          ...dashFor(dash, size, ellipsePerimeter(w / 2, h / 2), true),
        });
      return ops;
    }
    case 'polygon': {
      const { w, h, kind, fillStyle, size } = shape.props;
      const color = paint(shape.props.color);
      const dash = lodDash(shape.props.dash, size, lod);
      const points = polygonVerticesForBox(kind, 0, 0, w, h);
      const d = closedPath(points);
      const ops: PaintOp[] = [];
      const fill = fillOp(d, color, fillStyle, w, h);
      if (fill) ops.push(fill);
      if (dash === 'solid')
        ops.push({
          kind: 'path',
          d,
          stroke: color,
          width: size,
          join: 'round',
        });
      else if (dash === 'draw')
        ops.push(...drawnOutline(points, shape.id, color, size, true));
      else ops.push(...dashedOutline(points, dash, color, size));
      return ops;
    }
    case 'line': {
      const { points, size, bend, spline, label } = shape.props;
      if (points.length < 2) return [];
      const color = paint(shape.props.color);
      const dash = lodDash(shape.props.dash, size, lod);
      const curve = curvePoints(points, bend ?? 0, spline ?? 'linear');
      const ops: PaintOp[] =
        dash === 'draw'
          ? drawnOutline(curve, shape.id, color, size, false)
          : [
              {
                kind: 'path',
                d: curvePath(points, bend ?? 0, spline ?? 'linear'),
                stroke: color,
                width: size,
                cap: 'round',
                join: 'round',
                ...dashFor(dash, size, polylineLength(curve)),
              },
            ];
      ops.push(
        ...connectorLabel(
          label,
          curve,
          size,
          color,
          resolve('var(--color-background)'),
        ),
      );
      return ops;
    }
    case 'arrow': {
      const { points, size, arrowStart, arrowEnd, bend, label } = shape.props;
      if (points.length < 2) return [];
      const color = paint(shape.props.color);
      const dash = lodDash(shape.props.dash, size, lod);
      const topology =
        shape.props.topology ??
        (Math.abs(bend ?? 0) >= 0.5 ? 'arc' : 'straight');
      const body = arrowPoints(points, topology, bend ?? 0);
      const first = body[0]!;
      const last = body[body.length - 1]!;
      const ops: PaintOp[] = [];
      if (dash === 'draw') {
        ops.push(...drawnOutline(body, `${shape.id}:body`, color, size, false));
        if (arrowStart)
          ops.push(
            ...drawnOutline(
              arrowheadPoints(tangentAnchor(body, true), first, size),
              `${shape.id}:start`,
              color,
              size,
              false,
            ),
          );
        if (arrowEnd)
          ops.push(
            ...drawnOutline(
              arrowheadPoints(tangentAnchor(body, false), last, size),
              `${shape.id}:end`,
              color,
              size,
              false,
            ),
          );
      } else {
        ops.push({
          kind: 'path',
          d: arrowPath(points, topology, bend ?? 0),
          stroke: color,
          width: size,
          cap: 'round',
          join: 'round',
          ...dashFor(dash, size, polylineLength(body)),
        });
        const heads = [
          arrowStart
            ? arrowheadPath(tangentAnchor(body, true), first, size)
            : '',
          arrowEnd ? arrowheadPath(tangentAnchor(body, false), last, size) : '',
        ]
          .filter(Boolean)
          .join(' ');
        if (heads)
          ops.push({
            kind: 'path',
            d: heads,
            stroke: color,
            width: size,
            cap: 'round',
            join: 'round',
          });
      }
      ops.push(
        ...connectorLabel(
          label,
          body,
          size,
          color,
          resolve('var(--color-background)'),
        ),
      );
      return ops;
    }
    case 'text': {
      const { text, fontSize, fontFamily } = shape.props;
      if (!text) return [];
      const layout = layoutTextProps(shape.props);
      const color = paint(shape.props.color);
      const font = `${fontWeight(shape.props.fontWeight)} ${fontSize}px ${fontStack(fontFamily)}`;
      // Each line carries its own x from the layout, so the context stays
      // left-aligned and alignment is already in the geometry.
      return layout.lines.map((line) => ({
        kind: 'text' as const,
        text: line.text,
        x: line.x,
        y: line.baseline,
        font,
        align: 'left' as const,
        baseline: 'alphabetic' as const,
        fill: color,
      }));
    }
    case 'image': {
      const { blobId, thumbBlobId, w, h, crop } = shape.props;
      const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
      const outline = mergedRectPath(0, 0, w, h, radius, env.corners ?? 0);
      const original = imageHref(shape.id, blobId);
      const thumb =
        thumbBlobId &&
        usesImageThumb(shape.props, lod.imageThumbCutoff ?? 0)
          ? imageHref(shape.id, thumbBlobId)
          : null;
      const href = thumb ?? original;
      if (!href)
        return [
          {
            kind: 'path',
            d: outline,
            fill: { kind: 'color', color: resolve('var(--color-muted)') },
            stroke: resolve('var(--color-border)'),
            width: MEDIA_BORDER_WIDTH,
            screenWidth: true,
          },
        ];
      // With a crop the full source is drawn scaled so the crop sub-rect fills
      // the box, and the outline clip keeps only the box.
      const fullW = crop ? w / crop.w : w;
      const fullH = crop ? h / crop.h : h;
      const ops: PaintOp[] = [];
      if (lod.detail === 'high') ops.push(...shadowOps(outline, IMAGE_SHADOW));
      ops.push({
        kind: 'image',
        src: href,
        x: crop ? -crop.x * fullW : 0,
        y: crop ? -crop.y * fullH : 0,
        w: fullW,
        h: fullH,
        fit: 'none',
        clip: outline,
        fallback: thumb
          ? (original ?? undefined)
          : thumbBlobId
            ? (imageHref(shape.id, thumbBlobId) ?? undefined)
            : undefined,
      });
      ops.push({
        kind: 'path',
        d: outline,
        stroke: resolve('var(--color-border)'),
        width: MEDIA_BORDER_WIDTH,
        screenWidth: true,
      });
      return ops;
    }
    case 'video': {
      const { videoId, w, h } = shape.props;
      if (!videoId) return [];
      const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
      const outline = roundedRectPath(0, 0, w, h, radius);
      const ops: PaintOp[] = [];
      if (lod.detail === 'high') ops.push(...shadowOps(outline, VIDEO_SHADOW));
      ops.push({
        kind: 'path',
        d: outline,
        fill: { kind: 'color', color: '#000000' },
      });
      ops.push({
        kind: 'image',
        src: youtubeThumbnail(videoId),
        x: 0,
        y: 0,
        w,
        h,
        fit: 'slice',
        clip: outline,
      });
      // The play badge, sized against the box exactly as the SVG does.
      const cx = w / 2;
      const cy = h / 2;
      const badge = Math.max(12, Math.min(w, h) * 0.16);
      const tri = badge * 0.42;
      ops.push({
        kind: 'path',
        d: ellipsePath(cx, cy, badge, badge),
        fill: { kind: 'color', color: '#000000' },
        fillAlpha: 0.55,
      });
      ops.push({
        kind: 'path',
        d: `M ${cx - tri * 0.5} ${cy - tri} L ${cx + tri} ${cy} L ${cx - tri * 0.5} ${cy + tri} Z`,
        fill: { kind: 'color', color: '#ffffff' },
      });
      ops.push({
        kind: 'path',
        d: outline,
        stroke: resolve('var(--color-border)'),
        strokeAlpha: 0.75,
        width: 1,
        screenWidth: true,
      });
      return ops;
    }
    case 'frame': {
      const { w, h } = shape.props;
      const color = resolve(
        inkPaint(shape.props.color ?? 'var(--color-muted-foreground)'),
      );
      return [
        {
          kind: 'path',
          d: `M0 0 H${w} V${h} H0 Z`,
          fill: { kind: 'color', color: resolve('var(--color-card)') },
          fillAlpha: 0.96,
        },
        {
          kind: 'path',
          d: `M0 0 H${w} V${h} H0 Z`,
          stroke: color,
          strokeAlpha: 0.68,
          width: FRAME_BORDER_WIDTH,
          screenWidth: true,
        },
        {
          kind: 'heading',
          frame: { ...shape, x: 0, y: 0 },
          color,
          halo: resolve('var(--color-background)'),
        },
      ];
    }
    default:
      return [];
  }
}

/** A full ellipse as path data, so every op can carry one kind of geometry. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return (
    `M${cx - rx} ${cy}` +
    `A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}` +
    `A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}Z`
  );
}

/**
 * The image corner mask for `shape`, which depends on its neighbours rather
 * than on itself — the non-hook half of `useMergedCorners`.
 */
export function imageCorners(
  shape: Extract<Shape, { type: 'image' }>,
  neighbours: readonly {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }[],
): number {
  if (shape.rotation) return 0;
  return squaredCorners(
    {
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + shape.props.w,
      maxY: shape.y + shape.props.h,
    },
    neighbours,
  );
}

/** Ops with their path data compiled; see the note at the top of the file. */
export interface CompiledOp {
  op: PaintOp;
  path?: Path2D;
  clip?: Path2D;
}

export function compilePaint(ops: readonly PaintOp[]): CompiledOp[] {
  return ops.map((op) => {
    if (op.kind === 'path') return { op, path: new Path2D(op.d) };
    if (op.kind === 'image' && op.clip)
      return { op, clip: new Path2D(op.clip) };
    return { op };
  });
}

/** Everything the executor needs that an op cannot carry. */
export interface PaintContext {
  /** Current camera zoom, for screen-sized strokes and the frame heading. */
  zoom: number;
  /** Resolves an image source to something drawable, or null while it loads.
   *  With `load` false, only answers from what is already loaded. */
  image: (src: string, load?: boolean) => CanvasImageSource | null;
}

/**
 * Run `ops` on `ctx`, which is already transformed into the shape's local
 * space, at `alpha`.
 *
 * The context state is left as found for the alpha only; stroke and fill styles
 * are the caller's to re-establish, which the renderer does once per pass.
 */
export function paintCompiled(
  ctx: CanvasRenderingContext2D,
  ops: readonly CompiledOp[],
  alpha: number,
  env: PaintContext,
): void {
  for (const { op, path, clip } of ops) {
    switch (op.kind) {
      case 'path':
        paintPath(ctx, op, path!, alpha, env);
        break;
      case 'image':
        paintImage(ctx, op, clip, alpha, env);
        break;
      case 'text':
        paintText(ctx, op, alpha);
        break;
      case 'heading':
        paintHeading(ctx, op, alpha, env);
        break;
    }
  }
}

function paintPath(
  ctx: CanvasRenderingContext2D,
  op: PathOp,
  path: Path2D,
  alpha: number,
  env: PaintContext,
): void {
  if (op.dy) {
    ctx.save();
    ctx.translate(0, op.dy);
  }
  if (op.fill) {
    ctx.globalAlpha = alpha * (op.fillAlpha ?? 1);
    if (op.fill.kind === 'color') {
      ctx.fillStyle = op.fill.color;
      ctx.fill(path);
    } else {
      paintHatch(ctx, path, op.fill);
    }
  }
  if (op.stroke) {
    ctx.globalAlpha = alpha * (op.strokeAlpha ?? 1);
    ctx.strokeStyle = op.stroke;
    ctx.lineWidth = op.screenWidth
      ? (op.width ?? 1) / env.zoom
      : (op.width ?? 1);
    ctx.lineCap = op.cap ?? 'butt';
    ctx.lineJoin = op.join ?? 'miter';
    if (op.dash) {
      ctx.setLineDash(op.dash);
      ctx.lineDashOffset = op.dashOffset ?? 0;
    } else {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }
    ctx.stroke(path);
    ctx.setLineDash([]);
  }
  if (op.dy) ctx.restore();
}

/**
 * The hatch fills, drawn as clipped parallel lines at 45 degrees.
 *
 * The SVG uses a 7x7 `<pattern>`; a canvas pattern is a bitmap, which the
 * camera would resample. Lines stroked live stay one world unit wide at every
 * zoom, which is what the pattern means.
 */
function paintHatch(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  fill: Extract<PaintFill, { kind: 'hatch' }>,
): void {
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = fill.color;
  ctx.lineWidth = HATCH_WIDTH;
  ctx.setLineDash([]);
  // Rotating about the box's own origin puts its far corner at most one
  // diagonal away in either axis, so that is how far the lines have to run.
  const reach =
    Math.ceil(Math.hypot(fill.w, fill.h) / HATCH_SPACING) * HATCH_SPACING;
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  for (let x = -reach; x <= reach; x += HATCH_SPACING) {
    ctx.moveTo(x, -reach);
    ctx.lineTo(x, reach);
  }
  if (fill.crosshatch)
    for (let y = -reach; y <= reach; y += HATCH_SPACING) {
      ctx.moveTo(-reach, y);
      ctx.lineTo(reach, y);
    }
  ctx.stroke();
  ctx.restore();
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  op: ImageOp,
  clip: Path2D | undefined,
  alpha: number,
  env: PaintContext,
): void {
  const source =
    env.image(op.src) ?? (op.fallback ? env.image(op.fallback, false) : null);
  if (!source) return;
  const width = sourceWidth(source);
  const height = sourceHeight(source);
  if (!width || !height) return;
  ctx.globalAlpha = alpha;
  if (clip) {
    ctx.save();
    ctx.clip(clip);
  }
  if (op.fit === 'none') {
    ctx.drawImage(source, op.x, op.y, op.w, op.h);
  } else {
    // `slice` covers the box and crops the overflow; `meet` fits inside it.
    const scale =
      op.fit === 'slice'
        ? Math.max(op.w / width, op.h / height)
        : Math.min(op.w / width, op.h / height);
    const w = width * scale;
    const h = height * scale;
    ctx.drawImage(source, op.x + (op.w - w) / 2, op.y + (op.h - h) / 2, w, h);
  }
  if (clip) ctx.restore();
}

function sourceWidth(source: CanvasImageSource): number {
  return typeof (source as HTMLImageElement).naturalWidth === 'number'
    ? (source as HTMLImageElement).naturalWidth
    : Number((source as { width?: number }).width ?? 0);
}

function sourceHeight(source: CanvasImageSource): number {
  return typeof (source as HTMLImageElement).naturalHeight === 'number'
    ? (source as HTMLImageElement).naturalHeight
    : Number((source as { height?: number }).height ?? 0);
}

function paintText(
  ctx: CanvasRenderingContext2D,
  op: TextOp,
  alpha: number,
): void {
  ctx.globalAlpha = alpha;
  ctx.font = op.font;
  ctx.textAlign = op.align;
  ctx.textBaseline = op.baseline;
  if (op.halo) {
    // `paint-order="stroke"`: the halo goes down first and the glyph over it.
    ctx.strokeStyle = op.halo.color;
    ctx.lineWidth = op.halo.width;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeText(op.text, op.x, op.y);
  }
  ctx.fillStyle = op.fill;
  ctx.fillText(op.text, op.x, op.y);
}

/**
 * The frame title, laid out for the current zoom.
 *
 * Every screen-constant term is divided by the zoom here rather than baked into
 * the op, which is what lets a frame keep its cached geometry across a pinch.
 */
function paintHeading(
  ctx: CanvasRenderingContext2D,
  op: HeadingOp,
  alpha: number,
  env: PaintContext,
): void {
  const zoom = Math.max(env.zoom, 0.001);
  const { frame } = op;
  const layout = frameHeadingLayout(frame, zoom);
  const text = frameHeadingText(frame.props.name, layout, zoom);
  if (!text) return;
  ctx.save();
  // The canonical heading sits above the top edge; the side transform turns it
  // onto whichever edge is uppermost once the frame has rotated.
  switch (layout.side) {
    case 1:
      ctx.translate(0, frame.props.h);
      ctx.rotate(-Math.PI / 2);
      break;
    case 2:
      ctx.translate(frame.props.w, frame.props.h);
      ctx.rotate(Math.PI);
      break;
    case 3:
      ctx.translate(frame.props.w, 0);
      ctx.rotate(Math.PI / 2);
      break;
  }
  paintText(
    ctx,
    {
      kind: 'text',
      text,
      x: layout.x + 6 / zoom,
      y: layout.y + layout.height / 2,
      font: `550 ${FRAME_HEADING_FONT_SCREEN / zoom}px ${LABEL_FONT}`,
      align: 'left',
      baseline: 'middle',
      fill: op.color,
      halo: { color: op.halo, width: 3 / zoom },
    },
    alpha,
  );
  ctx.restore();
}
