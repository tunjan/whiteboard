import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { parse } from 'hono/utils/cookie';
import {
  AGENT_HELP_MODES,
  PAGE_DOCUMENT_INFIX,
  type AgentHelp,
  type ShareMode,
} from '@whiteboard/shared';
import { verifySession } from '../auth/jwt';
import { SESSION_COOKIE } from '../auth/routes';
import { db } from '../db/client';
import { boards } from '../db/schema';

/**
 * Who may do what on a board.
 *
 * The board's tutor (session cookie) may do anything. Anyone else needs the board's
 * share key — the `?k=` in the link the tutor hands out — and gets what the
 * board's share mode says: edit, view, or nothing. The board id alone is no
 * longer a capability: it shows up in every page document name and URL, and
 * unlike the key it can never be taken back.
 */
export type Access = 'tutor' | Exclude<ShareMode, 'off'>;

const digest = (s: string) => createHash('sha256').update(s).digest();

export async function boardAccess(
  boardId: string,
  key: string | undefined,
  sessionToken: string | undefined,
): Promise<Access | null> {
  if (!key && !sessionToken) return null;
  const [row] = await db
    .select({ shareKey: boards.shareKey, shareMode: boards.shareMode, tutorId: boards.tutorId })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (!row) return null;
  // The board's own tutor. Another tutor is signed in, but here they are only
  // whatever their link makes them — like anyone else holding it.
  if (sessionToken && row.tutorId && (await verifySession(sessionToken))?.id === row.tutorId) {
    return 'tutor';
  }
  if (!key || row.shareMode === 'off') return null;
  // Hashed first so the comparison is fixed-length and constant-time.
  if (!timingSafeEqual(digest(key), digest(row.shareKey))) return null;
  return row.shareMode === 'view' ? 'view' : 'edit';
}

/** A page document belongs to the board named before its infix. */
export function boardIdOf(documentName: string): string {
  const at = documentName.indexOf(PAGE_DOCUMENT_INFIX);
  return at === -1 ? documentName : documentName.slice(0, at);
}

/**
 * The session token on the collab socket's upgrade request. Typed `Headers`
 * by Hocuspocus, but at runtime it is whatever the request carried — Node's
 * plain header object, for the `IncomingMessage` index.ts hands it.
 */
export function sessionFromHeaders(
  headers: Headers | Record<string, string | string[] | undefined>,
): string | undefined {
  const raw =
    typeof headers.get === 'function'
      ? (headers as Headers).get('cookie')
      : (headers as Record<string, string | string[] | undefined>).cookie;
  const cookie = Array.isArray(raw) ? raw.join('; ') : raw;
  return cookie ? parse(cookie, SESSION_COOKIE)[SESSION_COOKIE] : undefined;
}

/**
 * HTTP access. The key comes in a header from `fetch`, or as `?k=` where the
 * request is a plain link (the board export download).
 */
export function requestAccess(c: Context, boardId: string) {
  return boardAccess(
    boardId,
    c.req.header('x-board-key') ?? c.req.query('k'),
    getCookie(c, SESSION_COOKIE),
  );
}

/**
 * Gate a write on a board: the tutor, or a student whose link grants edit.
 * The board is the route's `:boardId`, else the `X-Board-Id` header — uploads
 * are stored content-addressed, not per board, but are only accepted on behalf
 * of one.
 */
export const requireBoardEdit = createMiddleware(async (c, next) => {
  const boardId = c.req.param('boardId') ?? c.req.header('x-board-id');
  const access = boardId ? await requestAccess(c, boardId) : null;
  if (access !== 'tutor' && access !== 'edit') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

/**
 * How much the board agent may do for this request: always everything for
 * the tutor, and what the tutor chose for the board for anyone on its link.
 */
export async function agentHelpFor(c: Context, boardId: string): Promise<AgentHelp> {
  if ((await requestAccess(c, boardId)) === 'tutor') return 'full';
  const [row] = await db
    .select({ agentHelp: boards.agentHelp })
    .from(boards)
    .where(eq(boards.id, boardId));
  const help = row?.agentHelp as AgentHelp | undefined;
  return help && AGENT_HELP_MODES.includes(help) ? help : 'full';
}
