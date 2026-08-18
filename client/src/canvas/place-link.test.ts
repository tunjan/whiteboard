import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkShape, LinkUnfurl } from '@whiteboard/shared';
import './shapes/register';
import { placeLinkUrls } from './place-link';
import { breakUndoCapture, editor, loadBoard, undo } from './use-document-store';

// Driven against the real Yjs-backed editor (like the eraser suite) so the
// optimistic create, the background patch and the undo grouping are exercised
// together rather than against a fake document.

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

function bookmarks(): BookmarkShape[] {
  return editor
    .getShapes()
    .filter((s): s is BookmarkShape => s.type === 'bookmark');
}

function shape(id: string): BookmarkShape {
  const found = editor.getShape(id);
  if (found?.type !== 'bookmark') throw new Error('not a bookmark');
  return found;
}

/** Stub the unfurl endpoint with a fixed response. */
function respondWith(meta: LinkUnfurl | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (meta instanceof Error) throw meta;
    return { ok: true, json: async () => meta } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  dispose = loadBoard('test-links', { persist: false, collab: false });
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

describe('placeLinkUrls', () => {
  it('creates a card synchronously, before any metadata arrives', () => {
    respondWith({ url: 'https://a.example/1' });
    const [id] = placeLinkUrls(['https://a.example/1'], { x: 0, y: 0 });

    const card = shape(id!);
    expect(card.props.url).toBe('https://a.example/1');
    expect(card.props.status).toBe('loading');
    expect(card.props.title).toBeUndefined();
  });

  it('centers a single card on the paste point', () => {
    respondWith({ url: 'https://a.example/2' });
    const [id] = placeLinkUrls(['https://a.example/2'], { x: 500, y: 200 });

    const card = shape(id!);
    expect(card.x + card.props.w / 2).toBeCloseTo(500);
    expect(card.y + card.props.h / 2).toBeCloseTo(200);
  });

  it('centers a multi-link paste as one row', () => {
    respondWith({ url: 'https://a.example/x' });
    const ids = placeLinkUrls(
      ['https://a.example/3', 'https://b.example/3', 'https://c.example/3'],
      { x: 100, y: 50 },
    );
    expect(ids).toHaveLength(3);

    const cards = ids.map(shape);
    const minX = Math.min(...cards.map((c) => c.x));
    const maxX = Math.max(...cards.map((c) => c.x + c.props.w));
    expect((minX + maxX) / 2).toBeCloseTo(100);
    for (const card of cards) {
      expect(card.y + card.props.h / 2).toBeCloseTo(50);
    }
    // Laid out side by side, not stacked on top of each other.
    const lefts = cards.map((c) => c.x).sort((a, b) => a - b);
    expect(lefts[1]! - lefts[0]!).toBeGreaterThanOrEqual(cards[0]!.props.w);
  });

  it('wraps a long list into rows instead of one wide strip', () => {
    respondWith({ url: 'https://a.example/x' });
    const ids = placeLinkUrls(
      Array.from({ length: 6 }, (_, i) => `https://wrap${i}.example/`),
      { x: 0, y: 0 },
    );

    const cards = ids.map(shape);
    const rows = new Set(cards.map((c) => c.y));
    expect(rows.size).toBe(2);
    // Four in the first row, two in the second.
    const top = Math.min(...rows);
    expect(cards.filter((c) => c.y === top)).toHaveLength(4);
  });

  it('fills in the metadata that comes back', async () => {
    respondWith({
      url: 'https://a.example/4',
      title: 'A title',
      description: 'A description',
      imageBlobId: 'abc.png',
      faviconBlobId: 'def.png',
    });
    const [id] = placeLinkUrls(['https://a.example/4'], { x: 0, y: 0 });

    await vi.waitFor(() => expect(shape(id!).props.status).toBe('ready'));
    const card = shape(id!);
    expect(card.props.title).toBe('A title');
    expect(card.props.description).toBe('A description');
    expect(card.props.imageBlobId).toBe('abc.png');
    expect(card.props.faviconBlobId).toBe('def.png');
  });

  it('shrinks a card whose link has no preview image or title', async () => {
    respondWith({ url: 'https://a.example/5' });
    const [id] = placeLinkUrls(['https://a.example/5'], { x: 0, y: 0 });
    const initialHeight = shape(id!).props.h;

    await vi.waitFor(() => expect(shape(id!).props.status).toBe('ready'));
    expect(shape(id!).props.h).toBeLessThan(initialHeight);
  });

  it('settles the card even when the unfurl fails', async () => {
    respondWith(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [id] = placeLinkUrls(['https://a.example/6'], { x: 0, y: 0 });

    await vi.waitFor(() => expect(shape(id!).props.status).toBe('ready'));
    expect(shape(id!).props.url).toBe('https://a.example/6');
  });

  it('reuses a link it already unfurled, with no second request', async () => {
    const fetchMock = respondWith({
      url: 'https://cached.example/',
      title: 'Cached',
    });
    const [first] = placeLinkUrls(['https://cached.example/'], { x: 0, y: 0 });
    await vi.waitFor(() => expect(shape(first!).props.status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The second paste renders complete straight away — no loading state.
    const [second] = placeLinkUrls(['https://cached.example/'], { x: 0, y: 0 });
    expect(shape(second!).props.status).toBe('ready');
    expect(shape(second!).props.title).toBe('Cached');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes a link an existing shape handles to that shape', () => {
    respondWith({ url: 'https://a.example/7' });
    const ids = placeLinkUrls(
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
      { x: 0, y: 0 },
    );
    expect(editor.getShape(ids[0]!)?.type).toBe('video');
    expect(bookmarks()).toHaveLength(0);
  });

  it('ignores urls that are not http(s)', () => {
    respondWith({ url: 'x' });
    expect(placeLinkUrls(['javascript:alert(1)'], { x: 0, y: 0 })).toEqual([]);
    expect(bookmarks()).toHaveLength(0);
  });

  it('undoes a paste in one step, metadata included', async () => {
    respondWith({ url: 'https://a.example/8', title: 'Undo me' });
    breakUndoCapture();
    const ids = placeLinkUrls(
      ['https://a.example/8', 'https://b.example/8'],
      { x: 0, y: 0 },
    );
    breakUndoCapture();
    await vi.waitFor(() =>
      ids.forEach((id) => expect(shape(id).props.status).toBe('ready')),
    );

    undo();
    expect(bookmarks()).toHaveLength(0);
  });
});
