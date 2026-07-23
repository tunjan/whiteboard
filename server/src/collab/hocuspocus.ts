import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
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
 * Hocuspocus collaboration server. Persists each board's opaque Yjs state in a
 * single bytea row via Drizzle. Rooms are open: per our model the board id (the
 * capability URL) is the secret, so students connect without auth. Tutor gating
 * is on the HTTP management surface, not here.
 *
 * Configured now; clients connect starting Phase 19.
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
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const rows = await db
          .select()
          .from(boardDocuments)
          .where(eq(boardDocuments.boardId, documentName))
          .limit(1);
        return rows[0]?.data ?? null;
      },
      store: async ({ documentName, state }) => {
        const data = Buffer.from(state);
        await db
          .insert(boardDocuments)
          .values({ boardId: documentName, data, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: boardDocuments.boardId,
            set: { data, updatedAt: new Date() },
          });
      },
    }),
  ],
});
