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
