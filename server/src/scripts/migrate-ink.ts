/**
 * Rewrite every stored stroke into the binary ink chunk format, and every
 * shape's base fields into their packed entry (see migrate-shapes.ts).
 *
 *   npm run migrate:shapes -w server            # dry run: report, write nothing
 *   npm run migrate:shapes -w server -- --apply # rewrite the documents that need it
 *
 * (`migrate:ink` is the same script.)
 *
 * Stop the server first. A running server holds open documents in memory and
 * appends to their logs; this script replaces a document's snapshot and drops
 * its log, so anything the server writes between this script's read and its
 * write is lost, and a document the server still holds is written back in the
 * old format. Take a database backup before `--apply`.
 */
import * as Y from 'yjs';
import { db } from '../db/client';
import { boardDocumentUpdates, boardDocuments } from '../db/schema';
import { postgresDocumentStorage } from '../collab/document-persistence';
import { migrateInk } from '../collab/migrate-ink';
import { migrateShapes } from '../collab/migrate-shapes';

const apply = process.argv.includes('--apply');

async function documentNames(): Promise<string[]> {
  const snapshots = await db
    .select({ name: boardDocuments.documentName })
    .from(boardDocuments);
  const logs = await db
    .selectDistinct({ name: boardDocumentUpdates.documentName })
    .from(boardDocumentUpdates);
  return [...new Set([...snapshots, ...logs].map((row) => row.name))].sort();
}

async function main(): Promise<void> {
  const names = await documentNames();
  let documents = 0;
  let strokes = 0;
  let shapes = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const name of names) {
    const stored = await postgresDocumentStorage.load(name);
    const doc = new Y.Doc();
    // Replayed exactly as `createDocumentPersistence().load` does.
    if (stored.snapshot?.format === 'v2') {
      Y.applyUpdateV2(doc, stored.snapshot.data);
    } else if (stored.snapshot) {
      Y.applyUpdate(doc, stored.snapshot.data);
    }
    for (const update of stored.updates) Y.applyUpdateV2(doc, update);

    const before = Y.encodeStateAsUpdateV2(doc).byteLength;
    const { migrated } = migrateInk(doc);
    const { migrated: packed } = migrateShapes(doc);
    if (migrated === 0 && packed === 0) continue;
    const snapshot = Y.encodeStateAsUpdateV2(doc);
    documents++;
    strokes += migrated;
    shapes += packed;
    bytesBefore += before;
    bytesAfter += snapshot.byteLength;
    console.log(
      `${name}: ${migrated} strokes, ${packed} shapes, ${before} -> ${snapshot.byteLength} bytes`,
    );
    if (apply) await postgresDocumentStorage.compact(name, snapshot);
  }

  console.log(
    `${apply ? 'Migrated' : 'Would migrate'} ${strokes} strokes and ` +
      `${shapes} shapes in ` +
      `${documents} of ${names.length} documents; ` +
      `${bytesBefore} -> ${bytesAfter} bytes.`,
  );
  if (!apply && documents > 0) console.log('Re-run with --apply to write.');
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
