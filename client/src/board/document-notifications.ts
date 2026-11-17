import type { BoardDocumentMeta } from '@whiteboard/shared';
import { useDocumentsStore } from '@/canvas/use-documents-store';
import { toast } from '@/components/ui/toast';
import { shortFileName } from '@/lib/utils';

/**
 * Announces files peers add to the board's repository, and tracks which of
 * them this user has yet to open.
 *
 * Two signals, two jobs:
 *   - A toast, once, for a file that lands while the user is on the board with
 *     the panel shut. One toast per uploader, so a folder dropped in counts up
 *     rather than stacking, and it goes as soon as the panel opens.
 *   - A dot on the Documents button and on the file's row, which persists
 *     across reloads until the user actually opens that file.
 *
 * A file is "yours" the moment you mint it (see `markOwnDocument`), so an
 * upload never notifies its own uploader.
 *
 * "Landed while you were here" is decided by `createdAt` against the moment
 * this watch started, which trusts the uploader's clock — the same trust the
 * panel already places in it when it sorts and dates the list. A badly skewed
 * peer clock can therefore misfile one arrival as backlog or vice versa; the
 * per-uploader toast keeps the second case to one toast rather than a wall.
 */

const seenStorageKey = (boardId: string) =>
  `whiteboard:documents-seen:${boardId}`;

interface Watch {
  boardId: string;
  /**
   * Files already in the repository when this user arrived are history, not
   * news — the initial sync would otherwise toast the whole backlog at once.
   */
  watchStart: number;
  /** No stored state for this board: nothing here can be "new to you" yet. */
  firstVisit: boolean;
  seen: Set<string>;
  /** Ids already toasted this session, so a re-publish can't announce twice. */
  announced: Set<string>;
  /** Files in each uploader's open toast. */
  shared: Map<string, number>;
  /** Last value written to storage, to skip no-op writes. */
  persisted: string;
}

let watch: Watch | null = null;

/** Stored seen-ids for a board, or null when the user has never opened it. */
function readSeen(boardId: string): Set<string> | null {
  const raw = localStorage.getItem(seenStorageKey(boardId));
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Persist the seen set, dropping ids the repository no longer holds so a
 * long-lived board doesn't accumulate the ids of deleted files forever.
 */
function persistSeen(documents: Record<string, BoardDocumentMeta>): void {
  if (!watch) return;
  const live = [...watch.seen].filter((id) => id in documents);
  const next = JSON.stringify(live);
  if (next === watch.persisted) return;
  watch.persisted = next;
  localStorage.setItem(seenStorageKey(watch.boardId), next);
}

const sharedToastId = (uploader: string) => `shared-files:${uploader}`;

function announce(meta: BoardDocumentMeta): void {
  if (!watch) return;
  const { shared } = watch;
  const uploader = meta.uploadedBy || 'Someone';
  const count = (shared.get(uploader) ?? 0) + 1;
  shared.set(uploader, count);
  toast.add({
    id: sharedToastId(uploader),
    title:
      count === 1
        ? `${uploader} shared a file`
        : `${uploader} shared ${count} files`,
    description: count === 1 ? shortFileName(meta.name) : undefined,
    type: 'info',
    onClose: () => shared.delete(uploader),
    actionProps: {
      children: 'View',
      onClick: () => useDocumentsStore.getState().setPanelOpen(true),
    },
  });
}

/** Recompute unread state (and toast new arrivals) from a documents snapshot. */
function sync(documents: Record<string, BoardDocumentMeta>): void {
  if (!watch) return;
  const unread = new Set<string>();

  for (const meta of Object.values(documents)) {
    const isHistory = meta.createdAt <= watch.watchStart;

    // A first visit inherits whatever the board already held: those files are
    // new to the repository, but not new to this user.
    if (isHistory && watch.firstVisit) watch.seen.add(meta.id);
    if (watch.seen.has(meta.id)) continue;

    unread.add(meta.id);

    // Only a file that lands while we're watching earns a toast. One that
    // arrived while the user was away is surfaced by the dot alone — a toast
    // for it would be stale by the time they read it.
    if (!isHistory && !watch.announced.has(meta.id)) {
      watch.announced.add(meta.id);
      // An open panel already shows it, arriving with its dot.
      if (!useDocumentsStore.getState().panelOpen) announce(meta);
    }
  }

  persistSeen(documents);
  const store = useDocumentsStore.getState();
  // Zustand compares by reference, so only swap the set when it really changed.
  if (!sameIds(store.unread, unread)) store.setUnread(unread);
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function markSeen(id: string): void {
  if (!watch || watch.seen.has(id)) return;
  watch.seen.add(id);
  sync(useDocumentsStore.getState().documents);
}

/**
 * Claim a document id as this user's own, before its metadata is published.
 * Keeps an upload from notifying the person who made it.
 */
export function markOwnDocument(id: string): void {
  markSeen(id);
}

/** Clear a document's unread dot — the user has opened it. */
export function markDocumentOpened(id: string): void {
  markSeen(id);
}

/**
 * Start watching the board's repository. Call after `loadBoard`; the returned
 * function stops the watch.
 */
export function startDocumentNotifications(boardId: string): () => void {
  const stored = readSeen(boardId);
  watch = {
    boardId,
    watchStart: Date.now(),
    firstVisit: stored === null,
    seen: stored ?? new Set(),
    announced: new Set(),
    shared: new Map(),
    persisted: '',
  };

  const unsubscribe = useDocumentsStore.subscribe((state, previous) => {
    if (state.documents !== previous.documents) sync(state.documents);
    if (state.panelOpen && !previous.panelOpen && watch) {
      for (const uploader of watch.shared.keys()) {
        toast.close(sharedToastId(uploader));
      }
    }
  });
  sync(useDocumentsStore.getState().documents);

  return () => {
    unsubscribe();
    watch = null;
  };
}
