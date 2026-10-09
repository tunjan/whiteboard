import { atom, type Atom } from '@tldraw/state';
import type { Shape } from '@whiteboard/shared';

/**
 * The published shapes of the current page: one atom per shape, plus the
 * z-sorted list. This is the only reactive copy of the document — the scene's
 * nodes read these atoms rather than mirroring them, and React reads them
 * through `use-shapes.ts` rather than through a zustand snapshot.
 *
 * It is written once per publish (`rebuildSnapshot`), not on every Yjs update.
 * The document store's `shapeCache` runs ahead of it on purpose: the local live
 * stroke is never published mid-gesture, and a peer's edits are paced to one
 * publish per frame. Tools that need the unpublished present read
 * `editor.getShape`; anything that renders reads this.
 *
 * Atoms are never dropped. An id that is deleted and comes back (undo, a peer)
 * gets the atom every earlier reader already captured — a descendant's
 * presentation, a `useShape` hook — instead of a fresh one nobody watches.
 */
export class ShapeStore {
  private readonly atoms = new Map<string, Atom<Shape | undefined>>();
  /** The published shapes, z-sorted. Identity changes only on a publish that
   *  changed a shape. Shared, so read-only to consumers. */
  readonly sorted = atom<Shape[]>('sorted shapes', []);

  /** The atom for `id`, created empty on first ask. */
  record(id: string): Atom<Shape | undefined> {
    let record = this.atoms.get(id);
    if (!record) {
      record = atom<Shape | undefined>('shape', undefined);
      this.atoms.set(id, record);
    }
    return record;
  }

  /** The published shape, without registering a dependency. */
  peek(id: string): Shape | undefined {
    return this.atoms.get(id)?.__unsafe__getWithoutCapture();
  }

  /** Every published shape by id. O(n): for mounting a renderer, not per frame. */
  snapshot(): Map<string, Shape> {
    const out = new Map<string, Shape>();
    for (const [id, record] of this.atoms) {
      const shape = record.__unsafe__getWithoutCapture();
      if (shape) out.set(id, shape);
    }
    return out;
  }

  /**
   * Write `ids` from `source` — every id either side knows when `ids` is null —
   * and return what each written id held before, for consumers that diff.
   * Callers wrap this in a `transact` with whatever reads the result.
   */
  publish(
    source: ReadonlyMap<string, Shape>,
    ids: ReadonlySet<string> | null,
    sorted?: Shape[],
  ): Map<string, Shape | undefined> {
    const previous = new Map<string, Shape | undefined>();
    const write = (id: string) => {
      if (previous.has(id)) return;
      const record = this.record(id);
      previous.set(id, record.__unsafe__getWithoutCapture());
      record.set(source.get(id));
    };
    if (ids) for (const id of ids) write(id);
    else {
      for (const id of this.atoms.keys()) write(id);
      for (const id of source.keys()) write(id);
    }
    if (sorted) this.sorted.set(sorted);
    return previous;
  }
}

/** The board's one shape store. Page switches republish it wholesale. */
export const shapeStore = new ShapeStore();
