import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Bounds, type Shape, unionBounds } from '@whiteboard/shared';
import { descendantsOf } from './hierarchy';
import { getEquationRender, typesetEquation } from './equation-render';
import { shapeRotatedBounds } from './shape-bounds';
import {
  DEFAULT_PNG_EXPORT_SCALE,
  PNG_EXPORT_SCALES,
  useCanvasUiStore,
} from './use-canvas-ui-store';
import { compareIndex, editor } from './use-document-store';
import { shapeRegistry } from './shapes/shape-registry';
import { FrameView } from './shapes/frame';
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
  await prewarmEquationRenders(shapes);
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
  await prewarmEquationRenders(shapes, renderSet);
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
 * after `prewarmEquationRenders`, which fills the cache this reads.
 */
export function isExportable(shape: Shape): boolean {
  if (shape.type !== 'equation') return true;
  const latex = shape.props.latex.trim();
  if (!latex) return false;
  const render = getEquationRender(latex);
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
    const render = getEquationRender(shape.props.latex.trim());
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

/** Fill the synchronous equation cache before server-rendering the SVG tree. */
async function prewarmEquationRenders(
  shapes: Shape[],
  renderSet?: Set<string>,
): Promise<void> {
  const latexes = new Set<string>();
  for (const shape of shapes) {
    if (shape.type !== 'equation' || (renderSet && !renderSet.has(shape.id))) {
      continue;
    }
    const latex = shape.props.latex.trim();
    if (latex) latexes.add(latex);
  }
  await Promise.all(
    [...latexes].map((latex) => typesetEquation(latex).catch(() => undefined)),
  );
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

/** Rasterize a scene to a PNG blob at the largest scale the caps allow. */
async function renderPngBlob({ tree, bounds, padding }: Scene): Promise<Blob> {
  const minX = bounds.minX - padding;
  const minY = bounds.minY - padding;
  const w = bounds.maxX - bounds.minX + padding * 2;
  const h = bounds.maxY - bounds.minY + padding * 2;

  // The user's chosen resolution (Settings → General → PNG Resolution). This
  // used to be `min(devicePixelRatio, 2)`, which made the same board export at
  // a different size depending on the monitor it happened to be opened on.
  let scale = exportScale();
  // `MAX_DIM` still wins: a sprawling board at 4x would otherwise allocate a
  // canvas large enough to fail, so the request is silently reduced to fit.
  scale = Math.min(scale, MAX_DIM / w, MAX_DIM / h);
  scale = Math.max(scale, 0.1);
  const outW = Math.ceil(w * scale);
  const outH = Math.ceil(h * scale);

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
function renderTree(renderSet?: Set<string>, rootFrameId?: string): ReactNode {
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
    return Component ? <Component key={shape.id} shape={shape} /> : null;
  };

  const topLevel = [...shapes]
    .sort(compareIndex)
    .filter((s) => inSet(s.id) && !hasRenderedFrameAncestor(s));
  return <>{topLevel.map((shape) => render(shape, false))}</>;
}

/**
 * Replace `var(--name[, fallback])` tokens with their computed value. Shapes use
 * Tailwind theme vars (e.g. `--color-border`) that alias raw vars (`--border`);
 * when the alias isn't a resolvable custom property we strip the `color-`
 * prefix. A detached SVG can't see the page stylesheet, so this must run before
 * rasterizing.
 */
function resolveCssVars(input: string): string {
  const root = getComputedStyle(document.documentElement);
  const read = (name: string): string => {
    let v = root.getPropertyValue(name).trim();
    if (!v && name.startsWith('--color-')) {
      v = root.getPropertyValue(`--${name.slice('--color-'.length)}`).trim();
    }
    return v;
  };
  const re = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g;
  let out = input;
  // Loop because a resolved value (e.g. color-mix) may itself contain var().
  for (let i = 0; i < 5 && out.includes('var('); i++) {
    out = out.replace(re, (_m, name: string, fallback?: string) => {
      const v = read(name);
      return v || (fallback?.trim() ?? '');
    });
  }
  return out;
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
