import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  MAX_INK_IMAGE_CHARS,
  MAX_LATEX_PROMPT_CHARS,
  type LatexResponse,
} from '@whiteboard/shared';
import { env } from '../env';
import {
  INK_SYSTEM_PROMPT,
  PROMPT_SYSTEM_PROMPT,
  extractLatex,
} from './latex';
import {
  NotConfiguredError,
  UpstreamError,
  chatCompletion,
  type ChatMessage,
} from './openrouter';

/**
 * LaTeX from ink, and LaTeX from a description.
 *
 * Open like `/api/blobs` and `/api/links` rather than tutor-gated: a board is
 * shared by capability URL and the student holding it is the one doing the
 * handwriting. Unlike those, though, every call here spends real credit — hence
 * the window cap below, which is about the bill rather than about abuse.
 */
export const aiRoutes = new Hono();

/**
 * Requests allowed per window, counted across the whole process.
 *
 * Deliberately not per-IP: this runs behind whatever proxy the operator put in
 * front of it, and a cap that trusts `x-forwarded-for` is a cap a client can
 * lift for itself. A shared ceiling is coarse — a busy classroom can exhaust
 * it — but it is the one that actually bounds a runaway loop's spend.
 */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 60;

let windowStart = 0;
let windowCount = 0;

function withinRateLimit(): boolean {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  return ++windowCount <= WINDOW_LIMIT;
}

/** Whether the two AI actions should appear in the UI at all. */
aiRoutes.get('/config', (c) => c.json({ enabled: Boolean(env.openRouterApiKey) }));

/**
 * Reject an oversized body before reading it. The image cap is enforced again
 * on the parsed string — `content-length` is the client's claim about the body,
 * not a fact about it — but checking it first is what stops a large upload from
 * being buffered into memory only to be thrown away.
 */
function declaredTooLarge(header: string | undefined, max: number): boolean {
  const length = Number(header);
  return Number.isFinite(length) && length > max;
}

/**
 * Turn a finished model reply into a response body. `extractLatex`'s refusals
 * are separated from its failures: "I can't read this" is a normal outcome the
 * user needs phrased for them, while an empty or runaway answer is a fault.
 */
function respond(c: Context, reply: string) {
  const result = extractLatex(reply);
  if ('reason' in result) {
    if (result.reason === 'unreadable') return c.json({ error: 'unreadable' }, 422);
    console.error('[ai] unusable model reply', result.reason);
    return c.json({ error: 'The model did not return a usable equation' }, 502);
  }
  return c.json({ latex: result.latex } satisfies LatexResponse);
}

/** Map a thrown model failure onto a status the client can phrase. */
function failure(c: Context, error: unknown) {
  if (error instanceof NotConfiguredError) {
    return c.json({ error: 'AI equations are not configured on this server' }, 503);
  }
  const message =
    error instanceof UpstreamError ? error.message : 'The model failed';
  console.error('[ai] request failed', message);
  return c.json({ error: message }, 502);
}

aiRoutes.post('/latex/ink', async (c) => {
  if (declaredTooLarge(c.req.header('content-length'), MAX_INK_IMAGE_CHARS + 1024)) {
    return c.json({ error: 'Image too large' }, 413);
  }
  const body = (await c.req.json().catch(() => null)) as { image?: unknown } | null;
  const image = body?.image;
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
    return c.json({ error: 'Expected a PNG data URL' }, 400);
  }
  if (image.length > MAX_INK_IMAGE_CHARS) {
    return c.json({ error: 'Image too large' }, 413);
  }
  if (!withinRateLimit()) return c.json({ error: 'Too many requests' }, 429);

  const messages: ChatMessage[] = [
    { role: 'system', content: INK_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe the handwritten mathematics in this image.' },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];

  try {
    return respond(c, await chatCompletion(env.openRouterVisionModel, messages));
  } catch (error) {
    return failure(c, error);
  }
});

aiRoutes.post('/latex/prompt', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return c.json({ error: 'Expected a description' }, 400);
  if (prompt.length > MAX_LATEX_PROMPT_CHARS) {
    return c.json({ error: 'Description too long' }, 400);
  }
  if (!withinRateLimit()) return c.json({ error: 'Too many requests' }, 429);

  const messages: ChatMessage[] = [
    { role: 'system', content: PROMPT_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  try {
    return respond(c, await chatCompletion(env.openRouterTextModel, messages));
  } catch (error) {
    return failure(c, error);
  }
});
