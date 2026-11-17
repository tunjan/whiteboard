import type { AiModel } from '@whiteboard/shared';
import { env } from '../env';

/**
 * The OpenRouter chat-completions call, and nothing else.
 *
 * OpenRouter speaks the OpenAI chat schema, so an image is a content part
 * carrying a data URL — no upload step, and no third-party origin ever sees the
 * board's ink.
 */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  /** A turn in which the model called tools, replayed to continue from it. */
  | {
      role: 'assistant';
      content: string;
      tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** No key configured: the feature is off, which is a different answer to the
 *  client than a model that failed. */
export class NotConfiguredError extends Error {}

/** The model was reached and something went wrong there. */
export class UpstreamError extends Error {}

/**
 * Long enough for a vision model to read a dense derivation, short enough that
 * a hung request doesn't hold a connection open behind a spinner all afternoon.
 */
const TIMEOUT_MS = 45_000;

/**
 * Transcribing a page of maths is a few hundred tokens. The cap is what stops a
 * model that starts explaining itself from billing for an essay — the reply is
 * rejected by `extractLatex` either way.
 *
 * Sized well above that, because the budget is shared with any reasoning the
 * model does (see `REASONING`): if a provider ignores the request to skip it,
 * the answer still has room to arrive rather than being truncated to nothing.
 */
const MAX_TOKENS = 4096;

/**
 * Turn off chain-of-thought entirely.
 *
 * Both jobs here run on DeepSeek, and reasoning tokens are drawn from the same
 * `max_tokens` budget as the answer — a busy image once made it think past the
 * whole budget, so `finish_reason` came back `length` with `content: null` and
 * the request failed with nothing to show for it. DeepSeek accepts
 * `{ enabled: false }` outright, unlike the unbranded vision preview used
 * here previously, which rejected it and required at least `effort: 'low'`.
 */
const REASONING = { enabled: false } as const;

/** A function the model may call, in the OpenAI `tools` schema. */
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

/** One call the model made: the tool's name and its JSON-encoded arguments. */
export interface ToolCall {
  name: string;
  arguments: string;
}

interface CompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: Usage;
  error?: { message?: string };
}

/** Every OpenRouter endpoint used here reports the request's USD cost here. */
interface Usage {
  cost?: number;
}

const costOf = (usage: Usage | undefined) =>
  typeof usage?.cost === 'number' && Number.isFinite(usage.cost) ? usage.cost : 0;

function completionBody(
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  routerReasoning: boolean,
) {
  return {
    model,
    messages,
    max_tokens: MAX_TOKENS,
    // The agent's model (Sonnet) refuses a request with reasoning switched
    // off outright ("Reasoning is mandatory", 2026-10-24). Medium, not low:
    // told to write answers without preamble, at low it opened with a verdict
    // before working anything out ("It isn't." … "so −2 is correct"), 1 run
    // in 6; medium 0 in 6, at the same ~2.8 s and ~$0.012 (2026-11-11).
    ...(routerReasoning ? {} : { reasoning: tools ? { effort: 'medium' } : REASONING }),
    // Transcription and recall both want the likeliest answer, not a
    // varied one — and a re-run of the same ink should agree with itself.
    temperature: 0,
    // OpenRouter's default routing balances on price and landed on
    // providers answering in ~2 s; sorting by throughput picked ones that
    // answer the same prompts in ~0.9 s median (measured 2026-10-13).
    provider: { sort: 'throughput' },
    // Asks for `usage.cost` explicitly; the analytics page bills from it.
    usage: { include: true },
    ...(tools ? { tools } : {}),
  };
}

async function postCompletion(body: object): Promise<Response> {
  const key = env.openRouterApiKey;
  if (!key) throw new NotConfiguredError('OPENROUTER_API_KEY is not set');
  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // Names this app in the OpenRouter dashboard's usage breakdown.
        'x-title': 'Whiteboard',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw upstreamFailure(error);
  }
  if (!response.ok) {
    // OpenRouter puts the useful part in the body; the status alone doesn't
    // distinguish an unknown model from an empty account.
    const failed = (await response.json().catch(() => null)) as CompletionResponse | null;
    throw new UpstreamError(failed?.error?.message ?? `HTTP ${response.status}`);
  }
  return response;
}

const upstreamFailure = (error: unknown) =>
  new UpstreamError(
    error instanceof Error && error.name === 'TimeoutError'
      ? 'The model took too long to answer'
      : 'Could not reach OpenRouter',
  );

function finished(
  content: unknown,
  toolCalls: ToolCall[],
  finishReason: string | undefined,
  usage: Usage | undefined,
): { content: string; cost: number; toolCalls: ToolCall[] } {
  if (typeof content !== 'string' || (!content.trim() && !toolCalls.length)) {
    // Name the one cause that is actually actionable. An empty answer is
    // otherwise indistinguishable from a provider hiccup in the logs, which is
    // exactly the hole this message used to leave.
    throw new UpstreamError(
      finishReason === 'length'
        ? `The model ran out of room before answering (max_tokens: ${MAX_TOKENS})`
        : 'The model returned an empty answer',
    );
  }
  return { content, cost: costOf(usage), toolCalls };
}

/**
 * Run one completion and return the reply text and what it cost. With `tools`,
 * also the calls the model made — and then an answer of calls alone, with no
 * text, is a complete one.
 */
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  /** Send no reasoning setting, so a router model picks the effort itself. */
  routerReasoning = false,
): Promise<{ content: string; cost: number; toolCalls: ToolCall[] }> {
  const response = await postCompletion(completionBody(model, messages, tools, routerReasoning));
  const body = (await response.json().catch(() => null)) as CompletionResponse | null;
  const choice = body?.choices?.[0];
  const toolCalls = (choice?.message?.tool_calls ?? []).flatMap((call) =>
    call.function?.name
      ? [{ name: call.function.name, arguments: call.function.arguments ?? '{}' }]
      : [],
  );
  return finished(choice?.message?.content ?? '', toolCalls, choice?.finish_reason, body?.usage);
}

/** What a streamed completion has started doing, as it happens. */
export type CompletionProgress =
  /** The first token of any kind: reasoning, text or a call. */
  | { type: 'started' }
  /** The model began a call to this tool. */
  | { type: 'tool'; name: string };

interface StreamChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: Usage;
  error?: { message?: string };
}

/**
 * `chatCompletion`, streamed: the same request and the same answer, but
 * `onProgress` hears when the model starts and each tool it starts calling,
 * so a person waiting can see it working rather than a still spinner.
 */
export async function streamChatCompletion(
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  onProgress: (progress: CompletionProgress) => void,
): Promise<{ content: string; cost: number; toolCalls: ToolCall[] }> {
  const response = await postCompletion({
    ...completionBody(model, messages, tools, false),
    stream: true,
  });
  if (!response.body) throw new UpstreamError('The model returned an empty answer');

  let content = '';
  let started = false;
  let finishReason: string | undefined;
  let usage: Usage | undefined;
  // Calls arrive in pieces keyed by index: the name once, the arguments in
  // fragments.
  const calls: { name: string; arguments: string }[] = [];
  const onChunk = (chunk: StreamChunk) => {
    if (chunk.error) throw new UpstreamError(chunk.error.message ?? 'The model failed mid-answer');
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return;
    if (!started && (delta.content || delta.reasoning || delta.tool_calls?.length)) {
      started = true;
      onProgress({ type: 'started' });
    }
    if (delta.content) content += delta.content;
    for (const part of delta.tool_calls ?? []) {
      const i = part.index ?? calls.length;
      const call = (calls[i] ??= { name: '', arguments: '' });
      if (part.function?.name && !call.name) {
        call.name = part.function.name;
        onProgress({ type: 'tool', name: call.name });
      }
      if (part.function?.arguments) call.arguments += part.function.arguments;
    }
  };

  // Server-sent events: `data: {json}` lines, `: comment` keep-alives, and a
  // closing `data: [DONE]`.
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffered += decoder.decode(bytes, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          continue;
        }
        onChunk(chunk);
      }
    }
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    throw upstreamFailure(error);
  }

  const toolCalls = calls.flatMap((call) =>
    call && call.name ? [{ name: call.name, arguments: call.arguments || '{}' }] : [],
  );
  return finished(content, toolCalls, finishReason, usage);
}

/**
 * Raster formats the sticker cut-out can decode. Anything else — Recraft's
 * vector tiers answer SVG — is refused rather than handed to a browser as an
 * image the board would then serve back to every peer.
 */
const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Generate one image and return it as a data URL, with what it cost. */
export async function generateImage(
  model: string,
  prompt: string,
): Promise<{ image: string; cost: number }> {
  const key = env.openRouterApiKey;
  if (!key) throw new NotConfiguredError('OPENROUTER_API_KEY is not set');

  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-title': 'Whiteboard',
      },
      body: JSON.stringify({ model, prompt, n: 1, aspect_ratio: '1:1' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The image took too long to generate'
        : 'Could not reach OpenRouter',
    );
  }

  const body = (await response.json().catch(() => null)) as {
    data?: { b64_json?: string; media_type?: string }[];
    usage?: Usage;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new UpstreamError(body?.error?.message ?? `HTTP ${response.status}`);
  }
  const image = body?.data?.[0];
  // `media_type` is omitted only when OpenRouter couldn't tell; PNG is the
  // documented default then, and the client's decode is the real check.
  const type = image?.media_type ?? 'image/png';
  if (!image?.b64_json || !RASTER_TYPES.includes(type)) {
    throw new UpstreamError('The model did not return an image');
  }
  return {
    image: `data:${type};base64,${image.b64_json}`,
    cost: costOf(body?.usage),
  };
}

/** Transcribe one dictated clip to plain text, with what it cost. */
export async function transcribe(
  model: string,
  audio: string,
  format: string,
): Promise<{ text: string; cost: number }> {
  const key = env.openRouterApiKey;
  if (!key) throw new NotConfiguredError('OPENROUTER_API_KEY is not set');

  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'x-title': 'Whiteboard',
      },
      body: JSON.stringify({ model, input_audio: { data: audio, format } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Transcription took too long'
        : 'Could not reach OpenRouter',
    );
  }

  const body = (await response.json().catch(() => null)) as {
    text?: string;
    usage?: Usage;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new UpstreamError(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return { text: body?.text?.trim() ?? '', cost: costOf(body?.usage) };
}

/** A catalogue entry with the modalities `models.ts` filters on. */
export interface CatalogueModel extends AiModel {
  input: string[];
  output: string[];
  /** Whether OpenRouter lists `tools` among the model's parameters. */
  tools: boolean;
}

const CATALOGUE_TTL_MS = 60 * 60_000;
let catalogue: { at: number; models: Promise<CatalogueModel[]> } | null = null;

/**
 * OpenRouter's public model list, cached for an hour. The default listing is
 * text-output models only; image and transcription models are separate
 * filters, so all three are fetched and merged.
 */
export function listModels(): Promise<CatalogueModel[]> {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) {
    return catalogue.models;
  }
  const models = Promise.all(
    ['', '?output_modalities=image', '?output_modalities=transcription'].map(
      async (query) => {
        const res = await fetch(`https://openrouter.ai/api/v1/models${query}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new UpstreamError(`Model list: HTTP ${res.status}`);
        const body = (await res.json()) as {
          data?: {
            id: string;
            name: string;
            pricing?: Record<string, string>;
            supported_parameters?: string[];
            architecture?: { input_modalities?: string[]; output_modalities?: string[] };
          }[];
        };
        return body.data ?? [];
      },
    ),
  ).then((lists) => {
    const byId = new Map<string, CatalogueModel>();
    for (const m of lists.flat()) {
      byId.set(m.id, {
        id: m.id,
        name: m.name,
        pricing: m.pricing ?? {},
        input: m.architecture?.input_modalities ?? [],
        output: m.architecture?.output_modalities ?? [],
        tools: m.supported_parameters?.includes('tools') ?? false,
      });
    }
    return [...byId.values()];
  });
  catalogue = { at: Date.now(), models };
  // A failed fetch must not be cached for the hour.
  models.catch(() => {
    if (catalogue?.models === models) catalogue = null;
  });
  return models;
}
