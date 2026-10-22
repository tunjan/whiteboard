import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  AUDIO_FORMATS,
  MAX_AUDIO_CHARS,
  MAX_INK_IMAGE_CHARS,
  MAX_LATEX_PROMPT_CHARS,
  type GraphFromInkResponse,
  type LatexResponse,
  type TranscribeResponse,
} from '@whiteboard/shared';
import { env } from '../env';
import {
  GRAPH_SYSTEM_PROMPT,
  INK_SYSTEM_PROMPT,
  PROMPT_SYSTEM_PROMPT,
  extractGraphExpressions,
  extractLatex,
} from './latex';
import {
  NotConfiguredError,
  UpstreamError,
  chatCompletion,
  transcribe,
  type ChatMessage,
} from './openrouter';
import { clientIp, rateLimiter } from '../rate-limit';
import { requireBoardEdit } from '../boards/access';

/**
 * LaTeX from ink, and LaTeX from a description.
 *
 * Open like `/api/blobs` and `/api/links` to anyone who may edit a board,
 * rather than tutor-gated: the student holding the link is the one doing the
 * handwriting. Unlike those, though, every call here spends real credit — hence
 * the window cap below, which is about the bill rather than about abuse.
 */
export const aiRoutes = new Hono();

aiRoutes.use('/latex/*', requireBoardEdit);
aiRoutes.use('/graph/*', requireBoardEdit);
aiRoutes.use('/transcribe', requireBoardEdit);

/**
 * Requests allowed per window, counted across the whole process.
 *
 * The shared ceiling is the one that actually bounds a runaway loop's spend:
 * the per-client cap below only knows a client's real address when the
 * operator has said which proxy header to trust (`clientIp`), and otherwise
 * sees every request as the proxy's.
 */
const WINDOW_MS = 60_000;
const WINDOW_LIMIT = 60;

const globalLimit = rateLimiter(WINDOW_LIMIT, WINDOW_MS);

/**
 * And per client, so one runaway tab or script can't spend the whole shared
 * ceiling and lock the rest of the classroom out of it. A third of it: a
 * student transcribing as fast as they write stays well under.
 */
const clientLimit = rateLimiter(WINDOW_LIMIT / 3, WINDOW_MS);

function withinRateLimit(c: Context): boolean {
  return clientLimit(clientIp(c)) && globalLimit('all');
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

/**
 * Validate a posted PNG and build the vision messages for it, or return the
 * error response. Shared by the two ink endpoints, which differ only in prompt
 * and in how the reply is read.
 */
async function inkMessages(
  c: Context,
  system: string,
  instruction: string,
): Promise<ChatMessage[] | Response> {
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
  if (!withinRateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
}

aiRoutes.post('/latex/ink', async (c) => {
  const messages = await inkMessages(
    c,
    INK_SYSTEM_PROMPT,
    'Transcribe the mathematics in this image.',
  );
  if (messages instanceof Response) return messages;

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
  if (!withinRateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

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

aiRoutes.post('/graph/ink', async (c) => {
  const messages = await inkMessages(
    c,
    GRAPH_SYSTEM_PROMPT,
    'Write the functions in this image as graphing-calculator input.',
  );
  if (messages instanceof Response) return messages;

  try {
    const result = extractGraphExpressions(
      await chatCompletion(env.openRouterVisionModel, messages),
    );
    if ('reason' in result) {
      if (result.reason === 'unreadable') return c.json({ error: 'unreadable' }, 422);
      console.error('[ai] unusable graph reply', result.reason);
      return c.json({ error: 'The model did not return a usable function' }, 502);
    }
    return c.json({ expressions: result.expressions } satisfies GraphFromInkResponse);
  } catch (error) {
    return failure(c, error);
  }
});

/**
 * Dictation: audio in, the transcript and its LaTeX out. Written here rather
 * than by a second client request because every request crosses the tunnel;
 * the transcript still goes back so the student sees what was heard.
 */
aiRoutes.post('/transcribe', async (c) => {
  if (declaredTooLarge(c.req.header('content-length'), MAX_AUDIO_CHARS + 1024)) {
    return c.json({ error: 'Recording too long' }, 413);
  }
  const body = (await c.req.json().catch(() => null)) as {
    audio?: unknown;
    format?: unknown;
  } | null;
  const audio = body?.audio;
  const format = body?.format;
  if (
    typeof audio !== 'string' ||
    !audio ||
    !AUDIO_FORMATS.includes(format as (typeof AUDIO_FORMATS)[number])
  ) {
    return c.json({ error: 'Expected base64 webm or mp4 audio' }, 400);
  }
  if (audio.length > MAX_AUDIO_CHARS) {
    return c.json({ error: 'Recording too long' }, 413);
  }
  if (!withinRateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

  let text: string;
  const started = performance.now();
  try {
    text = await transcribe(env.openRouterSttModel, audio, format as string);
  } catch (error) {
    return failure(c, error);
  }
  if (!text) return c.json({ error: 'unreadable' }, 422);
  const heard = performance.now();

  // From here a failure still answers 200 with the transcript: what was heard
  // is worth keeping even when it can't be written as maths.
  let result: TranscribeResponse;
  try {
    const extracted = extractLatex(
      await chatCompletion(env.openRouterTextModel, [
        { role: 'system', content: PROMPT_SYSTEM_PROMPT },
        { role: 'user', content: text.slice(0, MAX_LATEX_PROMPT_CHARS) },
      ]),
    );
    result =
      'reason' in extracted
        ? {
            text,
            error:
              extracted.reason === 'unreadable'
                ? 'No mathematics found'
                : 'The model did not return a usable equation',
          }
        : { text, latex: extracted.latex };
  } catch (error) {
    result = {
      text,
      error: error instanceof UpstreamError ? error.message : 'Generation failed',
    };
  }
  console.log(
    `[ai] dictation stt=${Math.round(heard - started)}ms latex=${Math.round(performance.now() - heard)}ms bytes=${audio.length}`,
  );
  return c.json(result satisfies TranscribeResponse);
});
