import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/blob-routes-test-${process.pid}`;
  process.env.BLOB_DIR = `${dir}/blobs`;
});

import { parseRange, blobRoutes } from './routes';
import { saveBlob } from './store';

describe('parseRange', () => {
  it('reads open, closed and suffix ranges, clamped to the file', () => {
    expect(parseRange('bytes=0-', 100)).toEqual([0, 99]);
    expect(parseRange('bytes=10-19', 100)).toEqual([10, 19]);
    expect(parseRange('bytes=90-500', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=-500', 100)).toEqual([0, 99]);
  });

  it('rejects what it cannot satisfy', () => {
    expect(parseRange('bytes=100-', 100)).toBeNull();
    expect(parseRange('bytes=20-10', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBeNull();
  });
});

describe('GET /:id', () => {
  it('serves a stored video by byte range', async () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const id = await saveBlob(bytes, 'video/mp4');
    expect(id).toMatch(/\.mp4$/);

    const part = await blobRoutes.request(`/${id}`, {
      headers: { range: 'bytes=10-19' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-type')).toBe('video/mp4');
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);

    const past = await blobRoutes.request(`/${id}`, {
      headers: { range: 'bytes=5000-' },
    });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */1000');

    const whole = await blobRoutes.request(`/${id}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect((await whole.arrayBuffer()).byteLength).toBe(1000);
  });
});
