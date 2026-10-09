import type { Camera } from './camera';
import {
  RASTER_TILE_BLEED,
  RASTER_TILE_SIZE,
  rasterTiles,
  rasterZoom,
  tilePixelRatio,
  type RasterTile,
} from './raster-grid';

export interface TileSource {
  tile(
    tile: RasterTile,
    zoom: number,
    pixels: number,
  ): Promise<HTMLCanvasElement>;
  dispose(): void;
}

interface Options {
  live: HTMLDivElement;
  host: HTMLDivElement;
  width: number;
  height: number;
  camera(): Camera;
  moving(): boolean;
  eligible(): boolean;
  source(): TileSource;
}

interface CachedTile {
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
}

/** Bounded, incremental tile cache. Never hide the live scene until every cell
 * covering the current viewport is ready. Old asynchronous work cannot publish
 * across a document revision, zoom level, resize, or unmount. */
export class ShapeTileCache {
  private tiles = new Map<string, CachedTile>();
  private failed = new Set<string>();
  private wanted: RasterTile[] = [];
  private visible: RasterTile[] = [];
  private source: TileSource | null = null;
  private generation = 0;
  private zoom = 0;
  private ratio = 0;
  private moving = false;
  private frame = 0;
  private busy = false;
  private disposed = false;
  private paints = 0;
  private fallback: {
    zoom: number;
    host: HTMLDivElement;
    tiles: Map<string, CachedTile>;
  } | null = null;

  constructor(private options: Options) {}

  invalidate = () => {
    this.reset(false);
  };

  private reset(keepFallback: boolean) {
    this.generation++;
    this.source?.dispose();
    this.source = null;
    for (const tile of this.tiles.values()) this.release(tile);
    this.tiles.clear();
    this.failed.clear();
    if (!keepFallback) this.clearFallback();
    this.show(false);
    this.schedule();
  }

  private clearFallback() {
    if (!this.fallback) return;
    for (const tile of this.fallback.tiles.values()) this.release(tile);
    this.fallback.host.remove();
    this.fallback = null;
  }

  private preserveFallback() {
    // Keep a complete previous level on screen while the new level is built.
    // Partial replacements must never displace a usable older set of tiles.
    if (
      !this.visible.length ||
      !this.visible.every((t) => this.tiles.has(t.key))
    )
      return;
    this.clearFallback();
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'absolute', transformOrigin: '0 0' });
    for (const tile of this.tiles.values()) host.append(tile.element);
    this.fallback = { zoom: this.zoom, tiles: new Map(this.tiles), host };
    this.tiles.clear();
    this.options.host.append(host);
  }

  private release(tile: { element: HTMLElement; canvas: HTMLCanvasElement }) {
    tile.element.remove();
    tile.canvas.width = tile.canvas.height = 0;
  }

  private show(cached: boolean, fallback = false) {
    this.options.live.style.display = cached ? 'none' : '';
    this.options.host.style.display = cached ? '' : 'none';
    this.options.host.dataset.rasterState = cached
      ? 'cached'
      : this.failed.size
        ? 'unsupported'
        : 'live';
    this.options.host.dataset.rasterTiles = String(this.tiles.size);
    this.options.host.dataset.rasterPaints = String(this.paints);
    if (this.fallback)
      this.fallback.host.style.display = fallback ? '' : 'none';
    for (const tile of this.tiles.values())
      tile.element.style.display = fallback ? 'none' : '';
  }

  refresh = () => {
    if (this.disposed) return;
    const { camera: readCamera, width, height, host } = this.options;
    const camera = readCamera();
    const moving = this.options.moving();
    if (!this.options.eligible() || width <= 0 || height <= 0) {
      if (this.tiles.size || this.source || this.fallback) this.invalidate();
      this.wanted = this.visible = [];
      this.show(false);
      host.dataset.rasterState = 'disabled';
      this.moving = moving;
      return;
    }
    const zoom = rasterZoom(camera.z);
    // Worst-case cell count for this viewport across an entire band, including
    // a tile on each edge. Keep resolution stable during ordinary panning.
    const maxTiles =
      (Math.ceil((width * 1.5 * Math.SQRT2) / RASTER_TILE_SIZE) + 2) *
      (Math.ceil((height * 1.5 * Math.SQRT2) / RASTER_TILE_SIZE) + 2);
    // Reserve half the backing-store budget for the previous zoom level.
    const ratio = tilePixelRatio(window.devicePixelRatio || 1, maxTiles * 2);
    if (
      zoom !== this.zoom ||
      ratio !== this.ratio ||
      (!moving && this.moving)
    ) {
      const crossing = moving && zoom !== this.zoom && this.zoom !== 0;
      if (crossing) this.preserveFallback();
      this.reset(crossing);
      this.zoom = zoom;
      this.ratio = ratio;
    }
    this.moving = moving;
    this.wanted = rasterTiles(camera, width, height, zoom);
    this.visible = rasterTiles(camera, width, height, zoom, 0);
    if (!this.wanted.length || ratio < 0.5) {
      this.wanted = this.visible = [];
      this.show(false);
      return;
    }
    const wanted = new Set(this.wanted.map((t) => t.key));
    for (const [key, tile] of this.tiles) {
      if (!wanted.has(key)) {
        this.release(tile);
        this.tiles.delete(key);
      }
    }
    for (const key of this.failed)
      if (!wanted.has(key)) this.failed.delete(key);
    host.style.transform = `translate3d(${-camera.x * camera.z}px, ${-camera.y * camera.z}px, 0) scale(${camera.z / zoom})`;
    const ready =
      this.visible.length > 0 &&
      this.visible.every((t) => this.tiles.has(t.key));
    let fallbackReady = false;
    if (this.fallback && !ready) {
      const needed = rasterTiles(camera, width, height, this.fallback.zoom, 0);
      fallbackReady =
        needed.length > 0 &&
        needed.every((t) => this.fallback!.tiles.has(t.key));
      this.fallback.host.style.transform = `scale(${zoom / this.fallback.zoom})`;
    }
    if (ready) this.clearFallback();
    this.show(
      moving && (ready || fallbackReady),
      moving && !ready && fallbackReady,
    );
    this.schedule();
  };

  private schedule() {
    if (this.frame || this.busy || this.disposed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      void this.paintNext();
    });
  }

  private async paintNext() {
    if (this.disposed || this.busy) return;
    // Re-evaluate after React has committed any new shapes or asset markup.
    this.refresh();
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    const tile = this.wanted.find(
      (t) => !this.tiles.has(t.key) && !this.failed.has(t.key),
    );
    if (!tile) return;
    this.busy = true;
    const generation = this.generation;
    const side = RASTER_TILE_SIZE + RASTER_TILE_BLEED * 2;
    try {
      this.source ??= this.options.source();
      const canvas = await this.source.tile(
        tile,
        this.zoom,
        Math.max(1, Math.floor(side * this.ratio)),
      );
      if (
        this.disposed ||
        generation !== this.generation ||
        !this.wanted.some((t) => t.key === tile.key)
      ) {
        canvas.width = canvas.height = 0;
        return;
      }
      const element = document.createElement('div');
      Object.assign(element.style, {
        position: 'absolute',
        left: `${tile.x * RASTER_TILE_SIZE}px`,
        top: `${tile.y * RASTER_TILE_SIZE}px`,
        width: `${RASTER_TILE_SIZE}px`,
        height: `${RASTER_TILE_SIZE}px`,
        overflow: 'hidden',
      });
      Object.assign(canvas.style, {
        position: 'absolute',
        left: `${-RASTER_TILE_BLEED}px`,
        top: `${-RASTER_TILE_BLEED}px`,
        width: `${side}px`,
        height: `${side}px`,
      });
      element.dataset.rasterTile = tile.key;
      element.append(canvas);
      this.options.host.append(element);
      this.tiles.set(tile.key, { canvas, element });
      this.paints++;
    } catch {
      if (generation === this.generation && !this.disposed)
        this.failed.add(tile.key);
    } finally {
      this.busy = false;
      if (!this.disposed) this.refresh();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.invalidate();
  }
}
