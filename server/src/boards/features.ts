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
import { currentTutor, requireTutor } from '../auth/middleware';
import type { Tutor } from '../auth/tutors';
import { db } from '../db/client';
import { appSettings, boards, tutors } from '../db/schema';
import { env } from '../env';

/**
 * Which optional features a board offers (see `features.ts` in
 * @whiteboard/shared): the board's own set, else its tutor's defaults.
 */

/**
 * Whether AI can run for a tutor's boards: the server has a key, and — where
 * the Pro plan is sold — the tutor is on it (or runs the server).
 */
export function aiAllowed(tutor: Pick<Tutor, 'plan' | 'isAdmin'> | null | undefined): boolean {
  if (!env.openRouterApiKey) return false;
  if (!env.stripeSecretKey) return true;
  return tutor?.plan === 'pro' || tutor?.isAdmin === true;
}

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

/** A tutor's defaults, as a new board of theirs gets them. */
export function defaultFeatures(tutor: Tutor): FeatureSet {
  return resolveFeatures(tutor.features, null, aiAllowed(tutor));
}

export async function featuresFor(boardId: string): Promise<FeatureSet> {
  const [row] = await db
    .select({
      board: boards.features,
      defaults: tutors.features,
      plan: tutors.plan,
      isAdmin: tutors.isAdmin,
    })
    .from(boards)
    .leftJoin(tutors, eq(tutors.id, boards.tutorId))
    .where(eq(boards.id, boardId));
  return resolveFeatures(
    row?.defaults,
    row?.board ?? null,
    aiAllowed(row?.plan == null ? null : { plan: row.plan, isAdmin: row.isAdmin ?? false }),
  );
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

settingsRoutes.get('/features', (c) => c.json(defaultFeatures(currentTutor(c))));

settingsRoutes.put('/features', async (c) => {
  const set = fullFeatureSet(await c.req.json().catch(() => null));
  if (!set) return c.json({ error: 'a value for every feature is required' }, 400);
  const [tutor] = await db
    .update(tutors)
    .set({ features: set })
    .where(eq(tutors.id, currentTutor(c).id))
    .returning();
  return c.json(defaultFeatures(tutor!));
});
