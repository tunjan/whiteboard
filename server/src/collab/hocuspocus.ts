import { Hocuspocus, type Connection } from '@hocuspocus/server';
import {
  EPHEMERAL_PREFIX,
  LATENCY_MESSAGE_PREFIX,
  REMOVED_MESSAGE,
} from '@whiteboard/shared';
import {
  type Access,
  boardAccess,
  boardIdOf,
  sessionFromHeaders,
} from '../boards/access';
import { createDocumentPersistence } from './document-persistence';
import { createEphemeralRelay } from './ephemeral-relay';
import { createSessionTracker } from './session-tracking';
import {
  createVoiceSignalRouter,
  sanitizeVoiceAwareness,
} from './voice-signaling';

const routeVoiceSignal = createVoiceSignalRouter();
const relayEphemeral = createEphemeralRelay();
const persistence = createDocumentPersistence();
const sessions = createSessionTracker();

export const liveBoards = () => sessions.liveBoards();

/**
 * Which connection publishes each awareness client id — how the tutor's people
 * list (keyed by client id) maps back to a socket. Kept here rather than read
 * from Hocuspocus's own per-connection client sets: those only record ids that
 * arrive as "added", and a student who reconnects (after a mode change, say)
 * comes back as "updated", leaving them unfindable.
 */
const awarenessOwners = new Map<number, Connection>();

/**
 * Hocuspocus collaboration server. Persists each document's opaque Yjs state
 * via Drizzle, keyed by document name — a board's own document plus one per page
 * (`pageDocumentName`), which is what lets a client sync a page only when it
 * opens it. Every document is gated by `boards/access.ts`: the tutor's cookie,
 * or the board's share key as the provider token. A view-only link connects
 * read-only, which Hocuspocus enforces by refusing that connection's updates.
 */
export const hocuspocus = new Hocuspocus({
  onAuthenticate: async ({ token, documentName, requestHeaders, connectionConfig }) => {
    const access = await boardAccess(
      boardIdOf(documentName),
      token,
      sessionFromHeaders(requestHeaders),
    );
    if (!access) throw new Error('Forbidden');
    connectionConfig.readOnly = access === 'view';
    // Becomes the connection's context: what `disconnectStudents` filters on.
    return { access } satisfies { access: Access };
  },
  // Attendance: who is on which board, and for how long (session-tracking.ts).
  // `connected` rather than `onConnect` so the connection is already accepted —
  // a rejected one is not a visit.
  connected: async ({ socketId, documentName, requestHeaders }) => {
    await sessions.connected({ socketId, documentName, requestHeaders });
  },
  onDisconnect: async ({ socketId, documentName }) => {
    // Per document: a socket closing one page leaves its board connection up.
    for (const [clientId, connection] of awarenessOwners) {
      if (connection.socketId === socketId && connection.document.name === documentName) {
        awarenessOwners.delete(clientId);
      }
    }
    await sessions.disconnected({ socketId, documentName });
  },
  onChange: async ({ connection, documentName, update }) => {
    if (connection) {
      sessions.change({ socketId: connection.socketId, documentName, update });
    }
  },
  onAwarenessUpdate: async ({
    connection,
    documentName,
    added,
    updated,
    states,
  }) => {
    if (!connection) return;
    // A client only ever publishes its own state, so the clientId this message
    // carries is the one behind this connection — that is where its name is.
    const clientId = [...added, ...updated].at(-1);
    if (clientId === undefined) return;
    awarenessOwners.set(clientId, connection);
    const state = states.find((s) => s.clientId === clientId);
    sessions.awareness({
      socketId: connection.socketId,
      documentName,
      user:
        (state?.user as { name?: unknown; color?: unknown } | undefined) ?? null,
      attention: state?.attention,
    });
  },
  beforeHandleAwareness: async ({ connection, document, states }) => {
    if (!connection) return;
    sanitizeVoiceAwareness({ connection, document, states });
  },
  onStateless: async ({ connection, document, payload }) => {
    if (payload.startsWith(LATENCY_MESSAGE_PREFIX)) {
      connection.sendStateless(payload);
    } else if (payload.startsWith(EPHEMERAL_PREFIX)) {
      relayEphemeral({ connection, document, payload });
    } else {
      routeVoiceSignal({ connection, document, payload });
    }
  },
  // These replace the Database extension, which hardcodes V1 on both sides
  // (`Y.applyUpdate` on load, `Y.encodeStateAsUpdate` on store) and so gives no
  // way to pick the encoding — nor to write anything less than the whole
  // document each time. Hocuspocus debounces `onStoreDocument` itself, so moving
  // off the extension keeps the same 2s/10s write cadence; what each of those
  // writes costs is `document-persistence.ts`.
  onLoadDocument: async ({ documentName, document }) => {
    await persistence.load(documentName, document);
  },
  onStoreDocument: async ({ documentName, document }) => {
    await persistence.store(documentName, document);
  },
  afterUnloadDocument: async ({ documentName }) => {
    persistence.forget(documentName);
  },
});

/** Every live connection to `boardId`'s documents, board and pages alike. */
function boardConnections(boardId: string): Connection[] {
  const out: Connection[] = [];
  hocuspocus.documents.forEach((document) => {
    if (boardIdOf(document.name) === boardId) out.push(...document.getConnections());
  });
  return out;
}

/**
 * Close one live document and unload it, so no client keeps editing it and
 * nothing re-persists it behind a caller about to delete its rows. A no-op when
 * the document is not open.
 */
export async function closeDocument(documentName: string): Promise<void> {
  const open = hocuspocus.documents.get(documentName);
  if (!open) return;
  hocuspocus.closeConnections(documentName);
  // `unloadDocument` is a no-op while a store is still debounced, and that is
  // exactly the state right after someone drew on what is now being deleted:
  // the caller's deletes would run, and the pending store would append a fresh
  // log row a couple of seconds later for a document nothing references.
  // Flushing the debounce first both makes the unload real and puts every row
  // this document will ever own in the table before the caller drops them.
  // Returns undefined when nothing is pending.
  await hocuspocus.debouncer.executeNow(`onStoreDocument-${documentName}`);
  await hocuspocus.unloadDocument(open);
}

/** {@link closeDocument} for every live document of a board, pages included. */
export async function closeBoardDocuments(boardId: string): Promise<void> {
  const names = [...hocuspocus.documents.keys()].filter(
    (name) => boardIdOf(name) === boardId,
  );
  await Promise.all(names.map(closeDocument));
}

const isStudent = (connection: Connection) =>
  (connection.context as { access?: Access }).access !== 'tutor';

/**
 * Drop every student socket on a board after its link changed. Their
 * providers reconnect on their own and authenticate afresh, so an old key is
 * refused and a new mode arrives as the new scope — nothing else to push.
 * The whole socket, not the one document: a provider whose document alone is
 * closed never authenticates again until its socket does.
 */
export function disconnectStudents(boardId: string): void {
  for (const connection of boardConnections(boardId)) {
    if (isStudent(connection)) connection.webSocket.close(4000, 'access changed');
  }
}

/**
 * Tell every tutor on `boardId` something, over the board document's socket
 * only: a page document shares that socket, and sending on it too would
 * deliver the message once per open page.
 */
export function notifyTutors(boardId: string, payload: string): void {
  for (const connection of boardConnections(boardId)) {
    if (!isStudent(connection) && connection.document.name === boardId) {
      connection.sendStateless(payload);
    }
  }
}

/** {@link notifyTutors}, but to everyone on the board. */
export function notifyBoard(boardId: string, payload: string): void {
  for (const connection of boardConnections(boardId)) {
    if (connection.document.name === boardId) connection.sendStateless(payload);
  }
}

/**
 * Remove one student, named by the awareness client id the tutor sees them
 * by. They are told first, so their client stops rather than reconnects; the
 * link still works if they come back, which is what resetting it is for.
 */
export function removeClient(boardId: string, clientId: number): boolean {
  const connection = awarenessOwners.get(clientId);
  if (
    !connection ||
    boardIdOf(connection.document.name) !== boardId ||
    !isStudent(connection)
  ) {
    return false;
  }
  connection.sendStateless(REMOVED_MESSAGE);
  connection.webSocket.close(4001, 'removed');
  return true;
}

/**
 * Save every open document before the process exits. Closing the connections
 * unloads documents with nothing pending; the rest have their debounced store
 * (up to 10s away) run now. Resolves with how many documents were still in
 * memory when it gave up — 0 means everything reached the database.
 */
export async function drainCollab(timeoutMs = 15_000): Promise<number> {
  hocuspocus.closeConnections();
  hocuspocus.flushPendingStores();
  const deadline = Date.now() + timeoutMs;
  while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return hocuspocus.getDocumentsCount();
}
