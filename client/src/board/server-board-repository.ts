import {
  type BoardMeta,
  type BoardRepository,
  genBoardId,
} from '@whiteboard/shared';
import { boardKey } from '@/board/board-access';
import { boardRoom } from '@/canvas/use-document-store';

// Postgres is authoritative; a localStorage cache + outbox keep the home screen
// usable offline. Mutations are optimistic and idempotently upserted on
// reconnect (the client mints the board id, so retries are safe).

const CACHE_KEY = 'whiteboard:boards-cache';
const OUTBOX_KEY = 'whiteboard:boards-outbox';

type OutboxOp =
  | { kind: 'upsert'; board: BoardMeta }
  | { kind: 'delete'; id: string }
  | { kind: 'opened'; id: string }
  | { kind: 'favorite'; id: string; favorite: boolean };

function loadCache(): Record<string, BoardMeta> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveCache(cache: Record<string, BoardMeta>): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}
function loadOutbox(): OutboxOp[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveOutbox(ops: OutboxOp[]): void {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
}

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/boards${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/**
 * Boards a student is connected to right now. Outside `BoardRepository` on
 * purpose: it is live server state, not board metadata, and has no offline
 * answer — an empty set is the honest one.
 */
export async function fetchLiveBoardIds(): Promise<Set<string>> {
  try {
    const res = await api('/live');
    if (res.ok) return new Set((await res.json()) as string[]);
  } catch {
    // Offline — nobody is known to be live.
  }
  return new Set();
}

export class ServerBoardRepository implements BoardRepository {
  async list(): Promise<BoardMeta[]> {
    await this.flush();
    try {
      const res = await api('');
      if (res.ok) {
        const rows = (await res.json()) as BoardMeta[];
        const cache = loadOutbox().length === 0 ? {} : loadCache();
        for (const b of rows) cache[b.id] = b;
        saveCache(cache);
      }
    } catch {
      // Offline — fall back to the cache.
    }
    return Object.values(loadCache()).sort(
      (a, b) => b.lastOpenedAt - a.lastOpenedAt,
    );
  }

  async get(id: string): Promise<BoardMeta | undefined> {
    const cached = loadCache()[id];
    if (cached) return cached;
    // A share link is the first time this browser has heard of the board, so
    // the cache — which only `list()` fills, and only for a tutor — has nothing.
    // Ask for the name alone; the rest of `BoardMeta` is management data this
    // caller has no way to know and no use for.
    try {
      const res = await api(
        `/${encodeURIComponent(id)}/title?k=${encodeURIComponent(boardKey())}`,
      );
      if (!res.ok) return undefined;
      const { name } = (await res.json()) as { name: string };
      const now = Date.now();
      return { id, name, createdAt: now, updatedAt: now, lastOpenedAt: now };
    } catch {
      return undefined; // Offline — the caller keeps its placeholder.
    }
  }

  async create(name: string): Promise<BoardMeta> {
    const now = Date.now();
    const board: BoardMeta = {
      id: genBoardId(),
      name: name.trim() || 'Untitled board',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    const cache = loadCache();
    cache[board.id] = board;
    saveCache(cache);
    this.enqueue({ kind: 'upsert', board });
    await this.flush();
    return board;
  }

  async rename(id: string, name: string): Promise<void> {
    const cache = loadCache();
    const board = cache[id];
    if (!board) return;
    board.name = name.trim() || board.name;
    board.updatedAt = Date.now();
    saveCache(cache);
    this.enqueue({ kind: 'upsert', board });
    await this.flush();
  }

  async delete(id: string): Promise<void> {
    const cache = loadCache();
    delete cache[id];
    saveCache(cache);
    this.enqueue({ kind: 'delete', id });
    indexedDB.deleteDatabase(boardRoom(id));
    await this.flush();
  }

  async markOpened(id: string): Promise<void> {
    const cache = loadCache();
    const board = cache[id];
    if (!board) return;
    board.lastOpenedAt = Date.now();
    saveCache(cache);
    this.enqueue({ kind: 'opened', id });
    await this.flush();
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    const cache = loadCache();
    const board = cache[id];
    if (!board) return;
    board.favorite = favorite;
    saveCache(cache);
    this.enqueue({ kind: 'favorite', id, favorite });
    await this.flush();
  }

  private enqueue(op: OutboxOp): void {
    const ops = loadOutbox();
    ops.push(op);
    saveOutbox(ops);
  }

  /** Replay queued mutations to the server in order (idempotent). */
  async flush(): Promise<void> {
    let ops = loadOutbox();
    while (ops.length > 0) {
      const op = ops[0]!;
      try {
        const res =
          op.kind === 'upsert'
            ? await api('', {
                method: 'POST',
                body: JSON.stringify({ id: op.board.id, name: op.board.name }),
              })
            : op.kind === 'delete'
              ? await api(`/${encodeURIComponent(op.id)}`, { method: 'DELETE' })
              : op.kind === 'favorite'
                ? await api(`/${encodeURIComponent(op.id)}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ favorite: op.favorite }),
                  })
                : await api(`/${encodeURIComponent(op.id)}/opened`, {
                    method: 'POST',
                  });
        if (res.status === 401) return; // not signed in yet — retry after login
        // Drop the op on success or any other 4xx (avoid a stuck queue).
        ops = ops.slice(1);
        saveOutbox(ops);
      } catch {
        return; // network error — retry later
      }
    }
  }
}

export const boardRepository = new ServerBoardRepository();
