import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { boardDocuments } from '../db/schema';
import {
  createVoiceSignalRouter,
  sanitizeVoiceAwareness,
} from './voice-signaling';

const routeVoiceSignal = createVoiceSignalRouter();

/**
 * Hocuspocus collaboration server. Persists each document's opaque Yjs state in
 * a bytea row via Drizzle, keyed by document name — a board's own document plus
 * one per page (`pageDocumentName`), which is what lets a client sync a page
 * only when it opens it. Rooms are open: per our model the board id (the
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
  // way to pick the encoding. Hocuspocus debounces `onStoreDocument` itself, so
  // moving off the extension keeps the same 2s/10s write cadence.
  onLoadDocument: async ({ documentName, document }) => {
    const rows = await db
      .select()
      .from(boardDocuments)
      .where(eq(boardDocuments.documentName, documentName))
      .limit(1);
    const row = rows[0];
    if (!row) return;
    // A v1 row is read once and then written back as v2 by the next store.
    if (row.format === 'v2') Y.applyUpdateV2(document, row.data);
    else Y.applyUpdate(document, row.data);
  },
  onStoreDocument: async ({ documentName, document }) => {
    const data = Buffer.from(Y.encodeStateAsUpdateV2(document));
    await db
      .insert(boardDocuments)
      .values({
        documentName,
        data,
        format: 'v2',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: boardDocuments.documentName,
        set: { data, format: 'v2', updatedAt: new Date() },
      });
  },
});
