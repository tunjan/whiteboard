import { Hocuspocus } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { boardDocuments } from '../db/schema';

/**
 * Hocuspocus collaboration server. Persists each board's opaque Yjs state in a
 * single bytea row via Drizzle. Rooms are open: per our model the board id (the
 * capability URL) is the secret, so students connect without auth. Tutor gating
 * is on the HTTP management surface, not here.
 *
 * Configured now; clients connect starting Phase 19.
 */
export const hocuspocus = new Hocuspocus({
  onStateless: async ({ connection, payload }) => {
    if (payload.startsWith(LATENCY_MESSAGE_PREFIX)) {
      connection.sendStateless(payload);
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
