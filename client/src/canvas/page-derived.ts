import * as Y from 'yjs';
import { readShapeBase, type Shape } from '@whiteboard/shared';
import { BindingGraph } from './binding-graph';
import { compareShapeOrder } from './engine/paint-order';
import type { Bounds } from './geometry';
import { shapeRotatedBounds } from './shape-bounds';
import { readGraphExpressions } from './shapes/graph-storage';
import { readPoints } from './shapes/ink-points';
import { shapeRegistry } from './shapes/shape-registry';
import { SpatialIndex } from './spatial-index';

// Everything derived from one page's `shapes` map: the decoded shapes, their
// z-sorted order, the spatial index, the binding graph and the two counts the
// Canvas gates its hierarchy and equation walks on. One object, so loading a
// board, re-deriving a page, and parking or restoring one are each a single
// call rather than a list of fields every caller has to keep complete.
//
// What is deliberately not here: when a change is applied (the store's observer
// decides, and paces peers' edits) and what has been published to React (the
// store's pending dirty sets). This module only answers "what does the page's
// document say right now, for the ids I was told about".

export type YShape = Y.Map<unknown>;

/**
 * The shape `m` stores, or null for a map without a packed base — one written
 * before the format change and not yet rewritten (`npm run migrate:shapes`), as
 * a stale local cache can hold until the server's copy syncs in.
 */
export function yToShape(m: YShape): Shape | null {
  const base = readShapeBase(m);
  if (!base) return null;
  const type = base.type;
  const storedProps =
    (m.get('props') as Record<string, unknown> | undefined) ?? {};
  const props =
    type === 'text'
      ? {
          ...storedProps,
          text:
            m.get('text') instanceof Y.Text
              ? (m.get('text') as Y.Text).toString()
              : typeof storedProps.text === 'string'
                ? storedProps.text
                : '',
        }
      : type === 'draw'
        ? // Shared and grown in place as the stroke does, like `getShapes()`'s
          // sorted view — read it, don't mutate or retain it. Copying here would
          // put back the per-frame O(n) decode that made drawing quadratic.
          { ...storedProps, points: readPoints(m) }
        : type === 'graph'
          ? {
              ...storedProps,
              expressions: readGraphExpressions(m, storedProps),
            }
          : storedProps;
  return { ...base, props } as Shape;
}

/**
 * The shape ids one batch of deep-observer events touched, added to `touched`.
 *
 * `content`, when given, also collects the ids whose *content* changed rather
 * than only their placement: nested text/ink/graph sequences can mutate a
 * retained array in place, so actual content diffs are captured rather than
 * treating every drag as content.
 */
export function collectTouchedShapeIds(
  events: Y.YEvent<Y.AbstractType<unknown>>[],
  shapes: Y.Map<YShape>,
  touched: Set<string>,
  content?: Set<string>,
): void {
  for (const e of events) {
    if (e.target === shapes) {
      for (const key of e.keys.keys()) touched.add(key);
    } else if (typeof e.path[0] === 'string') {
      touched.add(e.path[0]);
      if (
        content &&
        (e.path.length > 1 ||
          [...e.keys.keys()].some(
            (key) =>
              key === 'props' ||
              key === 'text' ||
              key === 'points' ||
              key === 'expressions',
          ))
      ) {
        content.add(e.path[0]);
      }
    }
  }
}

/** Where `shape` sits, or belongs, in z-sorted `sorted`. */
function sortedSlot(sorted: Shape[], shape: Shape): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareShapeOrder(sorted[mid]!, shape) < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Past this many shapes entering or leaving the order in one batch — a paste,
// an undo of one — a fresh sort beats splicing them in one at a time.
const MAX_SORTED_SPLICES = 32;

/**
 * `sorted` after one batch, or null when a fresh sort is the cheaper way there.
 * Always a new array: its identity is how the store's readers see a change.
 * Each shape is found by binary search on its (index, id) key, so a drag frame
 * costs a lookup per moved shape and a new stroke costs one splice, not a
 * re-sort of the page. `leaving` holds the previous versions of shapes removed
 * or re-indexed; `entering` their replacements and new shapes.
 */
function nextSorted(
  sorted: Shape[],
  updated: Shape[],
  leaving: Shape[],
  entering: Shape[],
): Shape[] | null {
  if (leaving.length + entering.length > MAX_SORTED_SPLICES) return null;
  const next = sorted.slice();
  for (const shape of updated) {
    const i = sortedSlot(next, shape);
    if (next[i]?.id !== shape.id) return null;
    next[i] = shape;
  }
  for (const shape of leaving) {
    const i = sortedSlot(next, shape);
    if (next[i]?.id !== shape.id) return null;
    next.splice(i, 1);
  }
  for (const shape of entering) next.splice(sortedSlot(next, shape), 0, shape);
  return next;
}

/** World bounds to index `shape` at, or null for one that stays out of the index. */
function indexBounds(shape: Shape): Bounds | null {
  // Groups have no geometry of their own — keep them out of the index.
  if (shape.type === 'group' || !shapeRegistry.getFor(shape)) return null;
  return shapeRotatedBounds(shape);
}

export class PageDerivedState {
  // Reassigned (not cleared) by `adopt`, so a page left behind keeps its own
  // map to come back to — and so the map's identity tells a reader which page
  // it last saw.
  private cache = new Map<string, Shape>();
  // Lazily-built, z-sorted view of `cache` for `editor.getShapes()`. It stays
  // in sync with `cache` (invalidated wherever it mutates), so reads avoid
  // re-deserializing the whole Yjs map and re-sorting on every call — tools hit
  // this many times per pointer event. The array is shared; callers treat it as
  // read-only (none mutate it in place).
  private sorted: Shape[] | null = null;
  // How many shapes on the page make the Canvas's per-frame hierarchy and
  // equation derivations worth running at all. Maintained here beside the
  // spatial and binding indexes, for the same reason they are: a stroke
  // publishes a new `shapes` array every frame, and on a page with no parented
  // shape the walks that rebuild `childrenByParent`/`frameAncestorIds` produce
  // two empty collections at O(page) cost per frame. Almost every real page is
  // that page.
  private parented = 0;
  private equations = 0;

  /**
   * The active page's state is built on the two exported singletons, which
   * tools, snapping and the Canvas import directly; a parked page's gets its
   * own.
   */
  constructor(
    readonly index: SpatialIndex = new SpatialIndex(),
    readonly bindings: BindingGraph = new BindingGraph(),
  ) {}

  get shapes(): ReadonlyMap<string, Shape> {
    return this.cache;
  }

  get hasHierarchy(): boolean {
    return this.parented > 0;
  }

  get hasEquations(): boolean {
    return this.equations > 0;
  }

  /** The page's shapes, z-sorted. One shared array for `getShapes()` and the
   *  store snapshot, so consumers never re-sort the document themselves. */
  sortedShapes(): Shape[] {
    this.sorted ??= [...this.cache.values()].sort(compareShapeOrder);
    return this.sorted;
  }

  clear(): void {
    this.cache.clear();
    this.sorted = null;
    this.index.clear();
    this.bindings.clear();
    this.parented = 0;
    this.equations = 0;
  }

  /** Derive the whole page from `source`, discarding what was here. */
  rebuild(source: Y.Map<YShape>): void {
    this.clear();
    // Collected and handed to the R-tree in one bulk load rather than inserted
    // one by one: the tree is built in a single packing pass instead of n
    // descend-and-split insertions, and comes out better balanced for every
    // later query.
    const bounds: (Bounds & { id: string })[] = [];
    for (const [id, m] of source) {
      const shape = yToShape(m);
      if (!shape) continue;
      this.cache.set(id, shape);
      const b = indexBounds(shape);
      if (b) bounds.push({ ...b, id });
      this.track(shape, undefined);
    }
    this.index.loadAll(bounds);
  }

  /**
   * Re-derive `ids` from `source`. Returns the shapes that left the page, for
   * the caller to fade or not.
   */
  patch(source: Y.Map<YShape>, ids: Iterable<string>): Shape[] {
    const removed: Shape[] = [];
    // A stroke or drag mutates a shape's props/position but never its z-`index`,
    // so most entries keep their slot in the sorted array. Only shapes added,
    // removed or re-indexed have to move — see `nextSorted`.
    const updated: Shape[] = [];
    const leaving: Shape[] = [];
    const entering: Shape[] = [];
    for (const id of ids) {
      const m = source.get(id);
      const shape = m ? yToShape(m) : null;
      const prev = this.cache.get(id);
      if (shape) {
        this.cache.set(id, shape);
        const b = indexBounds(shape);
        if (b) this.index.insert(id, b);
        this.track(shape, prev);
        if (prev && prev.index === shape.index) updated.push(shape);
        else {
          if (prev) leaving.push(prev);
          entering.push(shape);
        }
      } else {
        if (prev) {
          removed.push(prev);
          leaving.push(prev);
        }
        if (prev?.parentId) this.parented--;
        if (prev?.type === 'equation') this.equations--;
        this.cache.delete(id);
        this.index.remove(id);
        this.bindings.remove(id);
      }
    }
    if (this.sorted)
      this.sorted = nextSorted(this.sorted, updated, leaving, entering);
    return removed;
  }

  /**
   * Whether re-deriving `dirtyCount` shapes one by one is still the cheaper way
   * to catch up. Past this share of the page, one bulk re-derivation beats
   * patching shape by shape: the R-tree is packed in a single pass instead of
   * n insertions.
   */
  canPatch(dirtyCount: number): boolean {
    return dirtyCount <= this.cache.size / 4;
  }

  /**
   * Take over `other`'s contents, leaving it empty. Constant time, and the
   * identity of this object's index and binding graph survives — see
   * {@link SpatialIndex.adopt}.
   */
  adopt(other: PageDerivedState): void {
    this.cache = other.cache;
    this.sorted = other.sorted;
    this.parented = other.parented;
    this.equations = other.equations;
    this.index.adopt(other.index);
    this.bindings.adopt(other.bindings);
    other.cache = new Map();
    other.sorted = null;
    other.parented = 0;
    other.equations = 0;
  }

  /** Fold one decoded shape into the binding graph and the counts. */
  private track(shape: Shape, prev: Shape | undefined): void {
    this.bindings.update(shape);
    this.parented += (shape.parentId ? 1 : 0) - (prev?.parentId ? 1 : 0);
    this.equations +=
      (shape.type === 'equation' ? 1 : 0) - (prev?.type === 'equation' ? 1 : 0);
  }
}
