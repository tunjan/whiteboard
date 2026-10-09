import { atom, computed, react } from '@tldraw/state';
import type { Shape } from '@whiteboard/shared';
import { useThemeStore } from '@/use-theme-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import type { Camera } from './camera';
import { DEFAULT_CAMERA } from './camera';
import { type Bounds, type Point, viewportWorldBounds } from './geometry';
import {
  allowedJumpBounds,
  boundsSize,
  contentPageBounds,
  dampToShapeBounds,
  fitPageBounds,
  minimapPointToPage,
  minimapZoom,
  snapToDominantAxis,
  viewportRadius,
  type Size,
} from './minimap-geometry';
import { useCameraStore } from './use-camera-store';
import { spatialIndex, useDocumentStore } from './use-document-store';
import { shapeStore } from './engine/shape-store';
import { subscribeShapes } from './use-shapes';
import { useHiddenStore } from './use-hidden-store';
import { useSelectionStore } from './use-selection-store';

const PI2 = Math.PI * 2;

/**
 * Screen radius of a collaborator's dot. Divided back out by the minimap scale
 * before it is drawn, so the dot is the same size however much world the
 * minimap is showing.
 */
const CURSOR_DOT_SCREEN_RADIUS = 3;

/** A retina buffer is worth paying for; a 4x one is not. */
const MAX_DPR = 3;

interface MinimapColors {
  ground: string;
  shape: string;
  selected: string;
  viewport: string;
  viewportBorder: string;
}

interface CursorDot {
  x: number;
  y: number;
  color: string;
}

function currentDpr(): number {
  const raw = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(MAX_DPR, Math.max(1, raw));
}

function sameDots(a: readonly CursorDot[], b: readonly CursorDot[]): boolean {
  return (
    a.length === b.length &&
    a.every((dot, i) => {
      const other = b[i]!;
      return (
        dot.x === other.x && dot.y === other.y && dot.color === other.color
      );
    })
  );
}

/**
 * Whether a shape is kept off the minimap.
 *
 * Local hides are per-user and hierarchical (hiding a frame hides what is
 * inside it), so this walks ancestors the way `resolveOpacity` does rather than
 * testing the shape alone — otherwise a hidden frame's contents would still be
 * plotted, and the minimap would show a drawing the board does not.
 */
function isHiddenFromMinimap(
  shape: Shape,
  getShape: (id: string) => Shape | undefined,
  locallyHidden: Record<string, true>,
): boolean {
  if (shape.hidden || locallyHidden[shape.id]) return true;
  if (!shape.parentId) return false;
  const seen = new Set<string>([shape.id]);
  let cur = getShape(shape.parentId);
  while (cur && !seen.has(cur.id)) {
    if (cur.hidden || locallyHidden[cur.id]) return true;
    seen.add(cur.id);
    cur = cur.parentId ? getShape(cur.parentId) : undefined;
  }
  return false;
}

/**
 * The minimap's lifecycle and renderer: one 2D canvas, one affine transform,
 * and a signal graph that keeps the per-frame cost off the shape count.
 *
 * The split that matters is between *geometry* and *camera*. Shape rectangles
 * are compiled into two `Path2D` objects in page space, so panning and zooming
 * the board re-submits the same compiled paths under a new context transform —
 * no per-shape work, no allocation. Only an actual document edit or a selection
 * change recompiles them.
 *
 * Bounds come straight from the canvas's existing R-tree, which already keeps
 * one rotated world AABB per shape and already invalidates it per mutation.
 * A second per-shape bounds cache beside it would be the same numbers computed
 * twice.
 */
export class MinimapManager {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly disposables: (() => void)[] = [];

  /** The canvas element's layout box, in CSS pixels relative to the client. */
  private readonly screen = atom<Bounds>('minimap screen', {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
  });
  private readonly dpr = atom('minimap dpr', currentDpr());
  private readonly camera = atom<Camera>('minimap camera', DEFAULT_CAMERA);
  private readonly viewport = atom<Size>('minimap board viewport', {
    width: 0,
    height: 0,
  });
  /**
   * Bumped whenever the page's geometry changes. The published shape array and
   * the R-tree are plain objects rather than signals, so this is the one edge
   * that makes the compiled paths depend on the document.
   *
   * A live local stroke deliberately does not publish a snapshot until it ends
   * (see `applyAffected`), so the stroke appears on the minimap when the
   * pointer lifts. That is the same trade the shape layer already makes, and
   * the alternative is redrawing the minimap on every ink sample.
   */
  private readonly geometryEpoch = atom('minimap geometry epoch', 0);
  private readonly selectedIds = atom<readonly string[]>(
    'minimap selection',
    [],
  );
  private readonly presenceEpoch = atom('minimap presence epoch', 0);

  private colors: MinimapColors;

  /** Anchor state for an in-progress drag, owned by the gesture handler. */
  originPagePoint: Point = { x: 0, y: 0 };
  originPageCenter: Point = { x: 0, y: 0 };
  grabbedViewport = false;

  constructor(readonly elem: HTMLCanvasElement) {
    const ctx = elem.getContext('2d');
    if (!ctx) throw new Error('Minimap: could not get a 2D canvas context');
    this.ctx = ctx;
    this.colors = this.readColors();

    const syncCamera = () => {
      const state = useCameraStore.getState();
      this.camera.set(state.camera);
      this.viewport.set(state.viewport);
    };
    syncCamera();
    this.selectedIds.set(useSelectionStore.getState().selectedIds);

    const observer = new ResizeObserver(() => {
      const rect = elem.getBoundingClientRect();
      this.screen.set({
        minX: rect.left,
        minY: rect.top,
        maxX: rect.right,
        maxY: rect.bottom,
      });
      this.dpr.set(currentDpr());
    });
    observer.observe(elem);

    this.disposables.push(
      () => observer.disconnect(),
      this.watchDpr(),
      useCameraStore.subscribe(syncCamera),
      subscribeShapes(() => this.geometryEpoch.update((n) => n + 1)),
      useDocumentStore.subscribe((next, prev) => {
        if (next.currentPageId !== prev.currentPageId) {
          this.geometryEpoch.update((n) => n + 1);
        }
      }),
      useHiddenStore.subscribe(() => this.geometryEpoch.update((n) => n + 1)),
      useSelectionStore.subscribe((next, prev) => {
        if (next.selectedIds !== prev.selectedIds) {
          this.selectedIds.set(next.selectedIds);
        }
      }),
      usePresenceStore.subscribe(() =>
        this.presenceEpoch.update((n) => n + 1),
      ),
      useThemeStore.subscribe(() => this.refreshColors()),
      react('minimap render', this.render),
    );
  }

  close = (): void => {
    for (const dispose of this.disposables) dispose();
    this.disposables.length = 0;
  };

  /**
   * Track the device pixel ratio without polling. A window moved between a
   * retina and a non-retina display changes `devicePixelRatio` without
   * necessarily changing the element's CSS size, so the ResizeObserver alone
   * would leave the buffer at the old density.
   */
  private watchDpr(): () => void {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {};
    let query: MediaQueryList | null = null;
    const onChange = () => {
      this.dpr.set(currentDpr());
      arm();
    };
    const arm = () => {
      query?.removeEventListener('change', onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', onChange);
    };
    arm();
    return () => query?.removeEventListener('change', onChange);
  }

  private readColors(): MinimapColors {
    const style = getComputedStyle(this.elem);
    const read = (name: string) => style.getPropertyValue(name).trim();
    return {
      ground: read('--minimap-ground'),
      shape: read('--minimap-shape'),
      selected: read('--minimap-selected'),
      viewport: read('--minimap-viewport'),
      viewportBorder: read('--minimap-viewport-border'),
    };
  }

  /**
   * Re-sample the palette after a theme change.
   *
   * Deferred a frame on purpose: the theme is a class on the document root, and
   * reading a custom property in the same task that toggled it can resolve
   * against the old cascade.
   */
  refreshColors(): void {
    requestAnimationFrame(() => {
      if (!this.disposables.length) return;
      this.colors = this.readColors();
      this.render();
    });
  }

  /** The minimap element's size in CSS pixels. */
  getScreenSize(): Size {
    return boundsSize(this.screen.get());
  }

  /** World rectangle the board's own viewport is showing. */
  getViewportPageBounds = computed('minimap viewport bounds', () => {
    const { width, height } = this.viewport.get();
    return viewportWorldBounds(this.camera.get(), width, height);
  });

  /**
   * Union of every shape's bounds on this page.
   *
   * `totalBounds` walks the whole index, so it is kept off the camera's
   * dependency chain: unioned with the viewport inside one computed, a pan
   * would re-scan the page every frame the minimap is open. Split out, a pan
   * re-reads a cached rectangle and only an edit pays the scan.
   *
   * Gated on the same epoch as the compiled paths, which is what keeps the
   * projection and the drawing telling the same story — a live local stroke
   * publishes neither until the pointer lifts.
   */
  private getDocumentPageBounds = computed('minimap document bounds', () => {
    this.geometryEpoch.get();
    return spatialIndex.totalBounds();
  });

  /** Union of the page's shapes and the board viewport. */
  getContentPageBounds = computed('minimap content bounds', () =>
    contentPageBounds(
      this.getDocumentPageBounds.get(),
      this.getViewportPageBounds.get(),
    ),
  );

  /** The world rectangle the minimap projects, aspect-matched to its element. */
  getCanvasPageBounds = computed('minimap page bounds', () =>
    fitPageBounds(this.getContentPageBounds.get(), this.getScreenSize()),
  );

  /** Minimap CSS pixels per world unit. */
  getZoom = computed('minimap zoom', () =>
    minimapZoom(this.getCanvasPageBounds.get(), this.getScreenSize()),
  );

  /**
   * Shape rectangles compiled once per document change, in page space.
   *
   * Nothing here reads the camera, which is the whole point: a pan or a zoom
   * leaves these paths valid and the renderer only replaces the context
   * transform under them.
   */
  private getShapePaths = computed('minimap shape paths', () => {
    this.geometryEpoch.get();
    const selectedIds = new Set(this.selectedIds.get());
    const shapes = shapeStore.sorted.get();
    const locallyHidden = useHiddenStore.getState().hidden;
    const getShape = (id: string) => shapeStore.peek(id);

    const shapesPath = new Path2D();
    const selectedPath = new Path2D();
    for (let i = 0, len = shapes.length; i < len; i++) {
      const shape = shapes[i]!;
      // Groups carry no geometry of their own and are absent from the index;
      // their children are indexed individually and drawn here.
      const bounds = spatialIndex.getBounds(shape.id);
      if (!bounds) continue;
      if (isHiddenFromMinimap(shape, getShape, locallyHidden)) continue;
      const target = selectedIds.has(shape.id) ? selectedPath : shapesPath;
      target.rect(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
      );
    }
    return { shapes: shapesPath, selected: selectedPath };
  });

  /**
   * Collaborator cursors on this page, as flat dots.
   *
   * Derived with an equality check because awareness republishes the whole peer
   * list for any field — a latency measurement or a mute toggle would otherwise
   * redraw the minimap for a picture that has not changed.
   */
  private getCursorDots = computed(
    'minimap cursor dots',
    () => {
      this.presenceEpoch.get();
      const pageId = useDocumentStore.getState().currentPageId;
      const dots: CursorDot[] = [];
      for (const peer of usePresenceStore.getState().peers) {
        if (!peer.cursor || peer.page !== pageId) continue;
        dots.push({ x: peer.cursor.x, y: peer.cursor.y, color: peer.color });
      }
      return dots;
    },
    { isEqual: sameDots },
  );

  /** Project a client point onto the world, with optional clamping and snapping. */
  minimapScreenPointToPagePoint(
    clientX: number,
    clientY: number,
    shiftKey = false,
    clampToBounds = false,
  ): Point {
    const screenBounds = this.screen.get();
    const page = this.getCanvasPageBounds.get();
    let point = minimapPointToPage(
      { x: clientX - screenBounds.minX, y: clientY - screenBounds.minY },
      page,
      boundsSize(screenBounds),
    );

    if (clampToBounds) {
      const shapes = this.getDocumentPageBounds.get();
      point = dampToShapeBounds(
        point,
        shapes ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        boundsSize(this.getViewportPageBounds.get()),
      );
    }
    if (shiftKey) point = snapToDominantAxis(point, this.originPagePoint);
    return point;
  }

  /** Where a press counts as a jump rather than a grab of the viewport. */
  getAllowedJumpBounds(): Bounds {
    return allowedJumpBounds(
      this.getContentPageBounds.get(),
      boundsSize(this.getViewportPageBounds.get()),
    );
  }

  render = (): void => {
    const { ctx, elem } = this;
    const screen = this.getScreenSize();
    const dpr = this.dpr.get();
    const zoom = this.getZoom.get();
    const page = this.getCanvasPageBounds.get();
    if (!(screen.width > 0 && screen.height > 0 && zoom > 0)) return;

    const width = Math.max(1, Math.floor(screen.width * dpr));
    const height = Math.max(1, Math.floor(screen.height * dpr));
    // Assigning either dimension discards the raster and resets the transform,
    // so it is gated rather than done every frame.
    if (elem.width !== width || elem.height !== height) {
      elem.width = width;
      elem.height = height;
    }

    ctx.resetTransform();
    ctx.fillStyle = this.colors.ground;
    ctx.fillRect(0, 0, width, height);

    // From here on every coordinate is a world coordinate.
    ctx.scale(dpr * zoom, dpr * zoom);
    ctx.translate(-page.minX, -page.minY);

    const paths = this.getShapePaths.get();
    ctx.fillStyle = this.colors.shape;
    ctx.fill(paths.shapes);
    ctx.fillStyle = this.colors.selected;
    ctx.fill(paths.selected);

    const vp = this.getViewportPageBounds.get();
    const vpSize = boundsSize(vp);
    const radius = viewportRadius(vpSize, zoom);
    ctx.beginPath();
    if (radius === null) {
      ctx.rect(vp.minX, vp.minY, vpSize.width, vpSize.height);
    } else {
      ctx.roundRect(vp.minX, vp.minY, vpSize.width, vpSize.height, radius);
    }
    ctx.fillStyle = this.colors.viewport;
    ctx.fill();
    // Drawn, not just tinted. The shape extents behind it fill as one path and
    // flatten to a slab, so a tint alone leaves nothing to aim at; the outline
    // is what makes the rectangle a handle. One device pixel at any zoom.
    ctx.lineWidth = 1 / (dpr * zoom);
    ctx.strokeStyle = this.colors.viewportBorder;
    ctx.stroke();

    const dotRadius = CURSOR_DOT_SCREEN_RADIUS / zoom;
    for (const dot of this.getCursorDots.get()) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dotRadius, 0, PI2);
      ctx.fillStyle = dot.color;
      ctx.fill();
    }
  };
}
