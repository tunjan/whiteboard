import type { Shape } from '@whiteboard/shared';

export interface DocumentChanges {
  shapes: ReadonlyMap<string, Shape>;
  /** null is a full reset (page switch, load, or geometry metric change). */
  ids: ReadonlySet<string> | null;
  contentIds?: ReadonlySet<string> | null;
}
const listeners = new Set<(change: DocumentChanges) => void>();
export function subscribeDocumentChanges(
  listener: (change: DocumentChanges) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function publishDocumentChanges(change: DocumentChanges) {
  for (const listener of listeners) listener(change);
}
