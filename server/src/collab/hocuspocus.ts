import { Hocuspocus } from '@hocuspocus/server';
import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { createDocumentPersistence } from './document-persistence';
import {
  createVoiceSignalRouter,
  sanitizeVoiceAwareness,
} from './voice-signaling';

const routeVoiceSignal = createVoiceSignalRouter();
const persistence = createDocumentPersistence();

/**
 * Hocuspocus collaboration server. Persists each document's opaque Yjs state
 * via Drizzle, keyed by document name — a board's own document plus one per page
 * (`pageDocumentName`), which is what lets a client sync a page only when it
 * opens it. Rooms are open: per our model the board id (the
 * capability URL) is the secret, so students connect without auth. Tutor gating
 * is on the HTTP management surface, not here.
 */
export const hocuspocus = new Hocuspocus({
  beforeHandleAwareness: async ({ connection, document, states }) => {
    if (!connection) return;
    sanitizeVoiceAwareness({ connection, document, states });
  },
  onStateless: async ({ connection, document, payload }) => {
    if (payload.startsWith(LATENCY_MESSAGE_PREFIX)) {
      connection.sendStateless(payload);
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
