import { atom, computed, transact, type Atom } from '@tldraw/state';
import { pointsBounds, type Shape, type Point } from '@whiteboard/shared';
import type { Camera } from '../camera';
import { DEFAULT_CAMERA } from '../camera';
import { quantizedCullRegion } from '../geometry';
import { framePolygon } from '../frame-geometry';
import { resolveOpacity } from '../opacity';
import { shapeRegistry } from '../shapes/shape-registry';
import { arrowPoints, curvePoints } from '../shapes/line-geometry';
import type { SpatialIndex } from '../spatial-index';
import { ShapeStore } from './shape-store';
import { groupByParent, paintOrderOf } from './paint-order';
import { intersectConvexPolygons, polygonCss } from './clipping';
import {
  inverse,
  matrixCss,
  rotationAt,
  transformPoint,
  type Matrix,
} from './matrix';

function shallowEqual(a: object, b: object) {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof typeof a)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

function setEqual(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** Whether a record's spatial footprint could have changed. Reordering,
 * reparenting, opacity and hiding cannot move a shape, so they must not re-cut
 * the cull — `visible` is a single observer over the whole page. */
function moved(a: Shape | undefined, b: Shape | undefined): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  return (
    a.x !== b.x ||
    a.y !== b.y ||
    a.rotation !== b.rotation ||
    !shallowEqual(a.props, b.props)
  );
}

type RenderShape = Shape & { contentRevision: number };

export function contentEqual(
  a: RenderShape | undefined,
  b: RenderShape | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.type === b.type &&
      a.contentRevision === b.contentRevision &&
      shallowEqual(a.props, b.props))
  );
}

/** Existing documents store PAGE coordinates and rotate around geometry centers.
 * Keep that contract at the renderer boundary; parenting must not apply a second
 * transform to coordinates the tools have already moved with their parent. */
function shapeCenter(shape: Shape): Point {
  let bounds;
  if (shape.type === 'draw') bounds = pointsBounds(shape.props.points);
  else if (shape.type === 'arrow')
    bounds = pointsBounds(
      arrowPoints(
        shape.props.points,
        shape.props.topology ??
          (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight'),
        shape.props.bend ?? 0,
      ),
    );
  else if (shape.type === 'line')
    bounds = pointsBounds(
      curvePoints(
        shape.props.points,
        shape.props.bend ?? 0,
        shape.props.spline ?? 'linear',
      ),
    );
  else {
    const b = shapeRegistry.getFor(shape)?.getBounds(shape);
    bounds = b
      ? {
          minX: b.minX - shape.x,
          minY: b.minY - shape.y,
          maxX: b.maxX - shape.x,
          maxY: b.maxY - shape.y,
        }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function shapeMatrix(shape: Shape): Matrix {
  if (!shape.rotation) return [1, 0, 0, 1, shape.x, shape.y];
  const center = shapeCenter(shape);
  return rotationAt(shape.x, shape.y, shape.rotation, center.x, center.y);
}

export interface SceneUi {
  hidden: Record<string, boolean>;
  erasing: Record<string, boolean>;
  suppressed: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
}
const EMPTY_UI: SceneUi = {
  hidden: {},
  erasing: {},
  suppressed: new Set(),
  pinned: new Set(),
};

/**
 * What a shape inherits from the frames and groups above it: whether an
 * ancestor hides it, and the page-space polygon its frames clip it to.
 *
 * Both renderers need this and neither can afford a second ancestor walk to get
 * it — the DOM layer turns the mask into a CSS `clip-path` in the shape's own
 * coordinates, the Canvas2D one clips the context with it in page space.
 *
 * `null` means no mask; `[]` means fully clipped, and must never be read as an
 * absent one.
 */
export function ancestorState(
  shape: Shape,
  getShape: (id: string) => Shape | undefined,
  hiddenIds: Record<string, boolean>,
): { hidden: boolean; mask: Point[] | null } {
  let mask: Point[] | null = null;
  let hidden = !!hiddenIds[shape.id] || !!shape.hidden;
  const seen = new Set([shape.id]);
  let parentId = shape.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = getShape(parentId);
    if (!parent) break;
    hidden ||= !!hiddenIds[parent.id] || !!parent.hidden;
    // Existing connectors deliberately escape frame masks.
    if (parent.type === 'frame' && shape.type !== 'arrow') {
      const polygon = framePolygon(parent);
      mask = mask === null ? polygon : intersectConvexPolygons(mask, polygon);
    }
    parentId = parent.parentId;
  }
  return { hidden, mask };
}

/**
 * Every shape has a node (sync writes `z` and `contentRevision` for all of
 * them), but only rendered ones read `content` and `presentation`. The
 * computeds are built on first read: ~0.65 KB a shape that a 12k-stroke page
 * would otherwise hold for strokes nobody has looked at.
 */
export class SceneNode {
  readonly shape: Atom<Shape | undefined>;
  readonly z = atom('shape z', 0);
  readonly contentRevision = atom('content revision', 0);
  private contentSignal?: ReturnType<SceneNode['buildContent']>;
  private presentationSignal?: ReturnType<SceneNode['buildPresentation']>;
  constructor(
    readonly scene: CanvasScene,
    readonly id: string,
  ) {
    // The store's own atom — the scene holds no copy of the document.
    this.shape = scene.store.record(id);
  }

  get content() {
    return (this.contentSignal ??= this.buildContent());
  }

  get presentation() {
    return (this.presentationSignal ??= this.buildPresentation());
  }

  private buildContent() {
    return computed(
      'content',
      () => {
        const s = this.shape.get();
        return s
          ? ({
              ...s,
              x: 0,
              y: 0,
              rotation: 0,
              contentRevision: this.contentRevision.get(),
            } as RenderShape)
          : undefined;
      },
      { isEqual: contentEqual },
    );
  }

  private buildPresentation() {
    const scene = this.scene;
    const center = computed(
      'center',
      () => {
        const s = this.content.get();
        return s ? shapeCenter(s) : { x: 0, y: 0 };
      },
      { isEqual: shallowEqual },
    );
    return computed(
      'presentation',
      () => {
        const s = this.shape.get();
        if (!s)
          return {
            transform: '',
            clipPath: 'none',
            opacity: '0',
            visibility: 'hidden',
          };
        const hiddenIds = scene.hidden.get();
        const erasingIds = scene.erasing.get();
        const getShape = (id: string) => scene.record(id).shape.get();
        const { hidden, mask } = ancestorState(s, getShape, hiddenIds);
        const pivot = s.rotation ? center.get() : { x: 0, y: 0 };
        const matrix = rotationAt(s.x, s.y, s.rotation, pivot.x, pivot.y);
        const inverted = mask === null ? null : inverse(matrix);
        const localMask =
          mask === null ? null : mask.map((p) => transformPoint(inverted!, p));
        return {
          transform: matrixCss(matrix),
          clipPath: polygonCss(localMask),
          opacity: String(
            resolveOpacity(s, getShape, (id) => !!erasingIds[id]),
          ),
          visibility:
            hidden || scene.suppressed.get().has(s.id) ? 'hidden' : 'visible',
        };
      },
      { isEqual: shallowEqual },
    );
  }
}

/** Per-record signals isolate content and transforms; only topology changes
 * publish a new id list. Culling has a single observer for the entire page. */
export class CanvasScene {
  private records = new Map<string, SceneNode>();
  readonly ids = atom<readonly string[]>('render ids', []);
  readonly camera = atom<Camera>('camera', DEFAULT_CAMERA);
  readonly viewport = atom('viewport', { width: 0, height: 0 });
  /** Bumped only when a shape's footprint could have changed; see `moved`. */
  readonly boundsEpoch = atom('bounds epoch', 0);
  /** Bumped by every published change, for consumers that cache a whole frame. */
  readonly documentEpoch = atom('document epoch', 0);
  private readonly children = atom(
    'scene children',
    new Map<string, string[]>(),
  );
  /** One atom per UI concern, not one `SceneUi`. `presentation` is mounted once
   * per shape and reads the first three; a combined atom made every selection
   * change invalidate every node on the page (~25ms at 10k shapes). Only
   * `pinned` is selection-driven, and only `visible` — a single observer —
   * reads it. Write through `setUi`, which holds the equality. */
  readonly hidden = atom<Record<string, boolean>>('ui hidden', EMPTY_UI.hidden);
  readonly erasing = atom<Record<string, boolean>>(
    'ui erasing',
    EMPTY_UI.erasing,
  );
  readonly suppressed = atom<ReadonlySet<string>>(
    'ui suppressed',
    EMPTY_UI.suppressed,
  );
  readonly pinned = atom<ReadonlySet<string>>('ui pinned', EMPTY_UI.pinned);
  /** Identity token for renderers that invalidate a cached frame on any UI
   * change, now that there is no single `ui` reference to compare. */
  readonly uiEpoch = atom('ui epoch', 0);
  /** Ids whose shape is highlighter ink, which renders in a second pass. */
  readonly highlightIds = atom<readonly string[]>('highlight ids', []);
  private readonly highlights = new Set<string>();
  readonly visible;

  /**
   * `store` is the document's published shapes. A scene given none owns a
   * private one and `apply` writes it — the standalone form tests use.
   */
  constructor(
    readonly index: SpatialIndex,
    readonly store: ShapeStore = new ShapeStore(),
  ) {
    const region = computed(
      'cull region',
      () => {
        const { width, height } = this.viewport.get();
        return quantizedCullRegion(this.camera.get(), width, height);
      },
      { isEqual: shallowEqual },
    );
    this.visible = computed('visible shapes', () => {
      this.boundsEpoch.get();
      const { width, height } = this.viewport.get();
      if (!width || !height) return new Set(this.ids.get());
      const ids = new Set(index.search(region.get()));
      const children = this.children.get();
      const stack = [...this.pinned.get()],
        pinned = new Set<string>();
      while (stack.length) {
        const id = stack.pop()!;
        if (pinned.has(id)) continue;
        pinned.add(id);
        ids.add(id);
        for (const child of children.get(id) ?? []) stack.push(child);
      }
      return ids;
    });
  }

  /** Publish the UI overlays, skipping the atoms whose value is unchanged so a
   * selection change does not reach `presentation`. */
  setUi(next: SceneUi): void {
    transact(() => {
      let changed = false;
      if (this.hidden.get() !== next.hidden) {
        this.hidden.set(next.hidden);
        changed = true;
      }
      if (this.erasing.get() !== next.erasing) {
        this.erasing.set(next.erasing);
        changed = true;
      }
      if (!setEqual(this.suppressed.get(), next.suppressed)) {
        this.suppressed.set(next.suppressed);
        changed = true;
      }
      if (!setEqual(this.pinned.get(), next.pinned)) {
        this.pinned.set(next.pinned);
        changed = true;
      }
      if (changed) this.uiEpoch.update((n) => n + 1);
    });
  }

  record(id: string): SceneNode {
    let node = this.records.get(id);
    if (!node) {
      node = new SceneNode(this, id);
      this.records.set(id, node);
    }
    return node;
  }

  /** Write `shapes` into this scene's store, then {@link sync} against it. */
  apply(
    shapes: ReadonlyMap<string, Shape>,
    changed: ReadonlySet<string> | null,
    contentIds?: ReadonlySet<string> | null,
  ): void {
    transact(() =>
      this.sync(
        shapes,
        changed,
        contentIds,
        this.store.publish(shapes, changed),
      ),
    );
  }

  /**
   * Bring the derived state — membership, paint order, highlight ids, epochs —
   * up to a publish the store has already taken. `previous` is what each
   * changed id held before it; the store's atoms already hold `shapes`.
   */
  sync(
    shapes: ReadonlyMap<string, Shape>,
    changed: ReadonlySet<string> | null,
    contentIds: ReadonlySet<string> | null | undefined,
    previous: ReadonlyMap<string, Shape | undefined>,
  ): void {
    transact(() => {
      const ids =
        changed ?? new Set([...this.records.keys(), ...shapes.keys()]);
      let orderChanged = changed === null;
      let parentageChanged = changed === null;
      let membershipChanged = changed === null;
      let geometryChanged = changed === null;
      let highlightsChanged = false;
      let removed = false;
      for (const id of ids) {
        const node = this.record(id);
        const prev = previous.get(id),
          next = shapes.get(id);
        membershipChanged ||= !!prev !== !!next || prev?.type !== next?.type;
        removed ||= !!prev && !next;
        if (!prev || !next || prev.parentId !== next.parentId) {
          orderChanged = true;
          parentageChanged = true;
        } else if (prev.index !== next.index) orderChanged = true;
        geometryChanged ||= moved(prev, next);
        const highlight =
          next?.type === 'draw' && next.props.inkKind === 'highlight';
        if (highlight !== this.highlights.has(id)) {
          if (highlight) this.highlights.add(id);
          else this.highlights.delete(id);
          highlightsChanged = true;
        }
        if (changed === null || contentIds?.has(id)) {
          node.contentRevision.update((n) => n + 1);
          geometryChanged = true;
        }
      }
      if (membershipChanged) {
        const nextIds = [...shapes.values()]
          .filter((s) => s.type !== 'group')
          .map((s) => s.id)
          .sort();
        const previous = this.ids.get();
        if (
          previous.length !== nextIds.length ||
          previous.some((id, i) => id !== nextIds[i])
        )
          this.ids.set(nextIds);
      }
      if (highlightsChanged) this.highlightIds.set([...this.highlights].sort());
      if (orderChanged) this.updateOrder(shapes, parentageChanged);
      // Reparenting can orphan a node retained by the rule in `prune`, and the
      // size check keeps the scan off the common path: a record exists for
      // every live shape, so an equal count means there is nothing dead.
      if ((removed || parentageChanged) && this.records.size > shapes.size)
        this.prune(shapes);
      if (geometryChanged) this.boundsEpoch.update((n) => n + 1);
      this.documentEpoch.update((n) => n + 1);
    });
  }

  private updateOrder(
    shapes: ReadonlyMap<string, Shape>,
    rebuildChildren: boolean,
  ) {
    const buckets = groupByParent(shapes);
    // Pure reorders leave parenting alone, and `children` is only the pin
    // closure's adjacency — republishing it there would re-cut the cull.
    if (rebuildChildren) {
      const children = new Map<string, string[]>();
      for (const [parent, bucket] of buckets)
        if (parent !== null)
          children.set(
            parent,
            bucket.map((s) => s.id),
          );
      this.children.set(children);
    }
    let z = 0;
    for (const shape of paintOrderOf(shapes, buckets))
      this.record(shape.id).z.set(++z);
  }

  /** Drop records for shapes that are gone. A node still named as someone's
   * parent is kept — including by a shape whose parent no longer exists, which
   * `children` resolves away: descendant `presentation` computeds capture the
   * ancestor's atom, and recreating that id (undo) would otherwise hand them a
   * node no one writes to. Runs only when something was actually removed. */
  private prune(shapes: ReadonlyMap<string, Shape>) {
    const named = new Set<string>();
    for (const shape of shapes.values())
      if (shape.parentId) named.add(shape.parentId);
    for (const [id, node] of this.records)
      if (!node.shape.get() && !named.has(id)) this.records.delete(id);
  }
}
