import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Shape } from '@whiteboard/shared';
import { compareIndex, editor, spatialIndex } from './use-document-store';
import { shapeRegistry } from './shapes/shape-registry';
import { FrameView } from './shapes/frame';

// World-space padding added around the content bounds in the exported image.
const PADDING = 32;
// Cap either output dimension so a sprawling board can't allocate a huge canvas.
const MAX_DIM = 8192;

/**
 * Export the whole current page as a PNG and trigger a download.
 *
 * The board is SVG-native, so we re-render every shape (the live canvas is
 * viewport-culled) into a standalone SVG sized to the content bounds, inline
 * everything the page environment would otherwise supply — CSS variables, the
 * Inter web font, and `/api/blobs` images — then rasterize it to PNG.
 */
export async function exportBoardToPng(title: string): Promise<void> {
  const bounds = spatialIndex.totalBounds();
  if (!bounds) return; // empty board: nothing to export

  const minX = bounds.minX - PADDING;
  const minY = bounds.minY - PADDING;
  const w = bounds.maxX - bounds.minX + PADDING * 2;
  const h = bounds.maxY - bounds.minY + PADDING * 2;

  let scale = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.min(scale, MAX_DIM / w, MAX_DIM / h);
  scale = Math.max(scale, 0.1);
  const outW = Math.ceil(w * scale);
  const outH = Math.ceil(h * scale);

  const shapeMarkup = resolveCssVars(renderToStaticMarkup(renderTree()));
  const inlined = await inlineBlobImages(shapeMarkup);
  const bg = resolveCssVars('var(--color-background)') || '#ffffff';
  const fontFace = await interFontFace();

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" ` +
    `viewBox="${minX} ${minY} ${w} ${h}">` +
    `<style>${fontFace}</style>` +
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="${bg}"/>` +
    `${inlined}</svg>`;

  const blob = await rasterize(svg, outW, outH);
  download(blob, `${safeFilename(title)}.png`);
}

/**
 * The full shape tree for the current page, mirroring `Canvas`'s render rules:
 * frames clip and recurse over their direct children; every other shape (incl.
 * group members) renders flat. No viewport culling and no eraser dimming.
 */
function renderTree(): ReactNode {
  const shapes = editor.getShapes();
  const byId = new Map(shapes.map((s) => [s.id, s]));

  const hasFrameAncestor = (s: Shape): boolean => {
    let cur = s.parentId ? byId.get(s.parentId) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'frame') return true;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };

  const childrenOf = (parentId: string) =>
    shapes.filter((s) => s.parentId === parentId).sort(compareIndex);

  const render = (shape: Shape): ReactNode => {
    if (shape.type === 'frame') {
      return (
        <FrameView key={shape.id} frame={shape}>
          {childrenOf(shape.id).map(render)}
        </FrameView>
      );
    }
    const Component = shapeRegistry.getFor(shape)?.Component;
    return Component ? <Component key={shape.id} shape={shape} /> : null;
  };

  const topLevel = [...shapes]
    .sort(compareIndex)
    .filter((s) => !hasFrameAncestor(s));
  return <>{topLevel.map(render)}</>;
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
    ...new Set([...svg.matchAll(/\/api\/blobs\/[A-Za-z0-9]+/g)].map((m) => m[0])),
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

/** Inter is the one bundled web font; embed it so exported text matches metrics. */
async function interFontFace(): Promise<string> {
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
          /inter/i.test(rule.style.getPropertyValue('font-family'))
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
    const buf = await (await fetch(url, { credentials: 'include' })).arrayBuffer();
    return (
      `@font-face{font-family:'Inter Variable';font-style:normal;` +
      `font-weight:100 900;font-display:block;` +
      `src:url(data:font/woff2;base64,${arrayBufferToBase64(buf)}) format('woff2');}`
    );
  } catch {
    return ''; // fall back to system-ui in the font stack
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
