/**
 * Apply the migrations in `server/drizzle` that this database hasn't had yet.
 * Runs before the server starts in the container; locally:
 *
 *   npm run db:migrate
 *
 * Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and
 * commit the new file under `drizzle/`.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, db } from '../db/client';

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
});
await closeDb();
console.log('[migrate] database is up to date');
