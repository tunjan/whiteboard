import RBush from 'rbush';
import { type Bounds, unionBounds } from './geometry';

interface IndexItem extends Bounds {
  id: string;
}

/**
 * Thin wrapper over an R-tree (rbush) keyed by shape id. This is the baseline
 * for viewport culling (only mount shapes intersecting the viewport) and
 * zoom-to-fit. Shapes register their world bounds here from Phase 6 on.
 */
export class SpatialIndex {
  private tree = new RBush<IndexItem>();
  private byId = new Map<string, IndexItem>();

  /**
   * Index `id` at `bounds`, replacing any previous entry.
   *
   * Re-indexing is skipped when the bounds are unchanged. Callers re-`insert`
   * every shape touched by a mutation, but most mutations are not spatial — a
   * recolour, a z-reorder, a style or text change all leave the AABB identical.
   * Those used to pay an R-tree `remove` (which searches the tree for the item)
   * plus a re-`insert`, per shape, per frame. Comparing four numbers first makes
   * the non-spatial case free.
   */
  insert(id: string, bounds: Bounds): void {
    const existing = this.byId.get(id);
    if (
      existing &&
      existing.minX === bounds.minX &&
      existing.minY === bounds.minY &&
      existing.maxX === bounds.maxX &&
      existing.maxY === bounds.maxY
    ) {
      return;
    }
    this.remove(id);
    const item: IndexItem = { ...bounds, id };
    this.tree.insert(item);
    this.byId.set(id, item);
  }

  remove(id: string): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.tree.remove(existing, (a, b) => a.id === b.id);
    this.byId.delete(id);
  }

  /**
   * Replace the whole index in one bulk load.
   *
   * rbush's `load` builds the tree bottom-up (OMT/STR packing) instead of
   * descending and splitting once per item, so a page-sized rebuild is one
   * linear pass rather than n insertions — and the resulting tree is better
   * packed, which makes every later `search` cheaper too. Used wherever the
   * index is rebuilt wholesale: loading a page, or re-deriving it after the
   * real web fonts change text metrics.
   */
  loadAll(items: readonly IndexItem[]): void {
    this.tree.clear();
    this.byId.clear();
    // rbush keeps the item objects it is given, and `getBounds` hands them out
    // as the live entry, so copy rather than alias the caller's array contents.
    const owned = items.map((item) => ({ ...item }));
    this.tree.load(owned);
    for (const item of owned) this.byId.set(item.id, item);
  }

  /**
   * Take over `other`'s contents, leaving it empty.
   *
   * Swapping the internals is how an inactive page's index is parked and later
   * brought back without rebuilding it: constant time, and the identity of this
   * object survives, which matters because it is imported directly by tools,
   * snapping and the Canvas.
   */
  adopt(other: SpatialIndex): void {
    this.tree = other.tree;
    this.byId = other.byId;
    other.tree = new RBush<IndexItem>();
    other.byId = new Map<string, IndexItem>();
  }

  clear(): void {
    this.tree.clear();
    this.byId.clear();
  }

  /** Ids whose bounds intersect the query rectangle. */
  search(bounds: Bounds): string[] {
    return this.tree.search(bounds).map((i) => i.id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The stored world bounds for a shape, or undefined if not indexed. Callers
   *  must treat the result as read-only (it is the live tree item). */
  getBounds(id: string): Bounds | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /** Union of every item's bounds, or null when the index is empty. */
  totalBounds(): Bounds | null {
    let acc: Bounds | null = null;
    for (const item of this.byId.values()) {
      acc = acc
        ? unionBounds(acc, item)
        : { minX: item.minX, minY: item.minY, maxX: item.maxX, maxY: item.maxY };
    }
    return acc;
  }
}
