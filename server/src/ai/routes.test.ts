import { describe, expect, it, vi } from 'vitest';
import {
  MAX_AUDIO_CHARS,
  MAX_INK_IMAGE_CHARS,
  MAX_LATEX_PROMPT_CHARS,
} from '@whiteboard/shared';
import { aiRoutes } from './routes';

// Board access has its own suite (boards/routes.test.ts); here every request
// is one a board editor sent.
vi.mock('../boards/access', () => ({
  requireBoardEdit: async (_c: unknown, next: () => Promise<void>) => next(),
}));

/**
 * Request validation only — every case here is rejected before a model is
 * reached, so the suite never spends credit and never depends on whether the
 * machine running it has a key configured.
 */

// `async` rather than a bare return: `Hono.request` is typed
// `Response | Promise<Response>`, and awaiting is what collapses the union.
async function post(path: string, body: unknown): Promise<Response> {
  return aiRoutes.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /config', () => {
  it('reports whether the feature is configured', async () => {
    const res = await aiRoutes.request('/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: expect.any(Boolean) });
  });
});

describe('POST /latex/ink', () => {
  it('rejects a missing image', async () => {
    expect((await post('/latex/ink', {})).status).toBe(400);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await aiRoutes.request('/latex/ink', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  // Only PNG data URLs: anything else is either a format the raster path never
  // produces, or a `http(s)` URL that would make the server fetch a caller's
  // address on their behalf.
  it.each([
    'https://example.com/a.png',
    'data:image/svg+xml;base64,AAAA',
    'data:text/html;base64,AAAA',
  ])('rejects %s', async (image) => {
    expect((await post('/latex/ink', { image })).status).toBe(400);
  });

  it('rejects an oversized image', async () => {
    const image = `data:image/png;base64,${'A'.repeat(MAX_INK_IMAGE_CHARS)}`;
    expect((await post('/latex/ink', { image })).status).toBe(413);
  });

  // The declared length is checked before the body is read, so an honest
  // header short-circuits the upload rather than buffering it to reject it.
  it('rejects an oversized declared body without reading it', async () => {
    const res = await aiRoutes.request('/latex/ink', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(MAX_INK_IMAGE_CHARS * 2),
      },
      body: JSON.stringify({ image: 'data:image/png;base64,AAAA' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('POST /latex/prompt', () => {
  it.each([{}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }])(
    'rejects %j',
    async (body) => {
      expect((await post('/latex/prompt', body)).status).toBe(400);
    },
  );

  it('rejects a description past the length cap', async () => {
    const prompt = 'x'.repeat(MAX_LATEX_PROMPT_CHARS + 1);
    expect((await post('/latex/prompt', { prompt })).status).toBe(400);
  });
});

describe('POST /transcribe', () => {
  it.each([{}, { audio: 'AAAA' }, { audio: 'AAAA', format: 'wav' }, { audio: '', format: 'webm' }])(
    'rejects %j',
    async (body) => {
      expect((await post('/transcribe', body)).status).toBe(400);
    },
  );

  it('rejects an oversized clip', async () => {
    const audio = 'A'.repeat(MAX_AUDIO_CHARS + 1);
    expect((await post('/transcribe', { audio, format: 'webm' })).status).toBe(413);
  });
});
