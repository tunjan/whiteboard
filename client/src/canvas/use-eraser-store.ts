import { create } from 'zustand';
import { setLocalErasing } from '@/collab/presence';

interface EraserStore {
  /** Shapes in the current erase stroke's pending queue (keys present = queued). */
  marked: Record<string, true>;
  isMarked: (id: string) => boolean;
  /** Replace the queue with `ids` (cheap no-op when the set is unchanged). */
  set: (ids: string[]) => void;
  clear: () => void;
}

/**
 * Local, transient highlight state for the eraser's two-phase delete. While a
 * stroke is in progress, touched shapes are *marked* (rendered faded) rather
 * than deleted; the eraser tool commits the whole queue in one batch on pointer
 * up, or clears it on cancel. Not part of the CRDT — the queue is one client's
 * pending intent, not a document change, and resets the instant the stroke ends.
 *
 * It is mirrored to peers through awareness (`setLocalErasing`) so a shape about
 * to be deleted fades on *everyone's* screen while the stroke is held, the same
 * way selections and laser strokes are shared. Peers see the fade resolve into
 * a deletion, rather than watching shapes disappear with no warning.
 */
export const useEraserStore = create<EraserStore>((set, get) => ({
  marked: {},
  isMarked: (id) => !!get().marked[id],
  set: (ids) => {
    const prev = get().marked;
    // Skip the state update (and the resulting re-renders) when nothing changed.
    if (ids.length === Object.keys(prev).length && ids.every((id) => prev[id])) {
      return;
    }
    const next: Record<string, true> = {};
    for (const id of ids) next[id] = true;
    set({ marked: next });
    setLocalErasing(ids);
  },
  clear: () => {
    if (Object.keys(get().marked).length === 0) return;
    set({ marked: {} });
    setLocalErasing([]);
  },
}));
