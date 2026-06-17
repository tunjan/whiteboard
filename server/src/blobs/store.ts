import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '../env';

// Raster types only — SVG is excluded so a stored blob can never execute
// script when opened same-origin.
export const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_MIME).map(([mime, ext]) => [ext, mime]),
);

/** Max upload size (post-compression) in bytes. */
export const MAX_BLOB_BYTES = 12 * 1024 * 1024;

const BLOB_ROOT = resolve(env.blobDir);

// A blob id is `<64-hex-sha256>.<ext>` — content-addressed, so identical
// uploads dedupe and can be cached immutably.
const ID_RE = /^[a-f0-9]{64}\.(png|jpg|webp|gif)$/;

export function isValidBlobId(id: string): boolean {
  return ID_RE.test(id);
}

export function mimeForBlobId(id: string): string | null {
  const ext = id.split('.').pop() ?? '';
  return EXT_MIME[ext] ?? null;
}

async function ensureDir(): Promise<void> {
  if (!existsSync(BLOB_ROOT)) await mkdir(BLOB_ROOT, { recursive: true });
}

/** Store bytes content-addressed; returns the blob id (sha256 + ext). */
export async function saveBlob(bytes: Buffer, mime: string): Promise<string> {
  const ext = ALLOWED_MIME[mime];
  if (!ext) throw new Error(`Unsupported type: ${mime}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `${hash}.${ext}`;
  await ensureDir();
  const path = join(BLOB_ROOT, id);
  if (!existsSync(path)) await writeFile(path, bytes);
  return id;
}

/** Read a stored blob by id, or null if missing/invalid. */
export async function readBlob(id: string): Promise<Buffer | null> {
  if (!isValidBlobId(id)) return null;
  const path = join(BLOB_ROOT, id);
  // `id` is validated to a sha+ext, so it cannot escape BLOB_ROOT.
  if (!existsSync(path)) return null;
  return readFile(path);
}
