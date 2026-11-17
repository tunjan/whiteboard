import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import {
  AUDIO_FORMATS,
  MAX_AGENT_BOARD_CHARS,
  MAX_AGENT_INSTRUCTION_CHARS,
  MAX_AGENT_HISTORY,
  MAX_AGENT_REPLY_CHARS,
  MAX_AUDIO_CHARS,
  MAX_INK_IMAGE_CHARS,
  MAX_LATEX_PROMPT_CHARS,
  MAX_STICKER_PROMPT_CHARS,
  type AgentBoardSummary,
  type AgentProgress,
  type AgentResponse,
  type AgentStreamEvent,
  type CheckResponse,
  type CheckSource,
  type AiJob,
  type AiModelsResponse,
  type GraphFromInkResponse,
  type StickerImageResponse,
  type LatexResponse,
  type TranscribeResponse,
  AI_JOBS,
} from '@whiteboard/shared';
import { env } from '../env';
import { requireTutor } from '../auth/middleware';
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
  streamChatCompletion,
  generateImage,
  listModels,
  transcribe,
  type ChatMessage,
  type CompletionProgress,
} from './openrouter';
import {
  AGENT_TOOLS,
  AGENT_TOOLS_AFTER_LOOK,
  LOOK_TOOL,
  agentMessages,
  lookMessages,
  parseAgentActions,
  parsePrevious,
  partialSayText,
  SAY_TOOL,
  sayOf,
} from './agent';
import { recordAgentAsk } from './agent-asks';
import {
  CHECK_SYSTEM_PROMPT,
  CONFIRM_SYSTEM_PROMPT,
  checkInstruction,
  confirmInstruction,
  parseCheckReply,
  parseCheckSources,
  parseConfirmReply,
} from './check';
import {
  fits,
  isAiJob,
  modelFor,
  recordUsage,
  selectedModels,
  setModel,
} from './models';
import { clientIp, rateLimiter } from '../rate-limit';
import { agentHelpFor, requireBoardEdit } from '../boards/access';

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
aiRoutes.use('/sticker', requireBoardEdit);
aiRoutes.use('/agent', requireBoardEdit);
aiRoutes.use('/check', requireBoardEdit);
aiRoutes.use('/models', requireTutor);

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
 * Run a chat job on its chosen model and bill it to the request's board. The
 * board is the `X-Board-Id` that `requireBoardEdit` already authorised.
 */
async function runChat(c: Context, job: AiJob, messages: ChatMessage[]) {
  const model = await modelFor(job);
  const { content, cost } = await chatCompletion(model, messages);
  recordUsage(c.req.header('x-board-id'), job, model, cost);
  return content;
}

/** The tutor's model picker: what each job runs on, and what it could. */
aiRoutes.get('/models', async (c) => {
  try {
    const [selected, catalogue] = await Promise.all([selectedModels(), listModels()]);
    const options = Object.fromEntries(
      AI_JOBS.map((job) => [
        job,
        catalogue
          .filter((m) => fits(job, m))
          .map(({ id, name, pricing }) => ({ id, name, pricing }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ]),
    ) as AiModelsResponse['options'];
    return c.json({ selected, options } satisfies AiModelsResponse);
  } catch (error) {
    return failure(c, error);
  }
});

aiRoutes.put('/models', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    job?: unknown;
    model?: unknown;
  } | null;
  const job = body?.job;
  const model = body?.model;
  if (!isAiJob(job) || typeof model !== 'string') {
    return c.json({ error: 'Expected a job and a model' }, 400);
  }
  let catalogue;
  try {
    catalogue = await listModels();
  } catch (error) {
    return failure(c, error);
  }
  // Checked against the same filter the picker shows, so a model that can't
  // take this job's input is refused here rather than failing mid-lesson.
  if (!catalogue.some((m) => m.id === model && fits(job, m))) {
    return c.json({ error: 'That model can’t do this job' }, 400);
  }
  await setModel(job, model);
  return c.json({ job, model });
});

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
  const { error: message, status } = failureOf(error);
  return c.json({ error: message }, status);
}

/** Nothing usable was heard in a recording. */
class UnreadableError extends Error {}

/** The status and message a failed AI request answers with. */
function failureOf(error: unknown): { error: string; status: 422 | 502 | 503 } {
  if (error instanceof UnreadableError) return { error: 'unreadable', status: 422 };
  if (error instanceof NotConfiguredError) {
    return { error: 'AI equations are not configured on this server', status: 503 };
  }
  const message =
    error instanceof UpstreamError ? error.message : 'The model failed';
  console.error('[ai] request failed', message);
  return { error: message, status: 502 };
}

/**
 * Validate a posted PNG and build the vision messages for it, or return the
 * error response. Shared by the two ink endpoints, which differ only in prompt
 * and in how the reply is read.
 */
async function inkMessages(
  c: Context,
  system: string,
  /** Or written from the rest of the body, for an endpoint that takes more. */
  instruction: string | ((body: Record<string, unknown>) => string),
  /** Room in the body beyond the image. */
  slack = 1024,
): Promise<ChatMessage[] | Response> {
  if (declaredTooLarge(c.req.header('content-length'), MAX_INK_IMAGE_CHARS + slack)) {
    return c.json({ error: 'Image too large' }, 413);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
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
        { type: 'text', text: typeof instruction === 'string' ? instruction : instruction(body!) },
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
    return respond(c, await runChat(c, 'vision', messages));
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
    return respond(c, await runChat(c, 'text', messages));
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
      await runChat(c, 'vision', messages),
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
 * The work checker: a page of working in, its mistakes out, each with where it
 * is in the image. No reasoning setting is sent, so a router model chosen in
 * the picker still picks its own effort; Haiku, the default, doesn't think
 * unless asked.
 */
aiRoutes.post('/check', async (c) => {
  let image = '';
  let sources: CheckSource[] = [];
  let confirm = false;
  const messages = await inkMessages(
    c,
    CHECK_SYSTEM_PROMPT,
    (body) => {
      image = body.image as string;
      sources = parseCheckSources(body.sources);
      confirm = body.confirm === true;
      return checkInstruction(sources);
    },
    // Thirty sources of 500 characters, JSON-escaped, with room to spare.
    64 * 1024,
  );
  if (messages instanceof Response) return messages;

  try {
    const model = await modelFor('check');
    const boardId = c.req.header('x-board-id');
    const { content, cost } = await chatCompletion(model, messages, undefined, true);
    recordUsage(boardId, 'check', model, cost);
    const errors = parseCheckReply(content);
    if (!errors) {
      console.error('[ai] unusable check reply', content.slice(0, 200));
      return c.json({ error: 'The model did not return a usable answer' }, 502);
    }
    if (!confirm || !errors.length) return c.json({ errors } satisfies CheckResponse);

    // The second opinion only narrows the first: if it fails or answers
    // nonsense, the first reply stands rather than the check failing.
    try {
      const second = await chatCompletion(
        model,
        [
          { role: 'system', content: CONFIRM_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: confirmInstruction(errors, sources) },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        undefined,
        true,
      );
      recordUsage(boardId, 'check', model, second.cost);
      const confirmed = parseConfirmReply(second.content, errors.length);
      if (!confirmed) {
        console.error('[ai] unusable confirm reply', second.content.slice(0, 200));
        return c.json({ errors } satisfies CheckResponse);
      }
      return c.json({
        errors: errors.filter((_, i) => confirmed.includes(i + 1)),
      } satisfies CheckResponse);
    } catch (error) {
      console.error('[ai] confirm failed', error instanceof Error ? error.message : error);
      return c.json({ errors } satisfies CheckResponse);
    }
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
    const model = await modelFor('stt');
    const heard = await transcribe(model, audio, format as string);
    recordUsage(c.req.header('x-board-id'), 'stt', model, heard.cost);
    text = heard.text;
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
      await runChat(c, 'text', [
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

/**
 * A sticker from a description. The plain white backdrop is asked for so the
 * client's existing cut-out (remove-background.ts) has a clean edge to flood
 * from — the image comes back with its backdrop and goes through the same
 * review dialog as an upload.
 */
aiRoutes.post('/sticker', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return c.json({ error: 'Expected a description' }, 400);
  if (prompt.length > MAX_STICKER_PROMPT_CHARS) {
    return c.json({ error: 'Description too long' }, 400);
  }
  if (!withinRateLimit(c)) return c.json({ error: 'Too many requests' }, 429);

  try {
    const model = await modelFor('image');
    const { image, cost } = await generateImage(
      model,
      `A die-cut sticker of ${prompt}. Bold clean outlines, flat vivid colours, ` +
        'one centred subject, no text, isolated on a plain solid white background.',
    );
    recordUsage(c.req.header('x-board-id'), 'image', model, cost);
    return c.json({ image } satisfies StickerImageResponse);
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return c.json({ error: 'AI stickers are not configured on this server' }, 503);
    }
    return failure(c, error);
  }
});

/**
 * The board agent: an instruction, typed or spoken, and a summary of the board
 * in view → the edits to make, as validated actions for the client to apply.
 * A spoken one is transcribed here first, in the same request, for the same
 * reason dictation is: every request crosses the tunnel.
 */
aiRoutes.post('/agent', async (c) => {
  if (
    declaredTooLarge(
      c.req.header('content-length'),
      MAX_AUDIO_CHARS + MAX_INK_IMAGE_CHARS + MAX_AGENT_BOARD_CHARS + MAX_AGENT_INSTRUCTION_CHARS +
        (MAX_AGENT_INSTRUCTION_CHARS + MAX_AGENT_REPLY_CHARS) * MAX_AGENT_HISTORY + 1024,
    )
  ) {
    return c.json({ error: 'Request too large' }, 413);
  }
  const body = (await c.req.json().catch(() => null)) as {
    text?: unknown;
    audio?: unknown;
    format?: unknown;
    board?: unknown;
    image?: unknown;
    who?: unknown;
    previous?: unknown;
    stream?: unknown;
  } | null;
  const board = body?.board as AgentBoardSummary | undefined;
  if (!board || typeof board !== 'object' || !Array.isArray(board.shapes)) {
    return c.json({ error: 'Expected a board summary' }, 400);
  }
  // Only ever read by the model, so its shape is not checked further — but it
  // is the model's bill, so its size is.
  if (JSON.stringify(board).length > MAX_AGENT_BOARD_CHARS) {
    return c.json({ error: 'Board summary too large' }, 413);
  }

  const typed = typeof body?.text === 'string' ? body.text.trim() : '';
  const audio = body?.audio;
  const format = body?.format;
  const spoken =
    typeof audio === 'string' &&
    audio.length > 0 &&
    AUDIO_FORMATS.includes(format as (typeof AUDIO_FORMATS)[number]);
  if (!typed && !spoken) {
    return c.json({ error: 'Expected an instruction or a recording' }, 400);
  }
  if (typed.length > MAX_AGENT_INSTRUCTION_CHARS) {
    return c.json({ error: 'Instruction too long' }, 400);
  }
  if (spoken && (audio as string).length > MAX_AUDIO_CHARS) {
    return c.json({ error: 'Recording too long' }, 413);
  }
  // The picture asked for by `look`, or sent up front for handwriting.
  const image = body?.image;
  if (image !== undefined) {
    if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
      return c.json({ error: 'Expected a PNG data URL' }, 400);
    }
    if (image.length > MAX_INK_IMAGE_CHARS) return c.json({ error: 'Image too large' }, 413);
  }
  const previous = parsePrevious(body?.previous, MAX_AGENT_INSTRUCTION_CHARS, MAX_AGENT_REPLY_CHARS);
  if (!withinRateLimit(c)) return c.json({ error: 'Too many requests' }, 429);
  const help = await agentHelpFor(c, c.req.header('x-board-id') ?? '');
  if (help === 'off') return c.json({ error: 'Your tutor has turned Ask the board off' }, 403);
  const context = { previous, hints: help === 'hints' };

  // Streamed, the model is too: the person waiting sees each step as it
  // starts. The plain JSON answer stays for callers that only want the result.
  const streaming = body?.stream === true;
  const run = async (emit: (progress: AgentProgress) => void): Promise<AgentResponse> => {
    let transcript: string | undefined;
    if (!typed) {
      const model = await modelFor('stt');
      const heard = await transcribe(model, audio as string, format as string);
      recordUsage(c.req.header('x-board-id'), 'stt', model, heard.cost);
      transcript = heard.text.slice(0, MAX_AGENT_INSTRUCTION_CHARS);
      if (!transcript) throw new UnreadableError();
      emit({ step: 'heard', transcript });
    }

    const model = await modelFor('agent');
    const instruction = typed || transcript!;
    const messages =
      typeof image === 'string'
        ? lookMessages(instruction, board, image, context)
        : agentMessages(instruction, board, context);
    const tools = typeof image === 'string' ? AGENT_TOOLS_AFTER_LOOK : AGENT_TOOLS;
    // The answer as it is written: plain text while no edit has started
    // (text beside edits is the model planning, dropped below), or `say`'s
    // text as its arguments arrive. Text that turns out to be planning is
    // taken back with a reset.
    let draft = '';
    let from: 'text' | 'say' | undefined;
    let edits = false;
    const redraft = (next: string, source: 'text' | 'say') => {
      if (from && from !== source) {
        draft = '';
        emit({ step: 'draft', text: '', reset: true });
      }
      from = source;
      if (!next.startsWith(draft) || next === draft) return;
      emit({ step: 'draft', text: next.slice(draft.length) });
      draft = next;
    };
    const onProgress = (p: CompletionProgress) => {
      if (p.type === 'started') emit({ step: 'thinking' });
      else if (p.type === 'tool') {
        emit({ step: 'tool', name: p.name });
        if (p.name === SAY_TOOL) return;
        edits = true;
        if (from === 'text') {
          from = undefined;
          draft = '';
          emit({ step: 'draft', text: '', reset: true });
        }
      } else if (p.type === 'text') {
        if (!edits && from !== 'say') redraft(draft + p.delta, 'text');
      } else if (p.name === SAY_TOOL) redraft(partialSayText(p.arguments), 'say');
    };
    const { content, cost, toolCalls } = streaming
      ? await streamChatCompletion(model, messages, tools, onProgress)
      : await chatCompletion(model, messages, tools);
    recordUsage(c.req.header('x-board-id'), 'agent', model, cost);
    // Anything called beside the look was decided blind; it is decided again
    // once the picture arrives.
    if (toolCalls.some((call) => call.name === LOOK_TOOL)) {
      return { transcript, look: true, actions: [] };
    }
    const actions = parseAgentActions(toolCalls);
    // Text beside tool calls is the model planning its layout aloud; what it
    // means for the user beside edits comes through `say`. Only when it did
    // nothing is its plain text the answer.
    const reply =
      sayOf(toolCalls, MAX_AGENT_REPLY_CHARS) ??
      (actions.length ? undefined : content.trim().slice(0, MAX_AGENT_REPLY_CHARS) || undefined);
    const response = { transcript, reply, actions } satisfies AgentResponse;
    // Not awaited: the student's answer doesn't wait on the tutor's copy.
    void recordAgentAsk(c, body?.who, instruction, response).catch((error: unknown) =>
      console.error('[ai] agent ask not shared', error),
    );
    return response;
  };

  if (streaming) {
    return streamSSE(c, async (sse) => {
      const send = (event: AgentStreamEvent) => sse.writeSSE({ data: JSON.stringify(event) });
      try {
        const result = await run((progress) => void send({ progress }));
        await send({ result });
      } catch (error) {
        await send(failureOf(error));
      }
    });
  }
  try {
    return c.json(await run(() => {}));
  } catch (error) {
    return failure(c, error);
  }
});
