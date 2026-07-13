import type { AnimationRecordingV1 } from '@whiteboard/shared';
import {
  clearLegacyAnimationRecordings,
  readLegacyAnimationRecordings,
  useDocumentStore,
} from '@/canvas/use-document-store';
import { refreshRecordingsLibrary, uploadRecording } from './recordings-api';

// One-time migration of recordings that older clients stored inside the Yjs
// doc ('animations' map) into the server-side library. Runs on the tutor
// client only; the map is cleared only after every upload succeeds, so a
// failed attempt is simply retried the next time the map syncs in.

/**
 * Deterministic id (matches the server's accepted id pattern) so retries and
 * concurrent tutor tabs upsert the same row instead of duplicating it.
 */
function legacyRecordingId(
  boardId: string,
  recording: AnimationRecordingV1,
): string {
  const seed = `${boardId}:${recording.pageId}:${recording.createdAt}`;
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    a = (a * 33) ^ ch;
    b = (b * 31) ^ ch;
  }
  return `mig${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

let migrating = false;

export async function migrateLegacyRecordings(boardId: string): Promise<void> {
  if (migrating) return;
  const legacy = readLegacyAnimationRecordings();
  if (legacy.length === 0) return;
  migrating = true;
  try {
    const pages = useDocumentStore.getState().doc.pages;
    for (const recording of legacy) {
      const pageName = pages[recording.pageId]?.name ?? 'deleted page';
      await uploadRecording(boardId, {
        id: legacyRecordingId(boardId, recording),
        name: `Migrated recording · ${pageName}`,
        recording,
      });
    }
    clearLegacyAnimationRecordings();
    await refreshRecordingsLibrary(boardId);
  } catch {
    // Leave the legacy map intact; the next sync/load retries the migration.
  } finally {
    migrating = false;
  }
}
