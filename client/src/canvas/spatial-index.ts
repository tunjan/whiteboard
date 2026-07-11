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

  insert(id: string, bounds: Bounds): void {
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
