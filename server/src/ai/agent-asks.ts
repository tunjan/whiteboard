import type { Context } from 'hono';
import {
  AGENT_ASK_PREFIX,
  describeActions,
  type AgentAsk,
  type AgentResponse,
} from '@whiteboard/shared';
import { requestAccess } from '../boards/access';
import { notifyTutors } from '../collab/hocuspocus';
import { db } from '../db/client';
import { agentAsks } from '../db/schema';

/** Long enough for the gist of an answer; the student has the whole of it. */
const MAX_RESULT_CHARS = 1000;

/** The `who` a client sent: its published name and colour, trimmed to size. */
export function parseAsker(who: unknown): { name: string; color: string | null } {
  const { name, color } = (who ?? {}) as { name?: unknown; color?: unknown };
  return {
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Guest',
    color: typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color) ? color : null,
  };
}

/** What the tutor reads about one answered instruction. */
export function askOf(
  who: unknown,
  instruction: string,
  response: AgentResponse,
  at = Date.now(),
): AgentAsk {
  const kind = response.actions.length ? 'done' : response.reply ? 'reply' : 'nothing';
  return {
    ...parseAsker(who),
    at,
    instruction,
    kind,
    result:
      kind === 'done'
        ? describeActions(response.actions)
        : (response.reply ?? '').slice(0, MAX_RESULT_CHARS),
  };
}

/**
 * Tell the board's tutor what a student just asked, live, and keep it for the
 * Attendance page. The tutor's own instructions are neither: this is about
 * how the students use it.
 */
export async function recordAgentAsk(
  c: Context,
  who: unknown,
  instruction: string,
  response: AgentResponse,
): Promise<void> {
  const boardId = c.req.header('x-board-id');
  if (!boardId || (await requestAccess(c, boardId)) !== 'edit') return;
  const ask = askOf(who, instruction, response);
  notifyTutors(boardId, `${AGENT_ASK_PREFIX}${JSON.stringify(ask)}`);
  await db
    .insert(agentAsks)
    .values({
      boardId,
      name: ask.name,
      color: ask.color,
      instruction: ask.instruction,
      kind: ask.kind,
      result: ask.result,
    })
    .catch((error: unknown) => console.error('[ai] agent ask not recorded', error));
}
