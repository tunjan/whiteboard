import { asc, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { db } from '../db/client';
import { boardDocumentUpdates, boardDocuments } from '../db/schema';

/**
 * How a collaboration document is written to Postgres.
 *
 * The obvious store — `encodeStateAsUpdateV2` over the whole document into its
 * one bytea row, which is what Hocuspocus's own Database extension does — costs
 * the *entire document* on every debounce tick. Measured on a 2,800-shape page:
 * 2.60 MB and 22.7 ms of encoding per write, every two seconds, for as long as
 * anyone is drawing, plus a full-row rewrite of a TOASTed value and the WAL that
 * goes with it. Between two ticks that page only gained a few strokes.
 *
 * So a document is stored as a snapshot plus an append-only log. The updates Yjs
 * emits are buffered in memory and flushed as one merged delta per tick — 1.4 KB
 * and 0.42 ms for the same page, a ~1800x smaller write — and the snapshot is
 * re-encoded only when the log outgrows `MAX_LOG_ROWS` / `MAX_LOG_BYTES`, which
 * on that workload is once every few hundred ticks rather than every one.
 * Loading replays the snapshot and then the log.
 */

/**
 * Rewrite the snapshot once the log passes either bound. Rows keep replay on
 * load cheap; bytes keep a document's stored size within a constant factor of
 * its live size, so compaction stays amortised rather than proportional.
 */
const MAX_LOG_ROWS = 500;
const MAX_LOG_BYTES = 1024 * 1024;

/** The stored form of one document, as `load` finds it. */
export interface StoredDocument {
  /** Absent for a document that has only ever been written as log rows. */
  snapshot?: { data: Uint8Array; format: string };
  /** Log rows in `seq` order, to apply after the snapshot. */
  updates: Uint8Array[];
}

/**
 * The database side of persistence, kept behind an interface so the buffering
 * and compaction rules below can be tested without a Postgres.
 */
export interface DocumentStorage {
  load(documentName: string): Promise<StoredDocument>;
  /** Appends one update to the document's log. */
  append(documentName: string, update: Uint8Array): Promise<void>;
  /**
   * Replaces the snapshot and drops the log it supersedes, atomically — a
   * partial write here would resurrect updates the snapshot already contains,
   * or lose ones it does not.
   */
  compact(documentName: string, snapshot: Uint8Array): Promise<void>;
}

export const postgresDocumentStorage: DocumentStorage = {
  async load(documentName) {
    // Both reads see one point in time. Under READ COMMITTED they would not:
    // each statement takes its own snapshot, so a `compact` committing between
    // them would hand back the pre-compaction snapshot together with the log it
    // just emptied, silently dropping every edit in between. Hocuspocus can run
    // an unload's final store concurrently with a new connection's load of the
    // same document, so the window is real. Read-only, so the stricter
    // isolation costs nothing and cannot abort.
    return db.transaction(
      async (tx) => {
        const [row] = await tx
          .select()
          .from(boardDocuments)
          .where(eq(boardDocuments.documentName, documentName))
          .limit(1);
        const updates = await tx
          .select({ data: boardDocumentUpdates.data })
          .from(boardDocumentUpdates)
          .where(eq(boardDocumentUpdates.documentName, documentName))
          .orderBy(asc(boardDocumentUpdates.seq));
        return {
          snapshot: row ? { data: row.data, format: row.format } : undefined,
          updates: updates.map((update) => update.data),
        };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  },

  async append(documentName, update) {
    await db
      .insert(boardDocumentUpdates)
      .values({ documentName, data: Buffer.from(update) });
  },

  async compact(documentName, snapshot) {
    const data = Buffer.from(snapshot);
    await db.transaction(async (tx) => {
      await tx
        .insert(boardDocuments)
        .values({ documentName, data, format: 'v2', updatedAt: new Date() })
        .onConflictDoUpdate({
          target: boardDocuments.documentName,
          set: { data, format: 'v2', updatedAt: new Date() },
        });
      await tx
        .delete(boardDocumentUpdates)
        .where(eq(boardDocumentUpdates.documentName, documentName));
    });
  },
};

/** What we track per open document to decide the next write. */
interface OpenDocument {
  /** Updates emitted since the last write, flushed as one merged delta. */
  buffered: Uint8Array[];
  /** Size of the stored snapshot the log is layered on. */
  snapshotBytes: number;
  logRows: number;
  logBytes: number;
}

export function createDocumentPersistence(
  storage: DocumentStorage = postgresDocumentStorage,
) {
  const open = new Map<string, OpenDocument>();

  return {
    /** Restores `document` from storage and starts recording its updates. */
    async load(documentName: string, document: Y.Doc): Promise<void> {
      const stored = await storage.load(documentName);
      // One transaction for the whole replay rather than one per update.
      document.transact(() => {
        const { snapshot } = stored;
        // A v1 row is read once and then written back as v2 by the next
        // compaction; log rows are always v2.
        if (snapshot?.format === 'v2') Y.applyUpdateV2(document, snapshot.data);
        else if (snapshot) Y.applyUpdate(document, snapshot.data);
        for (const update of stored.updates) Y.applyUpdateV2(document, update);
      });

      const state: OpenDocument = {
        buffered: [],
        snapshotBytes: stored.snapshot?.data.byteLength ?? 0,
        logRows: stored.updates.length,
        logBytes: stored.updates.reduce((sum, u) => sum + u.byteLength, 0),
      };
      open.set(documentName, state);
      // Subscribed after the replay, so restoring the document does not record
      // itself back into the log.
      document.on('updateV2', (update: Uint8Array) => {
        state.buffered.push(update);
      });
    },

    /** Writes everything since the last call. Called on Hocuspocus's debounce. */
    async store(documentName: string, document: Y.Doc): Promise<void> {
      const state = open.get(documentName);
      // No `load` ran for this document, so there is nothing to diff against.
      if (!state) {
        await storage.compact(documentName, Y.encodeStateAsUpdateV2(document));
        return;
      }

      // Claim the buffer before any await: updates that arrive while this write
      // is in flight belong to the next one.
      const flushing = state.buffered;
      state.buffered = [];

      const delta = flushing.length > 0 ? Y.mergeUpdatesV2(flushing) : null;
      // Checked even with nothing to flush: a document loaded with a log that
      // is already over the bound would otherwise carry that long replay
      // forever, since editing it is what the bound was waiting for.
      const compact =
        state.logRows + (delta ? 1 : 0) > MAX_LOG_ROWS ||
        state.logBytes + (delta?.byteLength ?? 0) >
          Math.max(MAX_LOG_BYTES, state.snapshotBytes);
      if (!delta && !compact) return;

      try {
        if (compact) {
          // Encoded synchronously with the buffer swap above, so the snapshot
          // covers exactly the log rows it replaces plus `flushing`.
          const snapshot = Y.encodeStateAsUpdateV2(document);
          await storage.compact(documentName, snapshot);
          state.snapshotBytes = snapshot.byteLength;
          state.logRows = 0;
          state.logBytes = 0;
        } else if (delta) {
          await storage.append(documentName, delta);
          state.logRows += 1;
          state.logBytes += delta.byteLength;
        }
      } catch (error) {
        // Hand the batch back so the next store retries it rather than dropping
        // the edits it covers.
        state.buffered.unshift(...flushing);
        throw error;
      }
    },

    /** Drops the bookkeeping for a document Hocuspocus has unloaded. */
    forget(documentName: string): void {
      open.delete(documentName);
    },
  };
}
