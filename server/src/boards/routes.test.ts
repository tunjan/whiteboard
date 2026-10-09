import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

/**
 * The auth boundary, and only that. Board management is tutor-only, but the
 * board's *name* is not: a student following a share link has to be told which
 * board they just opened, and the link they hold is a strictly larger
 * capability than its title.
 */

const rows = vi.hoisted(() => ({ value: [] as Record<string, string>[] }));

// One chainable stub for `db.select().from().where()`, which is the only shape
// the route under test uses.
vi.mock('../db/client', () => {
  const where = () => Promise.resolve(rows.value);
  return { db: { select: () => ({ from: () => ({ where }) }) } };
});

import { boardRoutes } from './routes';
import { requireBoardEdit, sessionFromHeaders } from './access';

describe('GET /:id/title', () => {
  const board = (shareMode: string) => ({
    name: 'Algebra — Week 4',
    shareKey: 'key-1',
    shareMode,
  });

  it('serves the name to a student link without a tutor session', async () => {
    rows.value = [board('view')];
    const res = await boardRoutes.request('/board-1/title?k=key-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Algebra — Week 4' });
  });

  it('404s without the key, with a stale key, and with the link off', async () => {
    rows.value = [board('edit')];
    expect((await boardRoutes.request('/board-1/title')).status).toBe(404);
    expect((await boardRoutes.request('/board-1/title?k=old')).status).toBe(404);
    rows.value = [board('off')];
    expect((await boardRoutes.request('/board-1/title?k=key-1')).status).toBe(404);
  });

  it('404s for a board that does not exist', async () => {
    rows.value = [];
    expect((await boardRoutes.request('/board-missing/title?k=key-1')).status).toBe(
      404,
    );
  });
});

describe('requireBoardEdit', () => {
  const app = new Hono().post('/:boardId', requireBoardEdit, (c) => c.text('ok'));
  const post = (key: string) =>
    app.request('/board-1', { method: 'POST', headers: { 'x-board-key': key } });

  it('lets an edit link through and stops a view link', async () => {
    rows.value = [{ shareKey: 'key-1', shareMode: 'edit' }];
    expect((await post('key-1')).status).toBe(200);
    expect((await post('nope')).status).toBe(403);
    rows.value = [{ shareKey: 'key-1', shareMode: 'view' }];
    expect((await post('key-1')).status).toBe(403);
  });
});

describe('the tutor guard', () => {
  it('still rejects the tutor-only routes without a session', async () => {
    for (const path of [
      '/',
      '/live',
      '/board-1/notes',
      '/board-1/sessions',
      '/board-1/access',
    ]) {
      expect((await boardRoutes.request(path)).status).toBe(401);
    }
    expect(
      (await boardRoutes.request('/import', { method: 'POST' })).status,
    ).toBe(401);
  });
});

describe('sessionFromHeaders', () => {
  it('reads the cookie from a fetch Headers and from a Node header object', () => {
    expect(sessionFromHeaders(new Headers({ cookie: 'a=1; wb_session=tok' }))).toBe('tok');
    expect(sessionFromHeaders({ cookie: 'wb_session=tok; b=2' })).toBe('tok');
    expect(sessionFromHeaders({})).toBeUndefined();
  });
});
