import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from './env';

/** The open upload stores are full; routes answer 507. */
export class StorageFullError extends Error {}

let used: Promise<number> | null = null;

async function dirBytes(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const sizes = await Promise.all(
    names.map((n) => stat(join(dir, n)).then((s) => s.size, () => 0)),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/**
 * Count `bytes` against the upload quota before they are written, or throw.
 * The total is measured from disk once and kept as a running sum after that.
 */
export async function reserveStorage(bytes: number): Promise<void> {
  used ??= Promise.all([
    dirBytes(resolve(env.blobDir)),
    dirBytes(resolve(env.docDir)),
  ]).then(([a, b]) => a + b);
  const total = await used;
  if (total + bytes > env.uploadQuotaBytes) throw new StorageFullError();
  used = Promise.resolve(total + bytes);
}
