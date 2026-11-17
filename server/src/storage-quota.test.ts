import { describe, expect, it, vi } from 'vitest';
import { reserveStorage, StorageFullError } from './storage-quota';

vi.mock('./env', () => ({
  env: {
    blobDir: 'no-such-dir/blobs',
    docDir: 'no-such-dir/docs',
    uploadQuotaBytes: 100,
  },
}));

describe('reserveStorage', () => {
  it('counts concurrent reservations against each other', async () => {
    const results = await Promise.allSettled([
      reserveStorage(60),
      reserveStorage(60),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(
      StorageFullError,
    );
    // The refused 60 was not counted: exactly 40 is left.
    await expect(reserveStorage(40)).resolves.toBeUndefined();
    await expect(reserveStorage(1)).rejects.toBeInstanceOf(StorageFullError);
  });
});
