import type { AgentHelp } from './ai-agent';

/** What a board's student link grants. The tutor always has full access. */
export type ShareMode = 'edit' | 'view' | 'off';

export const SHARE_MODES: readonly ShareMode[] = ['edit', 'view', 'off'];

/** Tutor-only view of a board's link (`GET /api/boards/:id/access`). */
export interface BoardShare {
  key: string;
  mode: ShareMode;
  /** What "Ask the board" does for students on this board. */
  agentHelp: AgentHelp;
}

/**
 * Stateless message the server sends a student the tutor removed, just before
 * closing their socket, so the client stops instead of reconnecting.
 */
export const REMOVED_MESSAGE = 'whiteboard:removed';
