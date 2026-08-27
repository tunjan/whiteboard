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

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ContentPart[];
}

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

interface CompletionResponse {
  choices?: {
    message?: { content?: string };
    finish_reason?: string;
  }[];
  error?: { message?: string };
}

/** Run one completion and return the reply text. */
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
): Promise<string> {
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
      body: JSON.stringify({
        model,
        messages,
        max_tokens: MAX_TOKENS,
        reasoning: REASONING,
        // Transcription and recall both want the likeliest answer, not a
        // varied one — and a re-run of the same ink should agree with itself.
        temperature: 0,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new UpstreamError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The model took too long to answer'
        : 'Could not reach OpenRouter',
    );
  }

  const body = (await response.json().catch(() => null)) as
    | CompletionResponse
    | null;

  if (!response.ok) {
    // OpenRouter puts the useful part in the body; the status alone doesn't
    // distinguish an unknown model from an empty account.
    const detail = body?.error?.message ?? `HTTP ${response.status}`;
    throw new UpstreamError(detail);
  }

  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    // Name the one cause that is actually actionable. An empty answer is
    // otherwise indistinguishable from a provider hiccup in the logs, which is
    // exactly the hole this message used to leave.
    throw new UpstreamError(
      choice?.finish_reason === 'length'
        ? `The model ran out of room before answering (max_tokens: ${MAX_TOKENS})`
        : 'The model returned an empty answer',
    );
  }
  return content;
}
