import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  ALL_FEATURES,
  parseFeatureSet,
  resolveFeatures,
  type Feature,
  type FeatureSet,
} from '@whiteboard/shared';
import { requireTutor } from '../auth/middleware';
import { db } from '../db/client';
import { appSettings, boards } from '../db/schema';
import { env } from '../env';

/**
 * Which optional features a board offers (see `features.ts` in
 * @whiteboard/shared): the board's own set, else the tutor's defaults.
 */

const aiConfigured = () => Boolean(env.openRouterApiKey);

export async function readSetting(key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

/** The tutor's defaults, as a new board would get them. */
export async function defaultFeatures(): Promise<FeatureSet> {
  return resolveFeatures(await readSetting('features'), null, aiConfigured());
}

export async function featuresFor(boardId: string): Promise<FeatureSet> {
  const [defaults, [row]] = await Promise.all([
    readSetting('features'),
    db.select({ features: boards.features }).from(boards).where(eq(boards.id, boardId)),
  ]);
  return resolveFeatures(defaults, row?.features ?? null, aiConfigured());
}

/** A full set from a request body, or null when the body is not one. */
export function fullFeatureSet(value: unknown): FeatureSet | null {
  const parsed = parseFeatureSet(value);
  return Object.keys(parsed).length === Object.keys(ALL_FEATURES).length
    ? (parsed as FeatureSet)
    : null;
}

/**
 * Refuse a request on behalf of a board that has `feature` switched off. Runs
 * after the access gate, on the same board: the route's `:boardId`, else the
 * `X-Board-Id` header. Only the features that cost money or disk are enforced
 * here; the rest are hidden by the client and nothing more.
 */
export const requireFeature = (feature: Feature) =>
  createMiddleware(async (c, next) => {
    const boardId = c.req.param('boardId') ?? c.req.header('x-board-id');
    if (!boardId || !(await featuresFor(boardId))[feature]) {
      return c.json({ error: `${feature} is turned off on this board` }, 403);
    }
    await next();
  });

/** The tutor's defaults: `GET` / `PUT /api/settings/features`. */
export const settingsRoutes = new Hono();
settingsRoutes.use('*', requireTutor);

settingsRoutes.get('/features', async (c) => c.json(await defaultFeatures()));

settingsRoutes.put('/features', async (c) => {
  const set = fullFeatureSet(await c.req.json().catch(() => null));
  if (!set) return c.json({ error: 'a value for every feature is required' }, 400);
  await writeSetting('features', set);
  return c.json(await defaultFeatures());
});
