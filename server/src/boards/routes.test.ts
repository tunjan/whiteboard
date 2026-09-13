import { describe, expect, it, vi } from 'vitest';

/**
 * The auth boundary, and only that. Board management is tutor-only, but the
 * board's *name* is not: a student following a share link has to be told which
 * board they just opened, and the board id they already hold is a strictly
 * larger capability than its title.
 */

const rows = vi.hoisted(() => ({ value: [] as { name: string }[] }));

// One chainable stub for `db.select().from().where()`, which is the only shape
// the route under test uses.
vi.mock('../db/client', () => {
  const where = () => Promise.resolve(rows.value);
  return { db: { select: () => ({ from: () => ({ where }) }) } };
});

import { boardRoutes } from './routes';

describe('GET /:id/title', () => {
  it('serves the name without a tutor session', async () => {
    rows.value = [{ name: 'Algebra — Week 4' }];
    const res = await boardRoutes.request('/board-1/title');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Algebra — Week 4' });
  });

  it('404s for a board that does not exist', async () => {
    rows.value = [];
    expect((await boardRoutes.request('/board-missing/title')).status).toBe(
      404,
    );
  });
});

describe('the tutor guard', () => {
  it('still rejects the tutor-only routes without a session', async () => {
    for (const path of ['/', '/board-1/notes', '/board-1/sessions']) {
      expect((await boardRoutes.request(path)).status).toBe(401);
    }
  });
});
