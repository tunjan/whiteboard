import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { type LiveBoard, PAGE_DOCUMENT_INFIX } from '@whiteboard/shared';
import { boardAccess } from '../boards/access';
import { SESSION_COOKIE } from '../auth/routes';
import { db } from '../db/client';
import { boardSessions } from '../db/schema';

/**
 * Records who is on a board and for how long — the app's only usage signal.
 *
 * A row is opened when a connection to a board document arrives and closed when
 * it goes away; in between, `lastSeenAt` is written on a slow tick so a session
 * cut short by a crash still has an end. Everything that happens at cursor rate
 * (awareness) or edit rate (`onChange`) only touches memory; the database sees
 * one write per session per `flushMs` at most.
 */

/** The database side, injected so the tracker's bookkeeping is testable. */
export interface SessionStore {
  open(row: {
    boardId: string;
    name: string;
    color: string | null;
    isTutor: boolean;
    startedAt: Date;
  }): Promise<number>;
  update(
    id: number,
    row: {
      name: string;
      color: string | null;
      lastSeenAt: Date;
      edits: number;
      drawings: number;
      afk: [number, number][];
    },
  ): Promise<void>;
}

export const postgresSessionStore: SessionStore = {
  async open(row) {
    const [inserted] = await db
      .insert(boardSessions)
      .values({ ...row, lastSeenAt: row.startedAt })
      .returning({ id: boardSessions.id });
    return inserted!.id;
  },
  async update(id, row) {
    await db.update(boardSessions).set(row).where(eq(boardSessions.id, id));
  },
};

interface Live {
  id: number | null;
  /** Set while the insert is in flight, so a disconnect can wait for the id. */
  opening: Promise<number> | null;
  boardId: string;
  name: string;
  color: string | null;
  isTutor: boolean;
  lastSeenAt: number;
  edits: number;
  drawings: number;
  /**
   * Whether this client publishes an input counter. An older client does not,
   * and its time is never read as AFK for want of a signal.
   */
  tracksInput: boolean;
  /** Last input counter seen, to tell a bump from an awareness renewal. */
  activity: number | null;
  /** Server time of the last input — a counter bump or an edit. */
  lastInputAt: number;
  /** Closed AFK stretches. The open one, if any, is derived at write time. */
  afk: [number, number][];
  /** Written fields differ from the row on disk. */
  dirty: boolean;
}

/**
 * The board a document belongs to, or null for the board document's own pages.
 * A page document is `<boardId>/pages/<pageId>`; only the board document opens
 * a session, but a page's edits still belong to the board's.
 */
function boardIdOf(documentName: string): string {
  const at = documentName.indexOf(PAGE_DOCUMENT_INFIX);
  return at === -1 ? documentName : documentName.slice(0, at);
}

function isPageDocument(documentName: string): boolean {
  return documentName.includes(PAGE_DOCUMENT_INFIX);
}

/**
 * Input can stop for this long before the rest of the gap counts as AFK:
 * enough to read a question or work it on paper, short of a tab left open.
 */
export const AFK_GRACE_MS = 5 * 60_000;

/** Whether `entry` had gone without input past the grace by `at`. */
function idleAt(entry: Live, at: number): boolean {
  return entry.tracksInput && at - entry.lastInputAt > AFK_GRACE_MS;
}

/**
 * Shapes an update adds: new keys on a document's root `shapes` map, each a
 * shape's own Y.Map. Setting a key that already has a history (a redo, a
 * property rewrite) carries an origin instead of the parent's name, so only a
 * key's first value is counted — a new drawing, not an edit to one.
 */
export function countAddedShapes(update: Uint8Array): number {
  let added = 0;
  for (const struct of Y.decodeUpdate(update).structs) {
    if (
      struct instanceof Y.Item &&
      // A decoded update names a root parent by string; Yjs types it as a live type.
      (struct.parent as unknown) === 'shapes' &&
      struct.parentSub !== null &&
      struct.content instanceof Y.ContentType
    ) {
      added += 1;
    }
  }
  return added;
}

/**
 * The headers Hocuspocus hands a hook.
 *
 * Typed as `Headers`, but the value is whatever `request.headers` is on the
 * request the connection was upgraded from — and ours come from Node's
 * `IncomingMessage` (see the `upgrade` handler in `index.ts`), which is a plain
 * object of lowercased names. Both shapes have to be read.
 */
export type RequestHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

function headerValue(headers: RequestHeaders, name: string): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const raw = (headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(raw)) return raw.join('; ');
  return raw ?? null;
}

/** Whether the upgrade request carried the session cookie of the board's own tutor. */
async function isTutorRequest(headers: RequestHeaders, boardId: string): Promise<boolean> {
  const cookie = headerValue(headers, 'cookie');
  if (!cookie) return false;
  const token = cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  return (await boardAccess(boardId, undefined, decodeURIComponent(token))) === 'tutor';
}

export interface SessionTrackerOptions {
  store?: SessionStore;
  now?: () => number;
  /** How often a live session's `lastSeenAt` and edit count reach the database. */
  flushMs?: number;
  /** Start the interval. Off in tests, which drive `flush()` by hand. */
  autoFlush?: boolean;
}

export function createSessionTracker(options: SessionTrackerOptions = {}) {
  const store = options.store ?? postgresSessionStore;
  const now = options.now ?? Date.now;
  const flushMs = options.flushMs ?? 30_000;
  // One session per (socket, board): a client shares one socket across the
  // board document and its pages, and only the board document opens a session.
  const live = new Map<string, Live>();

  const key = (socketId: string, boardId: string) =>
    `${socketId}\u0000${boardId}`;

  async function connected(payload: {
    socketId: string;
    documentName: string;
    requestHeaders: RequestHeaders;
  }): Promise<void> {
    if (isPageDocument(payload.documentName)) return;
    const boardId = payload.documentName;
    const id = key(payload.socketId, boardId);
    if (live.has(id)) return;
    const startedAt = new Date(now());
    const isTutor = await isTutorRequest(payload.requestHeaders, boardId);
    // The identity arrives over awareness a moment later; the row opens now so
    // a connection that never publishes one is still counted.
    const entry: Live = {
      id: null,
      opening: null,
      boardId,
      name: '',
      color: null,
      isTutor,
      lastSeenAt: startedAt.getTime(),
      edits: 0,
      drawings: 0,
      tracksInput: false,
      activity: null,
      lastInputAt: startedAt.getTime(),
      afk: [],
      dirty: false,
    };
    live.set(id, entry);
    entry.opening = store
      .open({ boardId, name: '', color: null, isTutor, startedAt })
      .then((rowId) => {
        entry.id = rowId;
        return rowId;
      });
    await entry.opening;
  }

  /** Input happened: close the AFK stretch it ends, if the gap ran past grace. */
  function input(entry: Live, at: number): void {
    if (idleAt(entry, at)) {
      entry.afk.push([entry.lastInputAt + AFK_GRACE_MS, at]);
    }
    entry.lastInputAt = at;
  }

  /** Cursor-rate: memory only. */
  function awareness(payload: {
    socketId: string;
    documentName: string;
    user: { name?: unknown; color?: unknown } | null;
    attention?: unknown;
  }): void {
    const entry = live.get(
      key(payload.socketId, boardIdOf(payload.documentName)),
    );
    if (!entry) return;
    const at = now();
    entry.lastSeenAt = at;
    // The client's input counter (`collab/attention.ts`), timed on this clock.
    // Awareness renews itself every few seconds with the same value, so only a
    // change is input.
    const activity = (payload.attention as { activity?: unknown } | null)
      ?.activity;
    if (typeof activity === 'number' && activity !== entry.activity) {
      if (entry.tracksInput) input(entry, at);
      else {
        // First sighting: no evidence of how long they were idle before it.
        entry.tracksInput = true;
        entry.lastInputAt = at;
      }
      entry.activity = activity;
    }
    const name =
      typeof payload.user?.name === 'string' ? payload.user.name : '';
    const color =
      typeof payload.user?.color === 'string' ? payload.user.color : null;
    if (name && (name !== entry.name || color !== entry.color)) {
      entry.name = name;
      entry.color = color;
    }
    entry.dirty = true;
  }

  /** Edit-rate: memory only. Page edits count towards the board's session. */
  function change(payload: {
    socketId: string;
    documentName: string;
    update?: Uint8Array;
  }): void {
    const entry = live.get(
      key(payload.socketId, boardIdOf(payload.documentName)),
    );
    if (!entry) return;
    entry.edits += 1;
    if (payload.update) entry.drawings += countAddedShapes(payload.update);
    entry.lastSeenAt = now();
    input(entry, entry.lastSeenAt);
    entry.dirty = true;
  }

  async function writeBack(entry: Live): Promise<void> {
    if (entry.id === null) await entry.opening;
    if (entry.id === null) return;
    entry.dirty = false;
    // The stretch still open runs to the row's end, so a student who walked
    // away and whose tab was later closed — or whose server died — is covered.
    const afk = [...entry.afk];
    if (idleAt(entry, entry.lastSeenAt)) {
      afk.push([entry.lastInputAt + AFK_GRACE_MS, entry.lastSeenAt]);
    }
    await store.update(entry.id, {
      name: entry.name,
      color: entry.color,
      lastSeenAt: new Date(entry.lastSeenAt),
      edits: entry.edits,
      drawings: entry.drawings,
      afk,
    });
  }

  async function disconnected(payload: {
    socketId: string;
    documentName: string;
  }): Promise<void> {
    if (isPageDocument(payload.documentName)) return;
    const id = key(payload.socketId, payload.documentName);
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    await writeBack(entry);
  }

  async function flush(): Promise<void> {
    await Promise.all(
      [...live.values()].filter((e) => e.dirty).map((e) => writeBack(e)),
    );
  }

  /**
   * Boards a student is connected to right now, for the tutor's library, with
   * who has gone idle. The same rule attendance applies: a tutor on the board
   * means nobody on it is AFK, and neither is a student active in another tab.
   */
  function liveBoards(): LiveBoard[] {
    const at = now();
    const entries = [...live.values()];
    const boards = new Map<string, LiveBoard>();
    for (const entry of entries) {
      if (entry.isTutor) continue;
      const board = boards.get(entry.boardId) ?? { id: entry.boardId, afk: [] };
      boards.set(entry.boardId, board);
      const onBoard = entries.filter((e) => e.boardId === entry.boardId);
      const own = onBoard.filter((e) => !e.isTutor && e.name === entry.name);
      if (onBoard.some((e) => e.isTutor) || !own.every((e) => idleAt(e, at))) {
        continue;
      }
      const name = entry.name || 'Unnamed';
      if (board.afk.some((student) => student.name === name)) continue;
      const lastInputAt = Math.max(...own.map((e) => e.lastInputAt));
      board.afk.push({
        name,
        idleMinutes: Math.floor((at - lastInputAt) / 60_000),
      });
    }
    return [...boards.values()];
  }

  const timer =
    options.autoFlush === false
      ? null
      : setInterval(() => {
          void flush().catch((error: unknown) => {
            console.warn(`[server] session flush failed: ${String(error)}`);
          });
        }, flushMs);
  timer?.unref?.();

  return {
    connected,
    awareness,
    change,
    disconnected,
    flush,
    liveBoards,
    stop: () => {
      if (timer) clearInterval(timer);
    },
    /** Live session count, for tests. */
    size: () => live.size,
  };
}

export type SessionTracker = ReturnType<typeof createSessionTracker>;
