import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ALL_FEATURES, genBoardId, type FeatureSet } from '@whiteboard/shared';
import { db } from '../db/client';
import { boards } from '../db/schema';
import { env } from '../env';
import { importBoard, unpackBoardFile } from './board-file';
import { readSetting, writeSetting } from './features';
import { deleteBoard } from './routes';

/**
 * The public demo: one board anyone can draw on without signing in, replaced
 * by a fresh one every `DEMO_RESET_MINUTES`. Off unless `DEMO=1`.
 *
 * Replaced, not wiped in place: every browser that opened it holds an
 * IndexedDB copy, which would sync the old drawings straight back into a
 * wiped document. A new board id leaves those copies pointing at nothing.
 */

// Nothing that spends money or stores files for strangers.
const DEMO_FEATURES: FeatureSet = { ...ALL_FEATURES, ai: false, documents: false, music: false };

/** The board `/demo` currently points at, if any. */
export async function demoBoardId(): Promise<string | undefined> {
  const value = (await readSetting('demo')) as { id?: unknown } | undefined;
  return typeof value?.id === 'string' ? value.id : undefined;
}

async function rotateDemo(): Promise<void> {
  const id = genBoardId();
  if (env.demoSeed) {
    await importBoard(id, await unpackBoardFile(new Uint8Array(await readFile(env.demoSeed))));
  }
  await db.insert(boards).values({ id, name: 'Demo', features: DEMO_FEATURES });
  const previous = await demoBoardId();
  await writeSetting('demo', { id });
  // ponytail: images uploaded to the demo stay in the blob store (content-
  // addressed, shared, never garbage-collected). Add blob GC if its disk grows.
  if (previous) await deleteBoard(previous);
}

export function startDemo(): void {
  if (!env.demo) return;
  const run = () =>
    rotateDemo().catch((error: unknown) => console.error('[demo] reset failed', error));
  void run();
  setInterval(run, env.demoResetMinutes * 60_000).unref();
}

/** `GET /demo`: into the current demo board through its student link. */
export const demoRoutes = new Hono();

demoRoutes.get('/', async (c) => {
  const id = env.demo ? await demoBoardId() : undefined;
  const [row] = id
    ? await db.select({ key: boards.shareKey }).from(boards).where(eq(boards.id, id))
    : [];
  if (!id || !row) return c.text('No demo here.', 404);
  c.header('Cache-Control', 'no-store');
  return c.redirect(`/board/${encodeURIComponent(id)}?k=${row.key}`);
});
