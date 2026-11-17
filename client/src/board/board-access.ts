import { create } from 'zustand';
import type { AgentHelp, BoardShare, ShareMode } from '@whiteboard/shared';
import { parseBoardId } from '@/router';

/**
 * What this client may do on the open board, as the collaboration server last
 * said. The server is the authority (it refuses a view-only connection's
 * updates); this is what the UI follows so it never offers what will be
 * refused.
 *
 * - `pending`: not yet answered — editing is not held back meanwhile, since a
 *   board can be drawn on offline and synced later.
 * - `denied`: the link was reset or turned off.
 * - `removed`: the tutor took this student out of the room.
 */
export type BoardAccess = 'pending' | 'edit' | 'view' | 'denied' | 'removed';

export const useBoardAccessStore = create<{ access: BoardAccess }>(() => ({
  access: 'pending',
}));

export const setBoardAccess = (access: BoardAccess) =>
  useBoardAccessStore.setState({ access });

export const isViewOnly = () => useBoardAccessStore.getState().access === 'view';

/**
 * The share key in a student's link (`?k=`). Read from the address bar each
 * time: the board keeps it there (`?p=` is rewritten beside it, not over it),
 * so a reload or a copied URL still carries it. Empty for the tutor's own URL.
 */
export function boardKey(): string {
  // No address bar in the node test environment.
  return new URLSearchParams(globalThis.location?.search).get('k') ?? '';
}

/** Headers that let the server check this client may edit the open board. */
export function boardHeaders(): Record<string, string> {
  const boardId = parseBoardId(globalThis.location?.pathname ?? '');
  return boardId ? { 'X-Board-Id': boardId, 'X-Board-Key': boardKey() } : {};
}

// --- The tutor's controls over a board's link (all tutor-gated server-side) ---

async function shareRequest(
  path: string,
  init?: RequestInit,
): Promise<BoardShare> {
  const res = await fetch(`/api/boards/${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`Share settings failed (${res.status})`);
  return (await res.json()) as BoardShare;
}

export const fetchBoardShare = (boardId: string) =>
  shareRequest(`${encodeURIComponent(boardId)}/access`);

export const setShareMode = (boardId: string, mode: ShareMode) =>
  shareRequest(`${encodeURIComponent(boardId)}/access`, {
    method: 'PATCH',
    body: JSON.stringify({ mode }),
  });

export const setAgentHelp = (boardId: string, agentHelp: AgentHelp) =>
  shareRequest(`${encodeURIComponent(boardId)}/access`, {
    method: 'PATCH',
    body: JSON.stringify({ agentHelp }),
  });

export const resetShareLink = (boardId: string) =>
  shareRequest(`${encodeURIComponent(boardId)}/access/reset`, { method: 'POST' });

export async function removeStudent(boardId: string, clientId: number): Promise<void> {
  await fetch(`/api/boards/${encodeURIComponent(boardId)}/remove`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });
}
