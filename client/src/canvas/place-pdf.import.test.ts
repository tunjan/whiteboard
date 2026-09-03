import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';

// Everything `placePdfFiles` reaches for outside its own module: the
// rasterizer (a browser canvas), the blob upload (the network), the document
// (Yjs), the toast host (React) and the range dialog (also React).
const h = vi.hoisted(() => ({
  pages: 3 as number,
  /** Page numbers whose render should reject, to exercise the skip path. */
  failing: new Set<number>(),
  openError: null as Error | null,
  rangeAnswer: null as { from: number; to: number } | null,
  rangeAsked: [] as { pageCount: number; limit: number }[],
  rendered: [] as number[],
  created: [] as Shape[],
  toasts: [] as { type?: string; description?: unknown }[],
  destroyed: 0,
  limit: 10,
}));

vi.mock('./pdf-render', () => ({
  openPdf: async () => {
    if (h.openError) throw h.openError;
    return {
      pageCount: h.pages,
      renderPage: async (n: number) => {
        if (h.failing.has(n)) throw new Error(`page ${n} is broken`);
        h.rendered.push(n);
        return {
          blob: new Blob(),
          worldW: 612,
          worldH: 792,
          rasterW: 1224,
          rasterH: 1584,
        };
      },
      destroy: async () => {
        h.destroyed++;
      },
    };
  },
}));

vi.mock('../board/blobs', () => ({
  uploadImageBlob: async () => `blob-${h.rendered.length}`,
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    add: (options: { type?: string; description?: unknown }) => {
      h.toasts.push(options);
      return 'toast-id';
    },
    update: () => {},
    close: () => {},
  },
}));

vi.mock('./use-document-store', () => ({
  breakUndoCapture: () => {},
  editor: {
    getShapes: () => [] as Shape[],
    createShape: (shape: Shape) => h.created.push(shape),
    transact: (fn: () => void) => fn(),
  },
}));

vi.mock('./use-canvas-ui-store', () => ({
  useCanvasUiStore: { getState: () => ({ pdfPageLimit: h.limit }) },
}));

vi.mock('./use-pdf-import-store', () => ({
  requestPageRange: async (req: { pageCount: number; limit: number }) => {
    h.rangeAsked.push({ pageCount: req.pageCount, limit: req.limit });
    return h.rangeAnswer;
  },
}));

import { placePdfFiles } from './place-pdf';

const AT = { x: 0, y: 0 };
const file = () =>
  new File([new Uint8Array([1])], 'notes.pdf', { type: 'application/pdf' });

beforeEach(() => {
  h.pages = 3;
  h.failing = new Set();
  h.openError = null;
  h.rangeAnswer = null;
  h.rangeAsked = [];
  h.rendered = [];
  h.created = [];
  h.toasts = [];
  h.destroyed = 0;
  h.limit = 10;
});

describe('placePdfFiles', () => {
  it('places every page when the document fits the limit, without asking', async () => {
    const ids = await placePdfFiles([file()], AT);

    expect(h.rangeAsked).toEqual([]);
    expect(h.rendered).toEqual([1, 2, 3]);
    expect(ids).toHaveLength(3);
    expect(h.created.map((s) => s.type)).toEqual(['image', 'image', 'image']);
  });

  it('asks for a range only when the document runs past the limit', async () => {
    h.pages = 40;
    h.limit = 10;
    h.rangeAnswer = { from: 5, to: 14 };

    await placePdfFiles([file()], AT);

    expect(h.rangeAsked).toEqual([{ pageCount: 40, limit: 10 }]);
    expect(h.rendered).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('creates nothing when the range dialog is cancelled', async () => {
    h.pages = 40;
    h.rangeAnswer = null;

    expect(await placePdfFiles([file()], AT)).toEqual([]);
    expect(h.created).toEqual([]);
    expect(h.rendered).toEqual([]);
  });

  it('gives every page a distinct, increasing z-index', async () => {
    await placePdfFiles([file()], AT);
    const indexes = h.created.map((s) => s.index);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect([...indexes].sort()).toEqual(indexes);
  });

  it('stacks the pages in a column and centres it on the point', async () => {
    await placePdfFiles([file()], AT);
    const ys = h.created.map((s) => s.y);

    expect(ys[1]! - ys[0]!).toBe(792 + 24);
    const height = 3 * 792 + 2 * 24;
    expect(ys[0]).toBe(-height / 2);
    expect(h.created.every((s) => s.x === -612 / 2)).toBe(true);
  });

  it('sizes a page in world units and records the raster as its natural size', async () => {
    h.pages = 1;
    await placePdfFiles([file()], AT);

    expect(h.created[0]!.props).toMatchObject({
      w: 612,
      h: 792,
      naturalWidth: 1224,
      naturalHeight: 1584,
    });
  });

  it('keeps the pages that worked when one fails, and says so', async () => {
    h.failing = new Set([2]);
    const ids = await placePdfFiles([file()], AT);

    expect(ids).toHaveLength(2);
    expect(h.toasts.some((t) => t.type === 'warning')).toBe(true);
  });

  it('reports an error and creates nothing when every page fails', async () => {
    h.failing = new Set([1, 2, 3]);

    expect(await placePdfFiles([file()], AT)).toEqual([]);
    expect(h.created).toEqual([]);
    expect(h.toasts.some((t) => t.type === 'error')).toBe(true);
  });

  it('surfaces an unopenable PDF as an error toast, not a throw', async () => {
    h.openError = new Error('That PDF is password-protected.');

    expect(await placePdfFiles([file()], AT)).toEqual([]);
    expect(h.toasts).toContainEqual(
      expect.objectContaining({
        type: 'error',
        description: 'That PDF is password-protected.',
      }),
    );
  });

  it('releases the document even when the import is cancelled', async () => {
    h.pages = 40;
    h.rangeAnswer = null;

    await placePdfFiles([file()], AT);
    expect(h.destroyed).toBe(1);
  });

  it('cascades a second document instead of burying it under the first', async () => {
    h.pages = 1;
    await placePdfFiles([file(), file()], AT);

    expect(h.created).toHaveLength(2);
    expect(h.created[1]!.x).toBe(h.created[0]!.x + 40);
    expect(h.created[1]!.y).toBe(h.created[0]!.y + 40);
  });
});
