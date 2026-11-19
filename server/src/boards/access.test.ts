import { describe, expect, it, vi } from 'vitest';

// Each test's board: who owns it and what its link grants.
const board = vi.hoisted(() => ({
  value: { tutorId: 't1' as string | null, shareKey: 'key-1', shareMode: 'edit' },
}));

vi.mock('../db/client', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [board.value] }) }) },
}));

// A cookie names its tutor; `jwt.ts` has the real check.
vi.mock('../auth/jwt', () => ({
  verifySession: async (token: string) =>
    token.startsWith('cookie-') ? { id: token.slice('cookie-'.length) } : null,
}));

import { boardAccess } from './access';

describe('boardAccess between tutors', () => {
  it("makes the board's own tutor its tutor", async () => {
    expect(await boardAccess('b', undefined, 'cookie-t1')).toBe('tutor');
  });

  it("gives another tutor nothing without the link, and only the link's grant with it", async () => {
    expect(await boardAccess('b', undefined, 'cookie-t2')).toBeNull();
    expect(await boardAccess('b', 'key-1', 'cookie-t2')).toBe('edit');
  });

  it('makes nobody the tutor of the ownerless demo board', async () => {
    board.value = { tutorId: null, shareKey: 'key-1', shareMode: 'edit' };
    expect(await boardAccess('b', undefined, 'cookie-t1')).toBeNull();
    expect(await boardAccess('b', 'key-1', 'cookie-t1')).toBe('edit');
  });
});
