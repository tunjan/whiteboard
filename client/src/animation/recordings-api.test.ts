import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimationRecordingV1 } from '@whiteboard/shared';
import {
  fetchRecordingPayload,
  listRecordings,
  uploadRecording,
} from './recordings-api';
import { useAnimationStore } from './use-animation-store';

const validRecording: AnimationRecordingV1 = {
  version: 1,
  pageId: 'page-default',
  createdAt: 1,
  durationMs: 1000,
  initialShapes: [],
  initialViewport: { x: 0, y: 0, z: 1, width: 800, height: 600 },
  frames: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('recordings api', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    useAnimationStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('uploads with the minted id and recording payload', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'rec-1',
        boardId: 'b1',
        pageId: 'page-default',
        name: 'Lesson',
        durationMs: 1000,
        createdAt: 5,
      }),
    );
    const meta = await uploadRecording('b1', {
      id: 'rec-1',
      name: 'Lesson',
      recording: validRecording,
    });
    expect(meta.id).toBe('rec-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/recordings/b1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      id: 'rec-1',
      name: 'Lesson',
      recording: { version: 1, pageId: 'page-default' },
    });
  });

  it('throws on a failed upload so the dialog can offer retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 401));
    await expect(
      uploadRecording('b1', {
        id: 'rec-1',
        name: 'Lesson',
        recording: validRecording,
      }),
    ).rejects.toThrow();
  });

  it('lists recording metadata', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'rec-1' }]));
    const list = await listRecordings('b1');
    expect(list).toEqual([{ id: 'rec-1' }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/recordings/b1');
  });

  it('caches a fetched payload and rejects malformed ones', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validRecording));
    const payload = await fetchRecordingPayload('b1', 'rec-1');
    expect(payload).toEqual(validRecording);
    expect(useAnimationStore.getState().payloads['rec-1']).toEqual(
      validRecording,
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ nonsense: true }));
    expect(await fetchRecordingPayload('b1', 'rec-bad')).toBeNull();
    expect(useAnimationStore.getState().payloads['rec-bad']).toBeUndefined();
  });

  it('dedupes concurrent fetches of the same payload', async () => {
    let release: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const first = fetchRecordingPayload('b1', 'rec-1');
    const second = fetchRecordingPayload('b1', 'rec-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release!(jsonResponse(validRecording));
    expect(await first).toEqual(validRecording);
    expect(await second).toEqual(validRecording);
  });
});
