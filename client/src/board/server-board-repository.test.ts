import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerBoardRepository } from './server-board-repository';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

const outbox = () =>
  JSON.parse(localStorage.getItem('whiteboard:boards-outbox') ?? '[]');

let fetchMock: ReturnType<typeof vi.fn>;
let status: number;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  status = 200;
  fetchMock = vi.fn(async () => ({ status, ok: status < 400 }) as Response);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('ServerBoardRepository', () => {
  it('keeps a queued mutation when the server errors', async () => {
    const repo = new ServerBoardRepository();
    status = 502;
    await repo.create('A board');
    expect(outbox()).toHaveLength(1);

    status = 200;
    await repo.flush();
    expect(outbox()).toHaveLength(0);
  });

  it('sends a rename for a board this browser never listed', async () => {
    await new ServerBoardRepository().rename('b2', 'New name');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/boards',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'b2', name: 'New name' }),
      }),
    );
    // No invented cache entry for the home list to sort.
    expect(localStorage.getItem('whiteboard:boards-cache')).toBeNull();
  });

  it("deletes each page's local cache with the board's", async () => {
    const deleted: string[] = [];
    vi.stubGlobal('indexedDB', {
      deleteDatabase: (name: string) => deleted.push(name),
      databases: async () => [
        { name: 'whiteboard:board:b3' },
        { name: 'whiteboard:board:b3/pages/p1' },
        { name: 'whiteboard:board:b3/pages/p2' },
        { name: 'whiteboard:board:b4/pages/p1' },
      ],
    });
    await new ServerBoardRepository().delete('b3');
    await vi.waitFor(() =>
      expect(deleted.sort()).toEqual([
        'whiteboard:board:b3',
        'whiteboard:board:b3/pages/p1',
        'whiteboard:board:b3/pages/p2',
      ]),
    );
  });
});
