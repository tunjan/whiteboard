// Tutor-only private notes about the student. Deliberately separate from
// BoardRepository / the boards-cache: these notes must never be persisted on a
// shared or student machine, so we fetch on demand and never cache them.

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/boards${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

export async function getBoardNotes(id: string): Promise<string> {
  const res = await api(`/${encodeURIComponent(id)}/notes`);
  if (!res.ok) return '';
  const body = (await res.json()) as { notes?: string };
  return typeof body.notes === 'string' ? body.notes : '';
}

export async function saveBoardNotes(id: string, notes: string): Promise<void> {
  await api(`/${encodeURIComponent(id)}/notes`, {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  });
}
