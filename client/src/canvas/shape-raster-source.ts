import type { CanvasScene } from './engine/scene';
import { createCssVarResolver } from './css-vars';
import {
  RASTER_TILE_BLEED,
  RASTER_TILE_SIZE,
  type RasterTile,
} from './raster-grid';
import { RasterResources } from './raster-svg';

const NS = 'http://www.w3.org/2000/svg';

/** Copy the mounted SVG output (including both highlighter passes) instead of
 * re-running renderers or exporting a different version of the document. */
export class ShapeRasterSource {
  private serialized = new Map<string, { group: SVGGElement; size: number }>();
  private serializedSize = 0;
  private resolve = createCssVarResolver();
  readonly resources = new RasterResources();

  constructor(
    private scene: CanvasScene,
    private layer: HTMLDivElement,
    private containers: Map<string, HTMLDivElement>,
  ) {}

  dispose() {
    this.resources.dispose();
    this.serialized.clear();
  }

  private copy(id: string, overlay: boolean): SVGGElement | null {
    const key = `${overlay ? 'overlay:' : ''}${id}`;
    const cached = this.serialized.get(key);
    if (cached) return cached.group.cloneNode(true) as SVGGElement;
    const node = this.scene.record(id);
    const presentation = node.presentation.get();
    if (
      presentation.visibility === 'hidden' ||
      Number(presentation.opacity) === 0
    )
      return null;
    const container = overlay
      ? (this.containers.get(id)?.nextElementSibling as HTMLDivElement | null)
      : this.containers.get(id);
    // A highlight's second wrapper is adjacent in the stable sibling list.
    if (overlay && container?.dataset.highlightOverlay !== id) return null;
    if (!container || !this.layer.contains(container))
      throw new Error('Shape has not mounted');
    const svg = container.firstElementChild;
    if (!(svg instanceof SVGSVGElement)) throw new Error('Non-SVG shape');
    if (
      svg.querySelector(
        'foreignObject, animate, animateTransform, animateMotion, set',
      )
    ) {
      throw new Error('Live embedded content');
    }
    const group = document.createElementNS(NS, 'g');
    group.setAttribute('transform', presentation.transform);
    group.setAttribute('opacity', presentation.opacity);
    const content = document.createElementNS(NS, 'g');
    content.innerHTML = this.resolve(svg.innerHTML);
    if (presentation.clipPath !== 'none') {
      const clip = document.createElementNS(NS, 'clipPath');
      // This id is local to each standalone tile SVG.
      const clipId = `raster-clip-${key}`;
      clip.id = clipId;
      clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const polygon = document.createElementNS(NS, 'polygon');
      polygon.setAttribute(
        'points',
        presentation.clipPath.slice(8, -1).replace(/px/g, ''),
      );
      clip.append(polygon);
      group.append(clip);
      content.setAttribute('clip-path', `url(#${clipId})`);
    }
    group.append(content);
    const size = group.outerHTML.length;
    // Panning can visit the whole board in one gesture. Keep the source cache
    // bounded independently of the tile backing-store budget.
    while (
      this.serialized.size &&
      (this.serialized.size >= 512 || this.serializedSize + size > 2_000_000)
    ) {
      const oldest = this.serialized.keys().next().value!;
      this.serializedSize -= this.serialized.get(oldest)!.size;
      this.serialized.delete(oldest);
    }
    if (size <= 2_000_000) {
      this.serialized.set(key, { group, size });
      this.serializedSize += size;
    }
    return group.cloneNode(true) as SVGGElement;
  }

  async tile(tile: RasterTile, zoom: number, pixels: number): Promise<string> {
    const side = RASTER_TILE_SIZE + RASTER_TILE_BLEED * 2;
    const x = (tile.x * RASTER_TILE_SIZE - RASTER_TILE_BLEED) / zoom;
    const y = (tile.y * RASTER_TILE_SIZE - RASTER_TILE_BLEED) / zoom;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', String(pixels));
    svg.setAttribute('height', String(pixels));
    svg.setAttribute('viewBox', `${x} ${y} ${side / zoom} ${side / zoom}`);
    // Index bounds exclude adaptive frame headings and image shadows. Include
    // their neighbours as well as the sampling bleed at the tile boundary.
    const margin = 64 + 64 / zoom;
    const ids = this.scene.index.search({
      minX: x - margin,
      minY: y - margin,
      maxX: x + side / zoom + margin,
      maxY: y + side / zoom + margin,
    });
    ids.sort(
      (a, b) => this.scene.record(a).z.get() - this.scene.record(b).z.get(),
    );
    for (const overlay of [false, true]) {
      for (const id of ids) {
        const shape = this.scene.record(id).shape.get();
        if (!shape || shape.type === 'group') continue;
        if (
          overlay &&
          !(shape.type === 'draw' && shape.props.inkKind === 'highlight')
        )
          continue;
        const group = this.copy(id, overlay);
        if (group) svg.append(group);
      }
    }
    return this.resources.inline(svg);
  }
}
