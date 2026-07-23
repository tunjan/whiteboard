import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageSession, writePageSession } from './page-session-state';

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

function uniqueBoard(label: string): string {
  return `page-session-${label}-${crypto.randomUUID()}`;
}

describe('page session state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  it('persists active pages independently per board', () => {
    const firstBoard = uniqueBoard('first');
    const secondBoard = uniqueBoard('second');

    writePageSession(firstBoard, 'page-a');
    writePageSession(secondBoard, 'page-b');

    expect(readPageSession(firstBoard)).toBe('page-a');
    expect(readPageSession(secondBoard)).toBe('page-b');
  });

  it('uses the board latest snapshot when this tab has no snapshot yet', () => {
    const boardId = uniqueBoard('latest');
    localStorage.setItem(
      `whiteboard:page-session:${boardId}:latest`,
      JSON.stringify({ version: 1, currentPageId: 'page-latest' }),
    );

    expect(readPageSession(boardId)).toBe('page-latest');
  });

  it('prefers this tab snapshot over a page last used in another tab', () => {
    const boardId = uniqueBoard('tab-priority');
    writePageSession(boardId, 'page-this-tab');
    localStorage.setItem(
      `whiteboard:page-session:${boardId}:latest`,
      JSON.stringify({ version: 1, currentPageId: 'page-other-tab' }),
    );

    expect(readPageSession(boardId)).toBe('page-this-tab');
  });

  it('rejects malformed and unsupported snapshots', () => {
    const malformedBoard = uniqueBoard('malformed');
    const futureBoard = uniqueBoard('future');
    localStorage.setItem(
      `whiteboard:page-session:${malformedBoard}:latest`,
      '{not-json',
    );
    localStorage.setItem(
      `whiteboard:page-session:${futureBoard}:latest`,
      JSON.stringify({ version: 2, currentPageId: 'page-future' }),
    );

    expect(readPageSession(malformedBoard)).toBeNull();
    expect(readPageSession(futureBoard)).toBeNull();
  });
});
