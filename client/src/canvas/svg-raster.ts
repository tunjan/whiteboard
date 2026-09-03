/**
 * Transcribing a live SVG subtree into a Canvas 2D context.
 *
 * This is not a second shape renderer. It reads the DOM that the shape utils
 * have *already* produced and replays it through Canvas 2D, so there is only
 * ever one implementation of where a stroke goes — the SVG one. That matters:
 * "two renderers disagreeing about where a stroke is" is a bug class this
 * codebase already engineers against, and re-deriving geometry from the shape
 * model would have reintroduced it across every shape type at once.
 *
 * The vocabulary handled here is exactly what the shape utils emit: paths, the
 * geometry primitives, `<text>`/`<tspan>`, `<image>`, nested `<svg>` (typeset
 * equations), clip paths, hatch patterns, and `feDropShadow`. Anything else is
 * skipped rather than approximated.
 *
 * Three deliberate approximations, all invisible for the frame or two a capture
 * is on screen:
 *   - Group `opacity` multiplies into the paint alpha instead of compositing
 *     the group off-screen first. Shapes carry it one shape at a time
 *     (`ShapeView`), so the two only differ where one shape self-overlaps.
 *   - Filters other than `feDropShadow` are dropped.
 *   - An `feDropShadow` on a container shadows each of its children rather than
 *     the group's silhouette, for the same reason: the correct form needs the
 *     group rasterized off-screen first, and every shadow the shape utils place
 *     is on a single painting element, where the two agree.
 */

const XLINK = 'http://www.w3.org/1999/xlink';

/** Elements that never paint anything themselves. */
const SKIP = new Set([
  'defs',
  'clipPath',
  'pattern',
  'filter',
  'mask',
  'marker',
  'symbol',
  'style',
  'title',
  'desc',
  'metadata',
  'linearGradient',
  'radialGradient',
]);

/** Paint state inherited down the element tree, in SVG's own terms. */
interface Paint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  fillRule: CanvasFillRule;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash: number[];
  dashOffset: number;
  /** `vector-effect: non-scaling-stroke` — width is in viewport, not user, units. */
  nonScalingStroke: boolean;
  /** What `currentColor` resolves to here. */
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textAnchor: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

const ROOT_PAINT: Paint = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
  fillRule: 'nonzero',
  lineCap: 'butt',
  lineJoin: 'miter',
  dash: [],
  dashOffset: 0,
  nonScalingStroke: false,
  color: '#000000',
  fontFamily: 'sans-serif',
  fontSize: 16,
  fontWeight: 'normal',
  textAnchor: 'start',
  baseline: 'alphabetic',
};

interface Env {
  ctx: CanvasRenderingContext2D;
  resolveVar: (input: string) => string;
  /** Path2D per element, keyed on the geometry string that built it. */
  paths: WeakMap<Element, { key: string; path: Path2D }>;
}

/** A viewport, for resolving percentage lengths and nested `<svg>` sizing. */
interface Viewport {
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Attribute reading
// ---------------------------------------------------------------------------

/**
 * An element's value for `name`, inline style winning over the presentation
 * attribute as the cascade requires. Deliberately never `getComputedStyle`:
 * the shape utils write presentation attributes, and a computed-style read per
 * element would cost more than the drawing does at the scale this runs at.
 */
function read(el: Element, name: string): string | null {
  // Almost nothing the shape utils render carries an inline style, so the
  // length check skips a property lookup on the overwhelming majority of the
  // elements a capture walks.
  const style = (el as SVGElement).style;
  if (style && style.length > 0) {
    const inline = style.getPropertyValue(name);
    if (inline) return inline.trim();
  }
  return el.getAttribute(name);
}

function readNum(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** A length that may be a percentage of `extent`. */
function readLength(
  el: Element,
  name: string,
  extent: number,
  fallback: number,
): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return fallback;
  return raw.trimEnd().endsWith('%') ? (v / 100) * extent : v;
}

function readPoints(el: Element): number[] {
  const raw = el.getAttribute('points');
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter((n) => Number.isFinite(n));
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

const TRANSFORM_RE =
  /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;

/**
 * Apply an SVG `transform` attribute to `ctx`, returning the factor its scale
 * contributes. Callers keep a running product so `non-scaling-stroke` and
 * drop-shadow offsets can be divided back out of user space.
 */
function applyTransform(ctx: CanvasRenderingContext2D, spec: string): number {
  let scale = 1;
  TRANSFORM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRANSFORM_RE.exec(spec))) {
    const args = m[2]!
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => Number.isFinite(n));
    switch (m[1]) {
      case 'matrix': {
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = args;
        ctx.transform(a, b, c, d, e, f);
        scale *= Math.sqrt(Math.abs(a * d - b * c)) || 1;
        break;
      }
      case 'translate':
        ctx.translate(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale': {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        ctx.scale(sx, sy);
        scale *= Math.sqrt(Math.abs(sx * sy)) || 1;
        break;
      }
      case 'rotate': {
        const [a = 0, cx, cy] = args;
        const rad = (a * Math.PI) / 180;
        if (cx !== undefined && cy !== undefined) {
          ctx.translate(cx, cy);
          ctx.rotate(rad);
          ctx.translate(-cx, -cy);
        } else {
          ctx.rotate(rad);
        }
        break;
      }
      case 'skewX':
        ctx.transform(
          1,
          0,
          Math.tan(((args[0] ?? 0) * Math.PI) / 180),
          1,
          0,
          0,
        );
        break;
      case 'skewY':
        ctx.transform(
          1,
          Math.tan(((args[0] ?? 0) * Math.PI) / 180),
          0,
          1,
          0,
          0,
        );
        break;
    }
  }
  return scale;
}

/** The uniform scale of the context's full transform, in device pixels. */
function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

function paintOf(el: Element, parent: Paint, env: Env): Paint {
  const p: Paint = { ...parent };

  const color = read(el, 'color');
  if (color) p.color = env.resolveVar(color);

  const resolvePaint = (value: string): string =>
    value === 'currentColor' ? p.color : env.resolveVar(value);

  const fill = read(el, 'fill');
  if (fill) p.fill = resolvePaint(fill);
  const stroke = read(el, 'stroke');
  if (stroke) p.stroke = resolvePaint(stroke);

  const sw = read(el, 'stroke-width');
  if (sw) p.strokeWidth = parseFloat(sw) || 0;
  const fo = read(el, 'fill-opacity');
  if (fo) p.fillOpacity = parseFloat(fo);
  const so = read(el, 'stroke-opacity');
  if (so) p.strokeOpacity = parseFloat(so);
  const o = read(el, 'opacity');
  if (o) p.opacity *= parseFloat(o);

  const rule = read(el, 'fill-rule');
  if (rule === 'evenodd' || rule === 'nonzero') p.fillRule = rule;

  const cap = read(el, 'stroke-linecap');
  if (cap === 'round' || cap === 'square' || cap === 'butt') p.lineCap = cap;
  const join = read(el, 'stroke-linejoin');
  if (join === 'round' || join === 'bevel' || join === 'miter') {
    p.lineJoin = join;
  }

  const dash = read(el, 'stroke-dasharray');
  if (dash) {
    p.dash =
      dash === 'none'
        ? []
        : dash
            .split(/[\s,]+/)
            .map(parseFloat)
            .filter((n) => Number.isFinite(n));
  }
  const offset = read(el, 'stroke-dashoffset');
  if (offset) p.dashOffset = parseFloat(offset) || 0;

  const effect = read(el, 'vector-effect');
  if (effect) p.nonScalingStroke = effect === 'non-scaling-stroke';

  const family = read(el, 'font-family');
  if (family) p.fontFamily = family;
  const size = read(el, 'font-size');
  if (size) p.fontSize = parseFloat(size) || p.fontSize;
  const weight = read(el, 'font-weight');
  if (weight) p.fontWeight = weight;

  const anchor = read(el, 'text-anchor');
  if (anchor === 'middle') p.textAnchor = 'center';
  else if (anchor === 'end') p.textAnchor = 'end';
  else if (anchor === 'start') p.textAnchor = 'start';

  const baseline = read(el, 'dominant-baseline');
  if (baseline === 'central' || baseline === 'middle') p.baseline = 'middle';
  else if (baseline === 'hanging' || baseline === 'text-before-edge') {
    p.baseline = 'hanging';
  } else if (baseline === 'alphabetic') p.baseline = 'alphabetic';

  return p;
}

/** Fill then stroke `path`, exactly as SVG paints a shape. */
function paintPath(
  env: Env,
  path: Path2D,
  p: Paint,
  scale: number,
  fillStyle?: string | CanvasPattern,
): void {
  const { ctx } = env;
  const fill = fillStyle ?? p.fill;
  const hasFill = fill !== 'none' && p.fillOpacity > 0 && p.opacity > 0;
  if (hasFill) {
    ctx.globalAlpha = p.opacity * p.fillOpacity;
    ctx.fillStyle = fill;
    ctx.fill(path, p.fillRule);
  }
  if (
    p.stroke !== 'none' &&
    p.strokeWidth > 0 &&
    p.strokeOpacity > 0 &&
    p.opacity > 0
  ) {
    if (hasFill && ctx.shadowColor && ctx.shadowColor !== 'rgba(0, 0, 0, 0)') {
      ctx.shadowColor = 'transparent';
    }
    ctx.globalAlpha = p.opacity * p.strokeOpacity;
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = p.nonScalingStroke ? p.strokeWidth / scale : p.strokeWidth;
    ctx.lineCap = p.lineCap;
    ctx.lineJoin = p.lineJoin;
    ctx.setLineDash(p.dash);
    ctx.lineDashOffset = p.dashOffset;
    ctx.stroke(path);
    if (p.dash.length) ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The element's Path2D, rebuilt only when the geometry string it came from changes. */
function cachedPath(
  env: Env,
  el: Element,
  key: string,
  build: () => Path2D,
): Path2D {
  const hit = env.paths.get(el);
  if (hit && hit.key === key) return hit.path;
  const path = build();
  env.paths.set(el, { key, path });
  return path;
}

function roundRectPath(
  path: Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const cx = Math.min(rx, w / 2);
  const cy = Math.min(ry, h / 2);
  path.moveTo(x + cx, y);
  path.lineTo(x + w - cx, y);
  path.ellipse(x + w - cx, y + cy, cx, cy, 0, -Math.PI / 2, 0);
  path.lineTo(x + w, y + h - cy);
  path.ellipse(x + w - cx, y + h - cy, cx, cy, 0, 0, Math.PI / 2);
  path.lineTo(x + cx, y + h);
  path.ellipse(x + cx, y + h - cy, cx, cy, 0, Math.PI / 2, Math.PI);
  path.lineTo(x, y + cy);
  path.ellipse(x + cx, y + cy, cx, cy, 0, Math.PI, (3 * Math.PI) / 2);
  path.closePath();
}

/** The Path2D for any geometry element, or null if it isn't one. */
function geometryPath(env: Env, el: Element, vp: Viewport): Path2D | null {
  switch (el.tagName) {
    case 'path': {
      const d = el.getAttribute('d');
      if (!d) return null;
      return cachedPath(env, el, d, () => new Path2D(d));
    }
    case 'rect': {
      const x = readLength(el, 'x', vp.w, 0);
      const y = readLength(el, 'y', vp.h, 0);
      const w = readLength(el, 'width', vp.w, 0);
      const h = readLength(el, 'height', vp.h, 0);
      if (w <= 0 || h <= 0) return null;
      const rx = readNum(el, 'rx', readNum(el, 'ry', 0));
      const ry = readNum(el, 'ry', rx);
      return cachedPath(env, el, `${x},${y},${w},${h},${rx},${ry}`, () => {
        const path = new Path2D();
        if (rx > 0 || ry > 0) roundRectPath(path, x, y, w, h, rx, ry);
        else path.rect(x, y, w, h);
        return path;
      });
    }
    case 'circle': {
      const cx = readNum(el, 'cx', 0);
      const cy = readNum(el, 'cy', 0);
      const r = readNum(el, 'r', 0);
      if (r <= 0) return null;
      return cachedPath(env, el, `${cx},${cy},${r}`, () => {
        const path = new Path2D();
        path.arc(cx, cy, r, 0, Math.PI * 2);
        return path;
      });
    }
    case 'ellipse': {
      const cx = readNum(el, 'cx', 0);
      const cy = readNum(el, 'cy', 0);
      const rx = readNum(el, 'rx', 0);
      const ry = readNum(el, 'ry', 0);
      if (rx <= 0 || ry <= 0) return null;
      return cachedPath(env, el, `${cx},${cy},${rx},${ry}`, () => {
        const path = new Path2D();
        path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        return path;
      });
    }
    case 'line': {
      const x1 = readNum(el, 'x1', 0);
      const y1 = readNum(el, 'y1', 0);
      const x2 = readNum(el, 'x2', 0);
      const y2 = readNum(el, 'y2', 0);
      return cachedPath(env, el, `${x1},${y1},${x2},${y2}`, () => {
        const path = new Path2D();
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
        return path;
      });
    }
    case 'polygon':
    case 'polyline': {
      const pts = readPoints(el);
      if (pts.length < 4) return null;
      const closed = el.tagName === 'polygon';
      return cachedPath(env, el, `${closed}:${pts.join(',')}`, () => {
        const path = new Path2D();
        path.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i + 1 < pts.length; i += 2) {
          path.lineTo(pts[i]!, pts[i + 1]!);
        }
        if (closed) path.closePath();
        return path;
      });
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// References: clip paths, hatch patterns, drop shadows
// ---------------------------------------------------------------------------

/** The element a `url(#id)` reference points at, if it is in the document. */
function referenced(value: string | null): Element | null {
  if (!value) return null;
  const m = /^url\(["']?#([^"')]+)["']?\)/.exec(value.trim());
  return m ? document.getElementById(m[1]!) : null;
}

function applyClip(env: Env, el: Element, vp: Viewport): void {
  const clip = referenced(read(el, 'clip-path'));
  if (!clip) return;
  const path = new Path2D();
  for (const child of clip.children) {
    const child2d = geometryPath(env, child, vp);
    if (child2d) path.addPath(child2d);
  }
  env.ctx.clip(path);
}

/**
 * Set up `ctx.shadow*` from an `feDropShadow`, the only filter the shape utils
 * use. Shadow offsets ignore the transform matrix, so they are converted to
 * device pixels here rather than left in user space.
 */
function applyFilter(env: Env, el: Element): void {
  const filter = referenced(read(el, 'filter'));
  const drop = filter?.querySelector('feDropShadow');
  if (!drop) return;
  const scale = deviceScale(env.ctx);
  const flood = env.resolveVar(
    drop.getAttribute('flood-color') ??
      drop.getAttribute('floodColor') ??
      '#000000',
  );
  const opacityAttr =
    drop.getAttribute('flood-opacity') ??
    drop.getAttribute('floodOpacity') ??
    '1';
  const opacity = parseFloat(opacityAttr);
  env.ctx.shadowColor = withAlpha(
    flood,
    Number.isFinite(opacity) ? opacity : 1,
  );
  env.ctx.shadowBlur = readNum(drop, 'stdDeviation', 0) * 2 * scale;
  env.ctx.shadowOffsetX = readNum(drop, 'dx', 0) * scale;
  env.ctx.shadowOffsetY = readNum(drop, 'dy', 0) * scale;
}

/** `color` at `alpha`, for shadows — Canvas has no separate shadow opacity. */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === 'black') return `rgba(0, 0, 0, ${alpha})`;
  if (trimmed === 'white') return `rgba(255, 255, 255, ${alpha})`;
  const hex6 = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex6) {
    const n = parseInt(hex6[1]!, 16);
    // eslint-disable-next-line no-bitwise
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (hex3) {
    const r = parseInt(hex3[1]![0]! + hex3[1]![0]!, 16);
    const g = parseInt(hex3[1]![1]! + hex3[1]![1]!, 16);
    const b = parseInt(hex3[1]![2]! + hex3[1]![2]!, 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb =
    /^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
      trimmed,
    );
  if (rgb) {
    const r = parseInt(rgb[1]!, 10);
    const g = parseInt(rgb[2]!, 10);
    const b = parseInt(rgb[3]!, 10);
    const origA = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    return `rgba(${r}, ${g}, ${b}, ${origA * alpha})`;
  }
  return color;
}

/**
 * Painted tiles for `<pattern>` fills, held across captures.
 *
 * Building one means allocating a canvas and replaying the pattern's children
 * into it, and every hatched shape carries a `<pattern>` of its own — so on a
 * page of hatched shapes rebuilding them per capture is the dominant cost of
 * the operation that exists to make panning cheap. Same treatment as
 * `cachedPath`: keyed on the element, rebuilt only when what went into the tile
 * changes. The key carries the markup *after* var resolution, so a theme swap
 * repaints the tile rather than reusing yesterday's colors.
 */
const patternTiles = new WeakMap<
  Element,
  { key: string; tile: HTMLCanvasElement; matrix: DOMMatrix }
>();

/**
 * A `<pattern>` fill (the hatch and crosshatch styles) as a CanvasPattern.
 *
 * The tile is drawn into an offscreen canvas at the capture's device scale, so
 * its hairlines survive supersampling, then scaled back down by the pattern
 * transform. Canvas patterns live in the current user space, which is exactly
 * what `patternUnits="userSpaceOnUse"` means.
 */
function patternFill(
  env: Env,
  ref: string,
  vp: Viewport,
): CanvasPattern | null {
  const pattern = referenced(ref);
  if (!pattern) return null;
  const w = readNum(pattern, 'width', 0);
  const h = readNum(pattern, 'height', 0);
  if (w <= 0 || h <= 0) return null;
  const res = Math.max(1, Math.min(8, deviceScale(env.ctx)));
  const key = `${res}|${vp.w}x${vp.h}|${env.resolveVar(pattern.outerHTML)}`;

  let entry = patternTiles.get(pattern);
  if (!entry || entry.key !== key) {
    const tile = document.createElement('canvas');
    tile.width = Math.ceil(w * res);
    tile.height = Math.ceil(h * res);
    const tileCtx = tile.getContext('2d');
    if (!tileCtx) return null;
    tileCtx.scale(res, res);
    const tileEnv: Env = { ...env, ctx: tileCtx };
    for (const child of pattern.children) {
      paintNode(tileEnv, child, ROOT_PAINT, 1, vp);
    }
    const matrix = new DOMMatrix();
    const spec = pattern.getAttribute('patternTransform');
    if (spec) {
      // Reuse the attribute parser by replaying it onto a scratch context.
      const scratch = document.createElement('canvas').getContext('2d');
      if (scratch) {
        applyTransform(scratch, spec);
        const t = scratch.getTransform();
        matrix.a = t.a;
        matrix.b = t.b;
        matrix.c = t.c;
        matrix.d = t.d;
        matrix.e = t.e;
        matrix.f = t.f;
      }
    }
    entry = { key, tile, matrix };
    patternTiles.set(pattern, entry);
  }

  // The CanvasPattern itself is bound to the context that made it, and holding
  // one costs a paint of the tile it already has — cheap next to building it.
  const canvasPattern = env.ctx.createPattern(entry.tile, 'repeat');
  if (!canvasPattern) return null;
  // `scale` returns a new matrix, so the cached one keeps the pattern's own
  // transform for the next capture.
  canvasPattern.setTransform(entry.matrix.scale(1 / res, 1 / res));
  return canvasPattern;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

// Decoded bitmaps for `<image href>`, keyed on the URL. An image missing from
// the cache starts loading and is skipped for this capture: the board's own
// <image> element already has the pixels, but Canvas 2D needs an
// HTMLImageElement of its own to draw from. In practice only the first capture
// after a blob first appears can miss, and the live SVG is one frame behind.
const imageCache = new Map<string, HTMLImageElement>();
const IMAGE_CACHE_LIMIT = 256;

function cachedImage(url: string): HTMLImageElement | null {
  const hit = imageCache.get(url);
  if (hit) {
    // Re-inserting on a hit makes eviction least-recently-used: a Map iterates
    // in insertion order, so without this the entry dropped below is simply the
    // oldest one, which past the limit can be an image that is on screen right
    // now. Evicting that restarts its load and leaves a hole in the capture.
    imageCache.delete(url);
    imageCache.set(url, hit);
    return hit.complete && hit.naturalWidth > 0 ? hit : null;
  }
  if (imageCache.size >= IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  const img = new Image();
  imageCache.set(url, img);
  img.src = url;
  return null;
}

function paintImage(env: Env, el: Element, p: Paint, vp: Viewport): void {
  const href =
    el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href') ?? null;
  if (!href) return;
  const img = cachedImage(href);
  if (!img) return;
  const x = readLength(el, 'x', vp.w, 0);
  const y = readLength(el, 'y', vp.h, 0);
  const w = readLength(el, 'width', vp.w, 0);
  const h = readLength(el, 'height', vp.h, 0);
  if (w <= 0 || h <= 0) return;

  const { ctx } = env;
  ctx.globalAlpha = p.opacity;
  const par = (
    el.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet'
  ).trim();
  if (par.startsWith('none')) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const slice = par.endsWith('slice');
    const s = slice ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
    const dw = sw * s;
    const dh = sh * s;
    const fx = par.includes('xMin') ? 0 : par.includes('xMax') ? 1 : 0.5;
    const fy = par.includes('YMin') ? 0 : par.includes('YMax') ? 1 : 0.5;
    if (slice) {
      ctx.save();
      const clip = new Path2D();
      clip.rect(x, y, w, h);
      ctx.clip(clip);
    }
    ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
    if (slice) ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function paintText(env: Env, el: Element, p: Paint, vp: Viewport): void {
  const { ctx } = env;
  ctx.font = `${p.fontWeight} ${p.fontSize}px ${p.fontFamily}`;
  ctx.textAlign = p.textAnchor;
  ctx.textBaseline = p.baseline;
  ctx.globalAlpha = p.opacity * p.fillOpacity;
  ctx.fillStyle = p.fill;

  const x = readLength(el, 'x', vp.w, 0);
  const y = readLength(el, 'y', vp.h, 0);
  // `:scope >`, not a descendant sweep: a nested tspan would otherwise be
  // painted once for itself and once inside its parent's text content.
  const spans = el.querySelectorAll(':scope > tspan');
  if (spans.length === 0) {
    if (p.fill !== 'none') ctx.fillText(el.textContent ?? '', x, y);
  } else {
    for (const span of spans) {
      const sp = paintOf(span, p, env);
      ctx.font = `${sp.fontWeight} ${sp.fontSize}px ${sp.fontFamily}`;
      ctx.textAlign = sp.textAnchor;
      ctx.textBaseline = sp.baseline;
      ctx.globalAlpha = sp.opacity * sp.fillOpacity;
      if (sp.fill === 'none') continue;
      ctx.fillStyle = sp.fill;
      ctx.fillText(
        span.textContent ?? '',
        readLength(span, 'x', vp.w, x),
        readLength(span, 'y', vp.h, y),
      );
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function paintNode(
  env: Env,
  el: Element,
  parent: Paint,
  scale: number,
  vp: Viewport,
): void {
  const tag = el.tagName;
  if (SKIP.has(tag)) return;
  if (read(el, 'display') === 'none' || read(el, 'visibility') === 'hidden') {
    return;
  }

  const { ctx } = env;
  ctx.save();

  let childScale = scale;
  const transform = el.getAttribute('transform');
  if (transform) childScale *= applyTransform(ctx, transform);

  let childVp = vp;
  if (tag === 'svg') {
    const nested = enterNestedSvg(env, el, vp);
    childVp = { w: nested.w, h: nested.h };
    childScale *= nested.scale;
  }

  // `childVp` rather than `vp`: for a nested <svg>, `enterNestedSvg` has already
  // put the context in the inner coordinate system, so its own clip-path has to
  // resolve percentage lengths there too. For everything else the two are the
  // same viewport.
  applyClip(env, el, childVp);
  applyFilter(env, el);

  const p = paintOf(el, parent, env);

  if (tag === 'text') {
    paintText(env, el, p, childVp);
  } else if (tag === 'image') {
    paintImage(env, el, p, childVp);
  } else {
    const path = geometryPath(env, el, childVp);
    if (path) {
      const pattern = p.fill.startsWith('url(')
        ? patternFill(env, p.fill, childVp)
        : undefined;
      paintPath(env, path, p, childScale, pattern ?? undefined);
    } else {
      for (const child of el.children) {
        paintNode(env, child, p, childScale, childVp);
      }
    }
  }

  ctx.restore();
}

/** Apply a nested `<svg>`'s viewport and viewBox, returning the inner viewport. */
function enterNestedSvg(
  env: Env,
  el: Element,
  vp: Viewport,
): Viewport & { scale: number } {
  const { ctx } = env;
  const x = readLength(el, 'x', vp.w, 0);
  const y = readLength(el, 'y', vp.h, 0);
  const w = readLength(el, 'width', vp.w, vp.w);
  const h = readLength(el, 'height', vp.h, vp.h);
  if (x || y) ctx.translate(x, y);

  const viewBox = el.getAttribute('viewBox');
  if (!viewBox) return { w, h, scale: 1 };
  const [vx = 0, vy = 0, vw = w, vh = h] = viewBox
    .split(/[\s,]+/)
    .map(parseFloat);
  if (!(vw > 0 && vh > 0)) return { w, h, scale: 1 };
  // Every nested <svg> the shape utils produce is a typeset equation, whose
  // aspect ratio always matches its box; uniform `meet` scaling is exact here.
  const s = Math.min(w / vw, h / vh);
  ctx.translate((w - vw * s) / 2, (h - vh * s) / 2);
  ctx.scale(s, s);
  ctx.translate(-vx, -vy);
  return { w: vw, h: vh, scale: s };
}

export interface PaintSvgOptions {
  resolveVar: (input: string) => string;
  /** CSS-pixel box `root` occupies, for resolving percentage lengths. */
  viewport: Viewport;
  paths: WeakMap<Element, { key: string; path: Path2D }>;
  /**
   * User-space scale already baked into `ctx` above `root`, relative to the
   * SVG viewport. Only `vector-effect: non-scaling-stroke` reads it, and it is
   * wrong to leave at 1 whenever the caller has folded a transform that `root`
   * would otherwise have carried into the context itself.
   */
  scale?: number;
}

/**
 * Draw the live SVG subtree `root` into `ctx`, under whatever transform the
 * caller has already set. `root`'s own `transform` is *not* applied — only its
 * children are painted — so a caller that supplies the transform itself isn't
 * fighting whatever the element currently holds.
 */
export function paintSvgInto(
  ctx: CanvasRenderingContext2D,
  root: SVGElement,
  { resolveVar, viewport, paths, scale = 1 }: PaintSvgOptions,
): void {
  const env: Env = { ctx, resolveVar, paths };
  for (const child of root.children) {
    paintNode(env, child, ROOT_PAINT, scale, viewport);
  }
}

/** A Path2D cache to hand to {@link paintSvgInto}, held across captures. */
export function createPathCache(): WeakMap<
  Element,
  { key: string; path: Path2D }
> {
  return new WeakMap();
}
