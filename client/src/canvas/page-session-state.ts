const SNAPSHOT_VERSION = 1;
const STORAGE_PREFIX = 'whiteboard:page-session';
const TAB_ID_KEY = `${STORAGE_PREFIX}:tab-id`;

interface PageSessionSnapshotV1 {
  version: 1;
  currentPageId: string;
}

let memoryTabId: string | null = null;

function getTabId(): string {
  if (memoryTabId) return memoryTabId;
  try {
    const stored = sessionStorage.getItem(TAB_ID_KEY);
    if (stored) {
      memoryTabId = stored;
      return stored;
    }
  } catch {
    // The in-memory id below still isolates this running tab when storage is blocked.
  }

  memoryTabId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    sessionStorage.setItem(TAB_ID_KEY, memoryTabId);
  } catch {
    // Session persistence is optional; the board remains fully usable without it.
  }
  return memoryTabId;
}

function tabStorageKey(boardId: string): string {
  return `${STORAGE_PREFIX}:${boardId}:tab:${getTabId()}`;
}

function latestStorageKey(boardId: string): string {
  return `${STORAGE_PREFIX}:${boardId}:latest`;
}

function parseSnapshot(raw: string | null): PageSessionSnapshotV1 | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PageSessionSnapshotV1> | null;
    return value?.version === SNAPSHOT_VERSION &&
      typeof value.currentPageId === 'string' &&
      value.currentPageId.length > 0
      ? { version: SNAPSHOT_VERSION, currentPageId: value.currentPageId }
      : null;
  } catch {
    return null;
  }
}

/** Read this tab's snapshot first, then the board's latest snapshot for a new tab. */
export function readPageSession(boardId: string): string | null {
  try {
    const snapshot =
      parseSnapshot(localStorage.getItem(tabStorageKey(boardId))) ??
      parseSnapshot(localStorage.getItem(latestStorageKey(boardId)));
    return snapshot?.currentPageId ?? null;
  } catch {
    return null;
  }
}

/** Persist locally only: collaboration never shares or mutates this pointer. */
export function writePageSession(boardId: string, currentPageId: string): void {
  const snapshot: PageSessionSnapshotV1 = {
    version: SNAPSHOT_VERSION,
    currentPageId,
  };
  const raw = JSON.stringify(snapshot);
  try {
    localStorage.setItem(tabStorageKey(boardId), raw);
    localStorage.setItem(latestStorageKey(boardId), raw);
  } catch {
    // A blocked/full storage area must not prevent page navigation.
  }
}
