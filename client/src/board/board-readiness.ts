/**
 * When a board has finished joining.
 *
 * Joining is a handshake with four independent answers — the local cache has
 * replayed, the server has sent the board document, the page restore has picked
 * a page, and that page's own document has arrived — and until all four are in,
 * an empty canvas only means "nothing has landed yet". Kept pure and separate
 * from the store so the decision is testable on its own.
 */

/** Last line of defence: show the board regardless. Long enough not to cut a
 *  slow-but-working sync short, short enough that a dead server is not a hang. */
export const BOARD_READY_DEADLINE_MS = 5_000;

export interface BoardReadinessInputs {
  /** The local cache (IndexedDB) has replayed everything it holds. */
  localSynced: boolean;
  /** The server has sent the board document's initial state. */
  remoteSynced: boolean;
  /** Page restore has resolved: the open page will not change on its own. */
  pageSettled: boolean;
  /** The open page's own document has synced from every source it has. */
  pageSynced: boolean;
  /** The connection gave up. Whatever is cached locally is all there is. */
  offline: boolean;
  deadlinePassed: boolean;
}

/** The first source still outstanding — what the veil's progress rule shows. */
export type BoardLoadStage = 'local' | 'remote' | 'page' | 'ready';

export function isBoardReady(i: BoardReadinessInputs): boolean {
  if (i.deadlinePassed) return true;
  // The local cache is the fastest source and the only one that holds content
  // offline, so nothing lifts the veil before it.
  if (!i.localSynced) return false;
  // Deliberately not waiting on `pageSettled` here: the restore is gated on the
  // provider having synced, which never happens with no server to sync from, so
  // waiting for it offline would hold the veil up forever.
  if (i.offline) return true;
  return i.remoteSynced && i.pageSettled && i.pageSynced;
}

export function boardLoadStage(i: BoardReadinessInputs): BoardLoadStage {
  if (isBoardReady(i)) return 'ready';
  if (!i.localSynced) return 'local';
  if (!i.remoteSynced) return 'remote';
  return 'page';
}

/** How far along the veil's rule reads. The stops are spaced by how long each
 *  stage typically takes, not evenly, so the rule moves at a plausible pace. */
export function boardLoadProgress(stage: BoardLoadStage): number {
  switch (stage) {
    case 'local':
      return 0.22;
    case 'remote':
      return 0.58;
    case 'page':
      return 0.84;
    case 'ready':
      return 1;
  }
}
