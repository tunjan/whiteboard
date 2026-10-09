import { create } from 'zustand';
import { setLocalErasing } from '@/collab/presence';

interface EraserStore {
  /**
   * Every shape currently pending erasure — this client's queue plus every
   * peer's (keys present = queued). What the renderers fade.
   */
  marked: Record<string, true>;
  /** This client's own queue. */
  local: Record<string, true>;
  /** Union of the queues collaborators are holding mid-stroke. */
  remote: Record<string, true>;
  isMarked: (id: string) => boolean;
  /** Replace the local queue with `ids` (cheap no-op when the set is unchanged). */
  set: (ids: string[]) => void;
  clear: () => void;
  /** Replace the peers' union (cheap no-op when the set is unchanged). */
  setRemote: (ids: string[]) => void;
}

function sameKeys(ids: string[], prev: Record<string, true>): boolean {
  return (
    ids.length === Object.keys(prev).length && ids.every((id) => prev[id])
  );
}

function toRecord(ids: Iterable<string>): Record<string, true> {
  const out: Record<string, true> = {};
  for (const id of ids) out[id] = true;
  return out;
}

function union(
  a: Record<string, true>,
  b: Record<string, true>,
): Record<string, true> {
  if (Object.keys(b).length === 0) return a;
  if (Object.keys(a).length === 0) return b;
  return { ...a, ...b };
}

/**
 * Transient highlight state for the eraser's two-phase delete. While a stroke
 * is in progress, touched shapes are *marked* (rendered faded) rather than
 * deleted; the eraser tool commits the whole queue in one batch on pointer up,
 * or clears it on cancel. Not part of the CRDT — the queue is pending intent,
 * not a document change, and resets the instant the stroke ends.
 *
 * The local queue is mirrored through awareness so collaborators fade the same
 * shapes until the eraser releases; their queues arrive back as `remote`.
 */
export const useEraserStore = create<EraserStore>((set, get) => ({
  marked: {},
  local: {},
  remote: {},
  isMarked: (id) => !!get().marked[id],
  set: (ids) => {
    // Skip the state update (and the resulting re-renders) when nothing changed.
    if (sameKeys(ids, get().local)) return;
    const local = toRecord(ids);
    set({ local, marked: union(local, get().remote) });
    setLocalErasing(ids);
  },
  clear: () => {
    if (Object.keys(get().local).length === 0) return;
    set({ local: {}, marked: get().remote });
    setLocalErasing([]);
  },
  setRemote: (ids) => {
    if (sameKeys(ids, get().remote)) return;
    const remote = toRecord(ids);
    set({ remote, marked: union(get().local, remote) });
  },
}));
