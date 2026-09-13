import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Bounds, type Shape, unionBounds } from '@whiteboard/shared';
import { descendantsOf } from './hierarchy';
import { getEquationRender, typesetEquation } from './equation-render';
import { ensureGraphMath } from './graph-math';
import { resolveCssVars } from './css-vars';
import { shapeRotatedBounds } from './shape-bounds';
import {
  DEFAULT_PNG_EXPORT_SCALE,
  PNG_EXPORT_SCALES,
  useCanvasUiStore,
} from './use-canvas-ui-store';
import { compareIndex, editor } from './use-document-store';
import { inkShape } from './ink-color';
import { shapeRegistry } from './shapes/shape-registry';
import { FrameView } from './shapes/frame';
import { framePolygon } from './frame-geometry';
import { resolveOpacity } from './opacity';
import { withPhysChunk } from './png-phys';
import { writePngToClipboard } from '@/board/clipboard-os';

// World-space padding added around the content bounds in the exported image.
const PADDING = 32;
// Cap either output dimension so a sprawling board can't allocate a huge canvas.
const MAX_DIM = 8192;

/** A scene ready to rasterize: what to draw, how big, and what got dropped. */
interface Scene {
  tree: ReactNode;
  bounds: Bounds;
  /** World padding around bounds (zero for a frame export boundary). */
  padding: number;
  /** Non-empty equations excluded because they don't typeset. */
  invalidEquations: number;
}

/**
 * The whole current page as a rasterizable scene.
 *
 * The board is SVG-native, so we re-render every shape (the live canvas is
 * viewport-culled) into a standalone SVG sized to the content bounds, inline
 * everything the page environment would otherwise supply — CSS variables, web
 * fonts, and `/api/blobs` images — then rasterize it to PNG.
 */
async function boardScene(): Promise<Scene | null> {
  const shapes = editor.getShapes();
  await prewarmShapeEngines(shapes);
  const byId = new Map(shapes.map((shape) => [shape.id, shape]));
  let bounds: Bounds | null = null;
  for (const shape of shapes) {
    if (shape.type === 'group' || !isExportable(shape)) continue;
    const visible = maskedExportBounds(shape, byId);
    if (visible) bounds = bounds ? unionBounds(bounds, visible) : visible;
  }
  if (!bounds) return null; // empty board: nothing to export
  return {
    tree: renderTree(),
    bounds,
    padding: PADDING,
    invalidEquations: countInvalidEquations(shapes),
  };
}

function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const intersection = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return intersection.minX <= intersection.maxX &&
    intersection.minY <= intersection.maxY
    ? intersection
    : null;
}

/** Conservative page bounds after every ancestor frame mask is applied. */
function maskedExportBounds(
  shape: Shape,
  byId: ReadonlyMap<string, Shape>,
): Bounds | null {
  let bounds = shapeRotatedBounds(shape);
  if (shape.type === 'arrow') return bounds;
  let parent = shape.parentId ? byId.get(shape.parentId) : undefined;
  const seen = new Set<string>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    if (parent.type === 'frame') {
      const clipped = intersectBounds(bounds, shapeRotatedBounds(parent));
      if (!clipped) return null;
      bounds = clipped;
    }
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return bounds;
}

/**
 * Just the selected shapes (and their descendants) as a rasterizable scene,
 * sized to their combined bounds — the tldraw-style "export selection" action.
 */
async function selectionScene(ids: string[]): Promise<Scene | null> {
  if (!ids.length) return null;
  const shapes = editor.getShapes();
  const singleFrame =
    ids.length === 1 && editor.getShape(ids[0]!)?.type === 'frame'
      ? (editor.getShape(ids[0]!) as Extract<Shape, { type: 'frame' }>)
      : null;
  const renderSet = new Set<string>();
  for (const id of ids) {
    renderSet.add(id);
    for (const d of descendantsOf(shapes, id)) renderSet.add(d.id);
  }
  // Typeset first: `isExportable` reads the cache to drop equations that would
  // only contribute a placeholder box to the bounds.
  await prewarmShapeEngines(shapes, renderSet);
  // Bounds = union of the rotated world bounds of every rendered shape with its
  // own geometry (groups carry none, so they're skipped).
  let bounds: Bounds | null = singleFrame
    ? shapeRotatedBounds(singleFrame)
    : null;
  if (!singleFrame) {
    for (const s of shapes) {
      if (!renderSet.has(s.id) || s.type === 'group' || !isExportable(s)) {
        continue;
      }
      const b = shapeRotatedBounds(s);
      bounds = bounds ? unionBounds(bounds, b) : b;
    }
  }
  if (!bounds) return null;
  return {
    tree: renderTree(renderSet, singleFrame?.id),
    bounds,
    padding: singleFrame ? 0 : PADDING,
    invalidEquations: countInvalidEquations(shapes, renderSet),
  };
}

/** Export the whole current page as a PNG and trigger a download. */
export async function exportBoardToPng(title: string): Promise<void> {
  const scene = await boardScene();
  if (!scene) return;
  if (!confirmInvalidEquationExport(scene.invalidEquations)) return;
  download(await renderPngBlob(scene), `${safeFilename(title)}.png`);
}

/** Export just the selected shapes as a PNG and trigger a download. */
export async function exportSelectionToPng(
  ids: string[],
  title: string,
): Promise<void> {
  const scene = await selectionScene(ids);
  if (!scene) return;
  if (!confirmInvalidEquationExport(scene.invalidEquations)) return;
  download(await renderPngBlob(scene), `${safeFilename(title)}.png`);
}

/**
 * Longest side, in pixels, of the raster handed to a vision model.
 *
 * Not the user's export resolution: handwriting is often only a couple of
 * hundred world units across, and rasterized at the board's own scale the
 * strokes arrive too small to read. Sized up to a resolution where a model can
 * tell a subscript from an exponent, and no further — the image travels as
 * base64 in a request body.
 */
const RECOGNITION_TARGET_PX = 1024;

/**
 * Hard ceiling on that longest side.
 *
 * Sizing up stops at the target, but a shape already larger than it was
 * previously rasterized at the board's own scale — fine for ink, which is line
 * art whatever its size, and a payload problem for a pasted photograph, whose
 * PNG grows with every pixel and has `MAX_INK_IMAGE_CHARS` waiting for it at
 * the server. Nothing is lost by capping here: a vision model resamples past
 * roughly this resolution anyway.
 */
const RECOGNITION_MAX_PX = 1600;

/**
 * Rasterize `ids` as an image for recognition — handwriting or a pasted
 * picture — or null when they render to nothing. Shares the export pipeline so
 * what the model reads is exactly what the board draws.
 */
export async function renderShapesForRecognition(
  ids: string[],
): Promise<Blob | null> {
  const scene = await selectionScene(ids);
  if (!scene) return null;
  const w = scene.bounds.maxX - scene.bounds.minX + scene.padding * 2;
  const h = scene.bounds.maxY - scene.bounds.minY + scene.padding * 2;
  const longest = Math.max(w, h, 1);
  // Never below 1 for sizing up: downscaling ink that is already large loses
  // the fine strokes that separate a prime from a comma. The ceiling still
  // wins, so the output lands in [longest, 4x longest] and never past the cap.
  const scale = Math.min(
    4,
    Math.max(1, RECOGNITION_TARGET_PX / longest),
    RECOGNITION_MAX_PX / longest,
  );
  return renderPngBlob(scene, scale);
}

/**
 * Copy the whole current page to the system clipboard as a PNG.
 *
 * The blob promise is started but deliberately not awaited here: Safari only
 * honours `navigator.clipboard.write` while the user gesture that triggered it
 * is still the current task, so the write has to be handed an unresolved
 * promise rather than a finished blob. See `writePngToClipboard`.
 */
export function copyBoardToPngClipboard(): Promise<void> {
  return writePngToClipboard(renderSceneForClipboard(boardScene()));
}

/** Copy just the selected shapes to the system clipboard as a PNG. */
export function copySelectionToPngClipboard(ids: string[]): Promise<void> {
  return writePngToClipboard(renderSceneForClipboard(selectionScene(ids)));
}

/**
 * Rasterize a pending scene for the clipboard.
 *
 * Unlike the download path this never prompts about equations that failed to
 * typeset: the confirm would have to run inside the pending clipboard promise,
 * where a modal blocks long enough for Safari to abandon the write. Those
 * equations are dropped from the image exactly as they are once the download
 * prompt is accepted.
 */
async function renderSceneForClipboard(
  pending: Promise<Scene | null>,
): Promise<Blob> {
  const scene = await pending;
  if (!scene) throw new Error('Nothing to copy');
  return renderPngBlob(scene);
}

/**
 * An equation with no source, or one whose source doesn't typeset, draws an
 * editing placeholder on the canvas (dashed box, warning glyph). That is
 * scaffolding for the author, so it stays out of the exported image. Call only
 * after `prewarmShapeEngines`, which fills the cache this reads.
 */
export function isExportable(shape: Shape): boolean {
  if (shape.type !== 'equation') return true;
  const latex = shape.props.latex.trim();
  if (!latex) return false;
  const render = getEquationRender(latex, shape.props.inline);
  return Boolean(render) && !render?.error;
}

/** Count non-empty equations that would otherwise disappear from an export. */
export function countInvalidEquations(
  shapes: Shape[],
  renderSet?: Set<string>,
): number {
  let count = 0;
  for (const shape of shapes) {
    if (
      shape.type !== 'equation' ||
      (renderSet && !renderSet.has(shape.id)) ||
      !shape.props.latex.trim()
    ) {
      continue;
    }
    const render = getEquationRender(
      shape.props.latex.trim(),
      shape.props.inline,
    );
    if (render?.error) count++;
  }
  return count;
}

function confirmInvalidEquationExport(count: number): boolean {
  if (!count) return true;
  const noun = count === 1 ? 'equation contains' : 'equations contain';
  return window.confirm(
    `${count} ${noun} errors and will not be included. Export the rest?`,
  );
}

/**
 * Load what the shape renderers read synchronously, before the SVG tree is
 * server-rendered: typeset equations, and the graph parser if a graph is in
 * the export. Both are fetched on demand on the canvas, and a render body
 * cannot wait for either — here it can, so the export never draws the
 * intermediate state.
 */
async function prewarmShapeEngines(
  shapes: Shape[],
  renderSet?: Set<string>,
): Promise<void> {
  // Keyed by style as well as source: two equations sharing an expression but
  // typeset differently are two renders, and the cache `isExportable` reads
  // holds them separately.
  const wanted = new Map<string, { latex: string; inline: boolean }>();
  for (const shape of shapes) {
    if (shape.type !== 'equation' || (renderSet && !renderSet.has(shape.id))) {
      continue;
    }
    const latex = shape.props.latex.trim();
    const inline = shape.props.inline ?? false;
    if (latex) wanted.set(`${inline ? 'i' : 'b'}${latex}`, { latex, inline });
  }
  const graphed = shapes.some(
    (shape) =>
      shape.type === 'graph' && (!renderSet || renderSet.has(shape.id)),
  );
  await Promise.all([
    ...[...wanted.values()].map(({ latex, inline }) =>
      typesetEquation(latex, inline).catch(() => undefined),
    ),
    graphed ? ensureGraphMath().catch(() => undefined) : undefined,
  ]);
}

/**
 * The persisted export resolution, sanitized. `localStorage` is user-writable
 * and a non-finite value here would propagate into the canvas dimensions and
 * produce a blank or failed export rather than an obviously wrong one.
 */
function exportScale(): number {
  const scale = useCanvasUiStore.getState().pngExportScale;
  if (!Number.isFinite(scale) || scale <= 0) return DEFAULT_PNG_EXPORT_SCALE;
  return Math.min(scale, Math.max(...PNG_EXPORT_SCALES));
}

/** Output pixel size for a `w`x`h` world-unit scene at the requested scale. */
export function rasterSize(
  w: number,
  h: number,
  requested: number,
): { scale: number; outW: number; outH: number } {
  // The floor comes first and the cap last, so `MAX_DIM` is the bound that
  // always holds. The other order silently broke a sprawling board: a scene
  // wider than `MAX_DIM / 0.1` world units had its scale capped below the
  // floor, the floor raised it back above the cap, and the canvas came out
  // past 8192 on a side. Over roughly 268 megapixels Chrome hands back a
  // canvas that rasterizes fully transparent without throwing, so the export
  // — and the clipboard copy sharing this path — produced a blank image with
  // no error anywhere to say why.
  const scale = Math.min(Math.max(requested, 0.1), MAX_DIM / w, MAX_DIM / h);
  return {
    scale,
    // A scene thinner than one output pixel still has to be a real canvas.
    outW: Math.max(1, Math.ceil(w * scale)),
    outH: Math.max(1, Math.ceil(h * scale)),
  };
}

/**
 * Rasterize a scene to a PNG blob at the largest scale the caps allow.
 *
 * `requestedScale` overrides the user's export resolution for renders that are
 * not exports — see `renderShapesForRecognition`, which sizes for a model's
 * eyes rather than for a file the user asked to save.
 */
async function renderPngBlob(
  { tree, bounds, padding }: Scene,
  requestedScale?: number,
): Promise<Blob> {
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const w = bounds.maxX - bounds.minX + padding * 2;
  const h = bounds.maxY - bounds.minY + padding * 2;

  // The user's chosen resolution (Settings → General → PNG Resolution). This
  // used to be `min(devicePixelRatio, 2)`, which made the same board export at
  // a different size depending on the monitor it happened to be opened on.
  const { outW, outH, scale } = rasterSize(w, h, requestedScale ?? exportScale());

  const shapeMarkup = resolveCssVars(renderToStaticMarkup(tree));
  const inlined = await inlineBlobImages(shapeMarkup);
  const bg = resolveCssVars('var(--color-background)') || '#ffffff';
  const fontFace =
    (await webFontFace(/inter/i, 'Inter Variable')) +
    (shapeMarkup.includes('Caveat')
      ? await webFontFace(/caveat/i, 'Caveat Variable')
      : '');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" ` +
    `viewBox="${minX} ${minY} ${w} ${h}">` +
    `<style>${fontFace}</style>` +
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="${bg}"/>` +
    `${inlined}</svg>`;

  const raster = await rasterize(svg, outW, outH);
  // The raster is `scale`x the board's own units, so declare that as a physical
  // resolution — otherwise every consumer reads the pixel grid as the logical
  // size and shows the image at `scale` times the size it had on the board.
  return withPhysChunk(await raster.arrayBuffer(), scale);
}

/**
 * The shape tree for the current page, mirroring `Canvas`'s render rules:
 * frames clip and recurse over their direct children; every other shape (incl.
 * group members) renders flat. No viewport culling and no eraser dimming.
 *
 * Pass `renderSet` to restrict output to those shapes (used by the selection
 * export); omit it to render the whole page.
 */
export function renderTree(renderSet?: Set<string>, rootFrameId?: string): ReactNode {
  const shapes = editor.getShapes();
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const inSet = (id: string) => {
    if (renderSet && !renderSet.has(id)) return false;
    const shape = byId.get(id);
    return !shape || isExportable(shape);
  };

  // A shape is rendered by its frame (not at top level) only when that frame is
  // itself part of the output — otherwise a shape inside an unselected frame
  // would never render during a selection export.
  const hasRenderedFrameAncestor = (s: Shape): boolean => {
    if (s.type === 'arrow') return false;
    let cur = s.parentId ? byId.get(s.parentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'frame' && inSet(cur.id)) return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  const childrenOf = (parentId: string) =>
    shapes
      .filter((s) => s.parentId === parentId && inSet(s.id))
      .sort(compareIndex);

  const render = (shape: Shape, insideFrame = false): ReactNode => {
    if (shape.type === 'group') {
      return insideFrame ? (
        <g key={shape.id}>
          {childrenOf(shape.id)
            .filter((child) => child.type !== 'arrow')
            .map((child) => render(child, true))}
        </g>
      ) : null;
    }
    if (shape.type === 'frame') {
      return (
        <FrameView
          key={shape.id}
          frame={shape}
          showBorder={shape.id !== rootFrameId}
          showTitle={shape.id !== rootFrameId}
        >
          {childrenOf(shape.id)
            .filter((child) => child.type !== 'arrow')
            .map((child) => render(child, true))}
        </FrameView>
      );
    }
    const Component = shapeRegistry.getFor(shape)?.Component;
    return Component ? (
      <g key={shape.id} opacity={shape.type === 'draw' && shape.props.inkKind === 'highlight' ? resolveOpacity(shape, (id) => byId.get(id), () => false) : undefined}>
        <Component shape={inkShape(shape)} inkPass="underlay" />
      </g>
    ) : null;
  };

  const topLevel = [...shapes]
    .sort(compareIndex)
    .filter((s) => inSet(s.id) && !hasRenderedFrameAncestor(s));
  const overlays = shapes.filter((shape) => inSet(shape.id) && shape.type === 'draw' && shape.props.inkKind === 'highlight').sort(compareIndex).map((shape) => {
    const Component = shapeRegistry.getFor(shape)?.Component;
    if (!Component) return null;
    let content: ReactNode = <Component shape={inkShape(shape)} inkPass="overlay" />;
    const seen = new Set<string>([shape.id]);
    let parent = shape.parentId ? byId.get(shape.parentId) : undefined;
    let hidden = shape.hidden;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      hidden ||= parent.hidden;
      if (parent.type === 'frame' && inSet(parent.id)) {
        const clipId = `highlight-${shape.id}-${parent.id}`;
        content = <g clipPath={`url(#${clipId})`}>
          <defs><clipPath id={clipId}><polygon points={framePolygon(parent).map((p) => `${p.x},${p.y}`).join(' ')} /></clipPath></defs>
          {content}
        </g>;
      }
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return hidden ? null : <g key={`highlight-${shape.id}`} opacity={resolveOpacity(shape, (id) => byId.get(id), () => false)}>{content}</g>;
  });
  return <>{topLevel.map((shape) => render(shape, false))}{overlays}</>;
}

/** Fetch each `/api/blobs/...` image and inline it as a data URL (canvas taint). */
async function inlineBlobImages(svg: string): Promise<string> {
  const urls = [
    ...new Set(
      [
        ...svg.matchAll(/\/api\/blobs\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)/g),
      ].map((m) => m[0]),
    ),
  ];
  let out = svg;
  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const dataUrl = await blobToDataUrl(await res.blob());
      out = out.split(url).join(dataUrl);
    } catch {
      // Leave the href as-is; the export still renders without that image.
    }
  }
  return out;
}

/** Embed a bundled web font (matched by name) so exported text matches metrics. */
async function webFontFace(match: RegExp, familyName: string): Promise<string> {
  try {
    let url: string | null = null;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet: not readable
      }
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSFontFaceRule &&
          match.test(rule.style.getPropertyValue('font-family'))
        ) {
          const m = rule.style
            .getPropertyValue('src')
            .match(/url\(["']?([^"')]+\.woff2?[^"')]*)["']?\)/i);
          if (m) {
            url = m[1] ?? null;
            break;
          }
        }
      }
      if (url) break;
    }
    if (!url) return '';
    const buf = await (
      await fetch(url, { credentials: 'include' })
    ).arrayBuffer();
    return (
      `@font-face{font-family:'${familyName}';font-style:normal;` +
      `font-weight:100 900;font-display:block;` +
      `src:url(data:font/woff2;base64,${arrayBufferToBase64(buf)}) format('woff2');}`
    );
  } catch {
    return ''; // fall back to the next font in the stack
  }
}

/** Draw the SVG onto a canvas and read it back as a PNG blob. */
async function rasterize(svg: string, w: number, h: number): Promise<Blob> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to render SVG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000; // avoid call-stack overflow on large fonts
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safeFilename(title: string): string {
  const clean = title
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return clean || 'board';
}
