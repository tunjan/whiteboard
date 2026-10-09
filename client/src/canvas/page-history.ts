import * as Y from 'yjs';
import { create } from 'zustand';

// Undo history for a board, which is per page: one `Y.UndoManager` per page
// document, because history addresses the content of one document and cannot
// outlive it. This module owns the managers, which of them is the open page's,
// which pages are held resident for the sake of their history, and the one
// thing a single manager cannot express — a move between two pages.

/** Reactive availability of undo/redo for toolbar buttons. */
export const useUndoStore = create<{ canUndo: boolean; canRedo: boolean }>(
  () => ({ canUndo: false, canRedo: false }),
);

/** Mirror an UndoManager's stack depth into useUndoStore. Returns a cleanup. */
function bindUndoState(manager: Y.UndoManager): () => void {
  const sync = () =>
    useUndoStore.setState({
      canUndo: manager.undoStack.length > 0,
      canRedo: manager.redoStack.length > 0,
    });
  sync();
  manager.on('stack-item-added', sync);
  manager.on('stack-item-popped', sync);
  manager.on('stack-cleared', sync);
  return () => {
    manager.off('stack-item-added', sync);
    manager.off('stack-item-popped', sync);
    manager.off('stack-cleared', sync);
  };
}

/**
 * How many edited pages stay resident for their undo history.
 *
 * History addresses the content of one document and cannot outlive it, so a
 * page the user has edited is held in memory to keep Ctrl+Z working there.
 * Bounded, because "every page visited this session" is how a long lesson ends
 * up holding the whole board again.
 */
export const MAX_HISTORY_PAGES = 8;

/** Add (redo) or remove (undo) the target-page half of a recorded move. */
export type ReplayMove = (direction: 'undo' | 'redo') => void;

export interface PageHistoryOptions {
  /** The one transaction origin whose edits are undoable. */
  trackedOrigin: string;
  /** Hold a page's document resident / let it go. Counted, like the resident
   *  set's own pins: every `pin` here is matched by one `unpin`. */
  pin: (pageId: string) => void;
  unpin: (pageId: string) => void;
}

export class PageHistory {
  /** Per-page managers retain undo and redo stacks while their page is inactive. */
  private byPage = new Map<string, Y.UndoManager>();
  /** Pages pinned resident because their undo history is worth keeping, most
   *  recently edited last. */
  private withHistory = new Set<string>();
  /** Pages held resident by moves out of each source page, one entry per move.
   *  Undoing a move writes to its target, so the target stays for as long as
   *  the source's history does — and is let go with it. */
  private movePins = new Map<string, string[]>();
  /**
   * The far half of a cross-page move, hung off the undo entry that owns it.
   *
   * A move writes to two documents — shapes out of this page, shapes into the
   * target's — and a Yjs UndoManager only ever reverts its own. So only the
   * outgoing half is tracked, and the incoming half is recorded here against
   * the stack item it belongs to; `undo` and `redo` replay it by hand so the
   * two halves stay one step. Keyed on the stack item so that an entry dropped
   * from the stack takes its payload with it.
   */
  private moves = new WeakMap<object, ReplayMove>();
  private active: { pageId: string; manager: Y.UndoManager } | null = null;
  /** Detaches the undo-state listeners; swapped on page switch. */
  private unbind = () => {};

  constructor(private readonly options: PageHistoryOptions) {}

  /** Make `pageId` the page undo and redo act on, keeping any history it had. */
  open(pageId: string, shapes: Y.Map<Y.Map<unknown>>): void {
    this.unbind();
    let manager = this.byPage.get(pageId);
    if (!manager) {
      manager = new Y.UndoManager(shapes, {
        trackedOrigins: new Set([this.options.trackedOrigin]),
      });
      manager.on('stack-item-added', () => this.noteHistory(pageId));
      this.byPage.set(pageId, manager);
    }
    this.active = { pageId, manager };
    this.unbind = bindUndoState(manager);
  }

  /**
   * Undo one step, carrying the far half of a cross-page move with it.
   *
   * The stack item is read before the call and the payload re-hung on the redo
   * item after it, rather than listening for the manager's own events: Yjs
   * emits `stack-item-added` for the inverse entry *before* `stack-item-popped`
   * for the one being undone, so an event-driven handoff would have nothing to
   * copy yet.
   */
  undo(): void {
    const manager = this.active?.manager;
    if (!manager) return;
    const item = manager.undoStack.at(-1);
    const replay = item ? this.moves.get(item) : undefined;
    manager.undo();
    if (!replay) return;
    replay('undo');
    const inverse = manager.redoStack.at(-1);
    if (inverse) this.moves.set(inverse, replay);
  }

  redo(): void {
    const manager = this.active?.manager;
    if (!manager) return;
    const item = manager.redoStack.at(-1);
    const replay = item ? this.moves.get(item) : undefined;
    manager.redo();
    if (!replay) return;
    replay('redo');
    const inverse = manager.undoStack.at(-1);
    if (inverse) this.moves.set(inverse, replay);
  }

  /** Force the next mutation to start a new undo entry (gesture boundary). */
  breakCapture(): void {
    this.active?.manager.stopCapturing();
  }

  /**
   * Run a move of shapes off the open page into `targetPageId` as one undo
   * step. `run` writes both halves; `replay` redoes or undoes the target's.
   *
   * The target is held resident while this page's history is: undoing the move
   * here has to take the shapes back off the target, which needs its document
   * in memory. Released by `release` when that history goes.
   *
   * The two halves live in different documents, so they cannot be one
   * transaction. The bracketing `stopCapturing` calls keep the move a step of
   * its own rather than merging with an edit made moments before or after.
   */
  recordMove(targetPageId: string, run: () => void, replay: ReplayMove): void {
    if (!this.active) return;
    const { pageId, manager } = this.active;
    this.options.pin(targetPageId);
    const pinned = this.movePins.get(pageId);
    if (pinned) pinned.push(targetPageId);
    else this.movePins.set(pageId, [targetPageId]);

    manager.stopCapturing();
    const depthBefore = manager.undoStack.length;
    run();
    manager.stopCapturing();

    const item = manager.undoStack.at(-1);
    if (item && manager.undoStack.length > depthBefore) {
      this.moves.set(item, replay);
    }
  }

  /**
   * Drop a page's history because its document is leaving memory, and let go
   * of every page that history was holding resident.
   */
  release(pageId: string): void {
    this.byPage.get(pageId)?.destroy();
    this.byPage.delete(pageId);
    this.withHistory.delete(pageId);
    // Taken off the map before unpinning: letting a target go can evict it,
    // which lands back here for that page.
    const targets = this.movePins.get(pageId);
    this.movePins.delete(pageId);
    for (const target of targets ?? []) this.options.unpin(target);
  }

  destroy(): void {
    this.unbind();
    this.unbind = () => {};
    for (const manager of this.byPage.values()) manager.destroy();
    this.byPage.clear();
    this.active = null;
  }

  /** Note that `pageId` now has undo history worth keeping it resident for. */
  private noteHistory(pageId: string): void {
    const pages = this.withHistory;
    if (pages.has(pageId)) {
      // Re-insert so insertion order stays "least recently edited first".
      pages.delete(pageId);
      pages.add(pageId);
      return;
    }
    pages.add(pageId);
    this.options.pin(pageId);
    if (pages.size > MAX_HISTORY_PAGES) {
      const oldest = pages.values().next().value;
      if (oldest !== undefined) {
        pages.delete(oldest);
        this.options.unpin(oldest);
      }
    }
  }
}
