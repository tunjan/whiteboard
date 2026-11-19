import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { ALL_FEATURES, resolveFeatures } from '@whiteboard/shared';
import { requireFeature } from './features';

// What the two tables hold for this test: the tutor's defaults and the board's
// own set. `select().from(table).where()` answers by table.
const stored = vi.hoisted(() => ({
  defaults: undefined as unknown,
  board: null as unknown,
}));

vi.mock('../db/client', async () => {
  const { appSettings } = await import('../db/schema');
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () =>
            table === appSettings
              ? stored.defaults === undefined
                ? []
                : [{ value: stored.defaults }]
              : [{ features: stored.board }],
        }),
      }),
    },
  };
});

vi.mock('../env', async (actual) => ({
  env: { ...(await actual<typeof import('../env')>()).env, openRouterApiKey: 'test-key' },
}));

describe('resolveFeatures', () => {
  it('offers everything with no defaults and no board set', () => {
    expect(resolveFeatures(undefined, null, true)).toEqual(ALL_FEATURES);
  });

  it("follows the tutor's defaults when the board has no set", () => {
    expect(resolveFeatures({ graphs: false }, null, true).graphs).toBe(false);
  });

  it("lets the board's own set win over the defaults", () => {
    const board = { ...ALL_FEATURES, graphs: true };
    expect(resolveFeatures({ graphs: false }, board, true).graphs).toBe(true);
  });

  it('turns AI off when the server has no key, whatever the sets say', () => {
    expect(resolveFeatures({ ai: true }, { ...ALL_FEATURES, ai: true }, false).ai).toBe(false);
  });

  it('ignores unknown keys and non-boolean values', () => {
    const resolved = resolveFeatures({ graphs: 'no', bogus: false }, null, true);
    expect(resolved).toEqual(ALL_FEATURES);
  });
});

describe('requireFeature', () => {
  const app = new Hono();
  app.post('/ai', requireFeature('ai'), (c) => c.json({ ok: true }));
  const post = () => app.request('/ai', { method: 'POST', headers: { 'x-board-id': 'b1' } });

  it('lets a request through when the board offers the feature', async () => {
    stored.defaults = undefined;
    stored.board = null;
    expect((await post()).status).toBe(200);
  });

  it("refuses it when the tutor's defaults turn the feature off", async () => {
    stored.defaults = { ai: false };
    stored.board = null;
    expect((await post()).status).toBe(403);
  });

  it('refuses it when the board turns the feature off', async () => {
    stored.defaults = undefined;
    stored.board = { ...ALL_FEATURES, ai: false };
    expect((await post()).status).toBe(403);
  });

  it('refuses a request that names no board', async () => {
    stored.defaults = undefined;
    stored.board = null;
    const res = await app.request('/ai', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});
