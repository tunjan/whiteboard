import { create } from 'zustand';
import type { Shape } from '@whiteboard/shared';

/** Must match the `shape-vanish` keyframe duration in index.css. */
export const VANISH_MS = 100;

/**
 * Past this many shapes in one delete (select-all, clearing a page) the fade is
 * skipped and the shapes just go. Re-mounting a page's worth of shape elements
 * into the ghost layer costs a full render of everything that was deleted, and
 * a mass delete reads as deliberate without the animation.
 */
const MAX_VANISH = 200;

export interface Ghost {
  /** Fresh per vanish, so re-deleting the same id restarts the fade. */
  key: string;
  shape: Shape;
  /** Resolved opacity at the moment of deletion; the fade starts from it. */
  opacity: number;
}

interface VanishStore {
  /** Shapes deleted in the last {@link VANISH_MS} ms, still being faded out. */
  ghosts: readonly Ghost[];
}

/**
 * Snapshots of just-deleted shapes, kept on screen only long enough to fade.
 *
 * The copies live outside the document on purpose: the delete has already
 * landed in the CRDT, so a ghost must not be hit-testable, selectable, indexed,
 * exported, or visible to peers — it is a local afterimage of a shape that is
 * gone. `VanishLayer` draws them; entries drop out on a timer.
 */
export const useVanishStore = create<VanishStore>(() => ({ ghosts: [] }));

let seq = 0;

/** Hold `entries` on screen for one fade. */
export function vanishShapes(
  entries: { shape: Shape; opacity: number }[],
): void {
  if (entries.length === 0 || entries.length > MAX_VANISH) return;
  const ghosts = entries.map((e) => ({ key: `${e.shape.id}:${++seq}`, ...e }));
  const ids = new Set(entries.map((e) => e.shape.id));
  useVanishStore.setState((s) => ({
    // A shape deleted, restored by undo and deleted again drops its in-flight
    // ghost instead of fading twice from two different states at once.
    ghosts: [...s.ghosts.filter((g) => !ids.has(g.shape.id)), ...ghosts],
  }));
  const keys = new Set(ghosts.map((g) => g.key));
  setTimeout(() => {
    useVanishStore.setState((s) => {
      const next = s.ghosts.filter((g) => !keys.has(g.key));
      return next.length === s.ghosts.length ? s : { ghosts: next };
    });
  }, VANISH_MS);
}

/** Drop every ghost at once — the page they belonged to is no longer on screen. */
export function clearVanishing(): void {
  if (useVanishStore.getState().ghosts.length === 0) return;
  useVanishStore.setState({ ghosts: [] });
}
