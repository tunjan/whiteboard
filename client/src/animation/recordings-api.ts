import {
  type AnimationRecordingV1,
  type RecordingMeta,
  isAnimationRecording,
} from '@whiteboard/shared';
import { useAnimationStore } from './use-animation-store';

// REST client for the server-side recordings library. Reads are open (board id
// is the capability); creating and deleting recordings is tutor-only.

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/recordings${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export async function listRecordings(boardId: string): Promise<RecordingMeta[]> {
  const res = await api(`/${encodeURIComponent(boardId)}`);
  if (!res.ok) throw new Error(`Failed to list recordings (${res.status})`);
  return (await res.json()) as RecordingMeta[];
}

/** Fetch the library and publish it to the animation store. */
export async function refreshRecordingsLibrary(boardId: string): Promise<void> {
  const library = await listRecordings(boardId);
  useAnimationStore.getState().setLibrary(library);
}

// Payloads are immutable and can be several MB — dedupe concurrent fetches.
const inFlight = new Map<string, Promise<AnimationRecordingV1 | null>>();

export function fetchRecordingPayload(
  boardId: string,
  id: string,
): Promise<AnimationRecordingV1 | null> {
  const key = `${boardId}/${id}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      const res = await api(
        `/${encodeURIComponent(boardId)}/${encodeURIComponent(id)}`,
      );
      if (!res.ok) return null;
      const payload = (await res.json()) as unknown;
      if (!isAnimationRecording(payload)) return null;
      useAnimationStore.getState().addPayload(id, payload);
      return payload;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}

export async function uploadRecording(
  boardId: string,
  entry: { id: string; name: string; recording: AnimationRecordingV1 },
): Promise<RecordingMeta> {
  const res = await api(`/${encodeURIComponent(boardId)}`, {
    method: 'POST',
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Failed to save recording (${res.status})`);
  return (await res.json()) as RecordingMeta;
}

export async function deleteRecording(
  boardId: string,
  id: string,
): Promise<void> {
  const res = await api(
    `/${encodeURIComponent(boardId)}/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`Failed to delete recording (${res.status})`);
}
