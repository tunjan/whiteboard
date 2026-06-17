import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';

// The pool connects lazily (on first query), so the server boots even when
// Postgres isn't running yet — only collaboration/board-list features need it.
const pool = new pg.Pool({ connectionString: env.databaseUrl });

export const db = drizzle(pool, { schema });
