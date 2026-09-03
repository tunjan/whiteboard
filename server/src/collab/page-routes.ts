import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { pageDocumentName } from '@whiteboard/shared';
import { db } from '../db/client';
import { boardDocumentUpdates, boardDocuments } from '../db/schema';
import { hocuspocus } from './hocuspocus';

/**
 * Reclaiming a deleted page's stored content.
 *
 * Deleting a page removes it from the board's page registry, which every client
 * sees over the CRDT — but the page's shapes are a document of their own, and
 * nothing in the Yjs protocol says "this document is gone". Without this the
 * row would sit in the database forever, holding the whole page.
 *
 * Deliberately not behind `requireTutor`, unlike /api/boards: the collaboration
 * room is open (the board id is the capability), so anyone who can delete the
 * page through the canvas can delete its content. Gating here would only mean a
 * student's deletion left the bytes behind.
 */
export const pageRoutes = new Hono();

pageRoutes.delete('/:boardId/:pageId', async (c) => {
  const documentName = pageDocumentName(
    c.req.param('boardId'),
    c.req.param('pageId'),
  );

  // Drop the live document first. A client still holding it open would
  // otherwise re-persist it on its next debounced store, leaving a row for a
  // page no registry references — harmless, since nothing ever loads it again,
  // but pointless bytes.
  const open = hocuspocus.documents.get(documentName);
  if (open) {
    hocuspocus.closeConnections(documentName);
    // `unloadDocument` is a no-op while a store is still debounced, and that is
    // exactly the state right after someone drew on the page they are now
    // deleting: the deletes below would run, and the pending store would append
    // a fresh log row a couple of seconds later for a page no registry
    // references. Flushing the debounce first both makes the unload real and
    // puts every row this document will ever own in the table before we drop
    // them. Returns undefined when nothing is pending.
    await hocuspocus.debouncer.executeNow(`onStoreDocument-${documentName}`);
    await hocuspocus.unloadDocument(open);
  }
  await db
    .delete(boardDocuments)
    .where(eq(boardDocuments.documentName, documentName));
  // The page's snapshot is only half of it: whatever it gained since that
  // snapshot sits in the append-only update log.
  await db
    .delete(boardDocumentUpdates)
    .where(eq(boardDocumentUpdates.documentName, documentName));

  return c.json({ ok: true });
});
