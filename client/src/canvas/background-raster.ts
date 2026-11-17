import type { Camera } from './camera';
import {
  getDotGridLayers,
  getGridLevels,
  isTriangleGrid,
  pmod,
  triangleTile,
  type BackgroundType,
} from './grid';
import { rasterZoom } from './raster-grid';

export interface BackgroundRaster {
  zoom: number;
  band: number;
  level: string;
  period: number;
  periodY: number;
  ratio: number;
}

export function backgroundLevel(type: BackgroundType, camera: Camera): string {
  return type === 'dot'
    ? getDotGridLayers(camera)
        .filter((l) => l.opacity > 0.01)
        .map((l) => l.id)
        .join(',')
    : String(getGridLevels(camera).minorStep);
}

/** Paint one periodic tile, then fill a wallpaper large enough for any camera
 * in this √2 band. The camera subsequently changes only the CSS transform. */
export function paintBackgroundRaster(
  canvas: HTMLCanvasElement,
  type: BackgroundType,
  camera: Camera,
  width: number,
  height: number,
): BackgroundRaster | null {
  const origin = { x: 0, y: 0, z: camera.z };
  const layers = getDotGridLayers(origin).filter((l) => l.opacity > 0.01);
  const grid = getGridLevels(origin);
  const major = isTriangleGrid(type)
    ? triangleTile(type, grid.majorScreen)
    : null;
  const period =
    type === 'dot' ? layers[0]!.screenStep : (major?.w ?? grid.majorScreen);
  const periodY = major?.h ?? period;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const tile = document.createElement('canvas');
  tile.width = Math.max(1, Math.ceil(period * ratio));
  tile.height = Math.max(1, Math.ceil(periodY * ratio));
  const ctx = tile.getContext('2d');
  const wallpaper = canvas.getContext('2d');
  if (!ctx || !wallpaper) return null;
  const style = getComputedStyle(document.documentElement);
  ctx.scale(tile.width / period, tile.height / periodY);
  if (type === 'dot') {
    ctx.fillStyle = style.getPropertyValue('--grid-dot-ink').trim();
    for (const layer of layers) {
      ctx.globalAlpha = layer.opacity;
      // Include neighbours across all four tile edges, so translation never
      // clips half a dot at a wallpaper seam.
      for (let y = -layer.screenStep; y <= period + 1; y += layer.screenStep) {
        for (
          let x = -layer.screenStep;
          x <= period + 1;
          x += layer.screenStep
        ) {
          ctx.beginPath();
          ctx.arc(x, y, layer.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } else if (isTriangleGrid(type)) {
    ctx.lineWidth = 1;
    for (const [step, color] of [
      [grid.minorScreen, '--grid-minor'],
      [grid.majorScreen, '--grid-major'],
    ] as const) {
      const t = triangleTile(type, step);
      ctx.strokeStyle = style.getPropertyValue(color).trim();
      ctx.beginPath();
      for (let y = 0; y < periodY - 0.001; y += t.h) {
        for (let x = 0; x < period - 0.001; x += t.w) {
          for (const [x1, y1, x2, y2] of t.lines) {
            ctx.moveTo(x + x1!, y + y1!);
            ctx.lineTo(x + x2!, y + y2!);
          }
        }
      }
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = 1;
    for (const [step, color] of [
      [grid.minorScreen, '--grid-minor'],
      [grid.majorScreen, '--grid-major'],
    ] as const) {
      ctx.strokeStyle = style.getPropertyValue(color).trim();
      ctx.beginPath();
      for (let p = 0; p <= period + 0.001; p += step) {
        ctx.moveTo(p, 0);
        ctx.lineTo(p, period);
        ctx.moveTo(0, p);
        ctx.lineTo(period, p);
      }
      ctx.stroke();
    }
  }
  // A cache made at the top of a band can be shrunk by 1/√2 before crossing
  // its bottom. Extra periods cover the modulo translation in both axes.
  const w = Math.ceil(width * Math.SQRT2 + 2 * period);
  const h = Math.ceil(height * Math.SQRT2 + 2 * periodY);
  // Bound background allocations too, including very large external displays.
  const dpr = Math.min(ratio, Math.sqrt((32 * 1024 * 1024) / (w * h * 4)));
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  wallpaper.scale(canvas.width / w, canvas.height / h);
  const pattern = wallpaper.createPattern(tile, 'repeat');
  if (!pattern) return null;
  pattern.setTransform(
    new DOMMatrix().scale(period / tile.width, periodY / tile.height),
  );
  wallpaper.fillStyle = pattern;
  // The tile holds opaque ink; the dot alpha is applied once here, matching
  // the vector grid's group opacity.
  if (type === 'dot') {
    wallpaper.globalAlpha =
      Number(style.getPropertyValue('--grid-dot-alpha').trim()) || 1;
  }
  wallpaper.fillRect(0, 0, w, h);
  canvas.dataset.rasterPaints = String(
    Number(canvas.dataset.rasterPaints ?? 0) + 1,
  );
  return {
    zoom: camera.z,
    band: rasterZoom(camera.z),
    period,
    periodY,
    level: backgroundLevel(type, camera),
    ratio,
  };
}

export function backgroundRasterTransform(
  raster: BackgroundRaster,
  camera: Camera,
): string {
  const scale = camera.z / raster.zoom;
  const period = raster.period * scale;
  const periodY = raster.periodY * scale;
  // Phase is in screen units. Modulo keeps arbitrarily long pans within the
  // prepainted wallpaper instead of eventually exposing an empty edge.
  const x = pmod(-camera.x * camera.z, period) - period;
  const y = pmod(-camera.y * camera.z, periodY) - periodY;
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}
