import {
  type BoardMeta,
  type BoardRepository,
  genBoardId,
} from '@whiteboard/shared';
import { boardRoom } from '@/canvas/use-document-store';

// Postgres is authoritative; a localStorage cache + outbox keep the home screen
// usable offline. Mutations are optimistic and idempotently upserted on
// reconnect (the client mints the board id, so retries are safe).

const CACHE_KEY = 'whiteboard:boards-cache';
const OUTBOX_KEY = 'whiteboard:boards-outbox';

type OutboxOp =
  | { kind: 'upsert'; board: BoardMeta }
  | { kind: 'delete'; id: string };

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
    return Object.values(loadCache()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<BoardMeta | undefined> {
    return loadCache()[id];
  }

  async create(name: string): Promise<BoardMeta> {
    const now = Date.now();
    const board: BoardMeta = {
      id: genBoardId(),
      name: name.trim() || 'Untitled board',
      createdAt: now,
      updatedAt: now,
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
            : await api(`/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
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
