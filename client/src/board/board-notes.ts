// Tutor-only private notes about the student. Deliberately separate from
// BoardRepository / the boards-cache: these notes must never be persisted on a
// shared or student machine, so we fetch on demand and never cache them.

export type BoardNotes = {
  notes: string;
  errorLog: string;
};

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/boards${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function getBoardNotes(id: string): Promise<BoardNotes> {
  const res = await api(`/${encodeURIComponent(id)}/notes`);
  if (!res.ok) return { notes: '', errorLog: '' };
  const body = (await res.json()) as { notes?: string; errorLog?: string };
  return { notes: asString(body.notes), errorLog: asString(body.errorLog) };
}

export async function saveBoardNotes(
  id: string,
  value: BoardNotes,
): Promise<void> {
  await api(`/${encodeURIComponent(id)}/notes`, {
    method: 'PUT',
    body: JSON.stringify(value),
  });
}

/** One session's notes, keyed by the day it was taught ('YYYY-MM-DD'). */
export type SessionNote = {
  date: string;
  body: string;
};

/** Today in the tutor's own calendar — the key a new session note gets. */
export function todayKey(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Newest first, matching the server's ordering. */
export async function getSessionNotes(id: string): Promise<SessionNote[]> {
  const res = await api(`/${encodeURIComponent(id)}/sessions`);
  if (!res.ok) return [];
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body.map((row) => ({
    date: asString((row as SessionNote).date),
    body: asString((row as SessionNote).body),
  }));
}

export async function saveSessionNote(
  id: string,
  date: string,
  body: string,
): Promise<void> {
  await api(`/${encodeURIComponent(id)}/sessions/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  });
}

export async function deleteSessionNote(
  id: string,
  date: string,
): Promise<void> {
  await api(`/${encodeURIComponent(id)}/sessions/${encodeURIComponent(date)}`, {
    method: 'DELETE',
  });
}
