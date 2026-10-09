import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DOCUMENT_MIME } from '@whiteboard/shared';
import { env } from '../env';
import { reserveStorage } from '../storage-quota';

const DOC_ROOT = resolve(env.docDir);

// A document id is `<64-hex-sha256>.<ext>` — content-addressed, so identical
// uploads dedupe across boards and can be cached immutably.
const ID_RE = new RegExp(`^[a-f0-9]{64}\\.(${Object.keys(DOCUMENT_MIME).join('|')})$`);

export function isValidDocId(id: string): boolean {
  return ID_RE.test(id);
}

export function extForDocId(id: string): string {
  return id.split('.').pop() ?? '';
}

async function ensureDir(): Promise<void> {
  if (!existsSync(DOC_ROOT)) await mkdir(DOC_ROOT, { recursive: true });
}

/** Store bytes content-addressed; returns the document id (sha256 + ext). */
export async function saveDoc(bytes: Buffer, ext: string): Promise<string> {
  if (!DOCUMENT_MIME[ext]) throw new Error(`Unsupported type: ${ext}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `${hash}.${ext}`;
  await ensureDir();
  const path = join(DOC_ROOT, id);
  if (!existsSync(path)) {
    await reserveStorage(bytes.byteLength);
    await writeFile(path, bytes);
  }
  return id;
}

/** Read a stored document by id, or null if missing/invalid. */
export async function readDoc(id: string): Promise<Buffer | null> {
  if (!isValidDocId(id)) return null;
  const path = join(DOC_ROOT, id);
  // `id` is validated to a sha+ext, so it cannot escape DOC_ROOT.
  if (!existsSync(path)) return null;
  return readFile(path);
}
