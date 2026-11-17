import type {
  AgentBoardSummary,
  AgentPrevious,
  AgentProgress,
  AgentStreamEvent,
  AgentResponse,
  AudioFormat,
  CheckError,
  CheckRequest,
  CheckResponse,
  GraphFromInkResponse,
  LatexResponse,
  StickerImageResponse,
  TranscribeResponse,
} from '@whiteboard/shared';
import { boardHeaders } from '@/board/board-access';
import { getLocalUser } from '@/collab/presence';

/**
 * Client for the two AI LaTeX endpoints.
 *
 * Every failure arrives as an `Error` whose message is already phrased for a
 * toast — the callers are UI, and none of them has anything useful to add to a
 * status code.
 */

/** The model read the image (or the description) and found no maths in it. */
export class UnreadableError extends Error {}

/**
 * Whether the server has an OpenRouter key, cached for the session.
 *
 * Asked once and remembered: it is a property of the deployment, and the
 * answer decides whether two buttons render at all.
 */
let configured: Promise<boolean> | null = null;

export function aiLatexEnabled(): Promise<boolean> {
  configured ??= fetch('/api/ai/config', { credentials: 'include' })
    .then((res) => (res.ok ? (res.json() as Promise<{ enabled?: boolean }>) : null))
    .then((body) => Boolean(body?.enabled))
    .catch(() => false);
  return configured;
}

/** POST to an AI endpoint; resolves the parsed body, throws toast-ready errors. */
async function postAi(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await aiFetch(path, body, signal);
  return res.json().catch(() => null);
}

/** POST to an AI endpoint; resolves the response once it is known to be ok. */
async function aiFetch(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...boardHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // A cancel is the user's own doing, not a connection problem: let it
    // through as itself so the caller can stay quiet rather than toast it.
    if (signal?.aborted) throw err;
    throw new Error('Could not reach the server');
  }

  if (res.status === 422) {
    throw new UnreadableError('No mathematics found');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(detail?.error || 'The equation service failed');
  }
  return res;
}

async function requestLatex(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const parsed = (await postAi(path, body, signal)) as LatexResponse | null;
  const latex = parsed?.latex?.trim();
  if (!latex) throw new Error('The equation service returned nothing');
  return latex;
}

/** Base64 data URL for a PNG blob, which is how the image reaches the model. */
function toDataUrl(png: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(png);
  });
}

/**
 * Transcribe a rasterized selection — handwriting, a pasted picture, or both —
 * into a LaTeX body. The endpoint keeps its original `/ink` path: it is the
 * same transcription either way, and renaming a route costs a deploy where the
 * two builds disagree.
 */
export async function latexFromImage(
  png: Blob,
  signal?: AbortSignal,
): Promise<string> {
  return requestLatex(
    '/api/ai/latex/ink',
    { image: await toDataUrl(png) },
    signal,
  );
}

/** Write the LaTeX for a formula named in plain language. */
export function latexFromPrompt(prompt: string): Promise<string> {
  return requestLatex('/api/ai/latex/prompt', { prompt });
}

/** Read the plottable functions in a rasterized selection as graph rows. */
export async function graphExpressionsFromImage(png: Blob): Promise<string[]> {
  const parsed = (await postAi('/api/ai/graph/ink', {
    image: await toDataUrl(png),
  })) as GraphFromInkResponse | null;
  const expressions = parsed?.expressions?.filter((e) => typeof e === 'string');
  if (!expressions?.length) throw new Error('The equation service returned nothing');
  return expressions;
}

/** The mistakes in a rasterized page of working, by its numbered line tags. */
export async function checkWork(
  png: Blob,
  signal?: AbortSignal,
  options: Omit<CheckRequest, 'image'> = {},
): Promise<CheckError[]> {
  const parsed = (await postAi(
    '/api/ai/check',
    { image: await toDataUrl(png), ...options } satisfies CheckRequest,
    signal,
  )) as CheckResponse | null;
  if (!Array.isArray(parsed?.errors)) throw new Error('The work checker returned nothing');
  return parsed.errors;
}

/**
 * Transcribe a dictated clip from `MediaRecorder` and write its LaTeX, in one
 * request. The container is read off the blob's type: Safari records mp4,
 * everything else webm. Throws only when nothing was heard; a transcript that
 * couldn't become LaTeX resolves with `error` set instead.
 */
export async function dictateLatex(
  clip: Blob,
): Promise<{ text: string; latex?: string; error?: string }> {
  const format: AudioFormat = clip.type.includes('mp4') ? 'mp4' : 'webm';
  const dataUrl = await toDataUrl(clip);
  let parsed: TranscribeResponse | null;
  try {
    parsed = (await postAi('/api/ai/transcribe', {
      audio: dataUrl.slice(dataUrl.indexOf(',') + 1),
      format,
    })) as TranscribeResponse | null;
  } catch (err) {
    if (err instanceof UnreadableError) throw new UnreadableError('Didn’t catch that');
    throw err;
  }
  const text = parsed?.text?.trim();
  if (!text) throw new UnreadableError('Didn’t catch that');
  const latex = parsed?.latex?.trim();
  if (latex) return { text, latex };
  return { text, error: parsed?.error || 'The equation service returned nothing' };
}

/** Generate sticker artwork from a description; resolves its data URL. */
export async function stickerImageFromPrompt(prompt: string): Promise<string> {
  const parsed = (await postAi('/api/ai/sticker', {
    prompt,
  })) as StickerImageResponse | null;
  if (!parsed?.image) throw new Error('The image service returned nothing');
  return parsed.image;
}

/**
 * Ask the board agent what to do with an instruction, typed or as a recorded
 * clip. Resolves the actions to apply, plus what was heard and any answer.
 */
export async function askBoardAgent(
  instruction: string | Blob,
  board: AgentBoardSummary,
  /**
   * Takes the picture the model may ask for before it answers — the
   * selection, or the view — or resolves null when there is nothing to see.
   */
  look: () => Promise<Blob | null>,
  signal?: AbortSignal,
  {
    previous,
    pictureFirst = false,
    onProgress,
  }: {
    /** The last few exchanges, oldest first, for a follow-up to refer to. */
    previous?: AgentPrevious[];
    /** Send the picture with the first request rather than wait to be asked. */
    pictureFirst?: boolean;
    /** Each step the server reports as it starts. */
    onProgress?: (progress: AgentProgress) => void;
  } = {},
): Promise<AgentResponse> {
  const early = pictureFirst ? await look() : null;
  const first = await postAgent(instruction, board, signal, {
    previous,
    image: early ? await toDataUrl(early) : undefined,
    onProgress,
  });
  if (!first.look || early) return { ...first, look: undefined };
  // The same instruction again, now with the picture. A spoken one goes back
  // as its transcript, so it is not transcribed (and billed) twice.
  const text = first.transcript ?? (instruction as string);
  const png = await look();
  if (!png) {
    return { transcript: first.transcript, reply: 'There’s nothing on the board here to look at.', actions: [] };
  }
  const second = await postAgent(text, board, signal, {
    previous,
    image: await toDataUrl(png),
    onProgress,
  });
  return { ...second, transcript: first.transcript, look: undefined };
}

async function postAgent(
  instruction: string | Blob,
  board: AgentBoardSummary,
  signal: AbortSignal | undefined,
  {
    image,
    previous,
    onProgress = () => {},
  }: { image?: string; previous?: AgentPrevious[]; onProgress?: (progress: AgentProgress) => void },
): Promise<AgentResponse> {
  let body: unknown;
  // Who is asking, so the board's tutor can see it (the server tells them).
  const user = getLocalUser();
  const who = user ? { name: user.name, color: user.color } : undefined;
  if (typeof instruction === 'string') {
    body = { text: instruction, board, image, who, previous, stream: true };
  } else {
    const dataUrl = await toDataUrl(instruction);
    body = {
      audio: dataUrl.slice(dataUrl.indexOf(',') + 1),
      format: instruction.type.includes('mp4') ? 'mp4' : 'webm',
      board,
      image,
      who,
      previous,
      stream: true,
    };
  }
  try {
    const res = await aiFetch('/api/ai/agent', body, signal);
    const parsed = await readAgentStream(res, onProgress);
    return { ...parsed, actions: parsed.actions ?? [] };
  } catch (err) {
    if (err instanceof UnreadableError) throw new UnreadableError('Didn’t catch that');
    throw err;
  }
}

/**
 * The server-sent events of a streamed agent request: progress as it comes,
 * then the result, or the error that ended it (status already sent as 200).
 */
async function readAgentStream(
  res: Response,
  onProgress: (progress: AgentProgress) => void,
): Promise<AgentResponse> {
  if (!res.body) throw new Error('The assistant failed');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += value;
    let end: number;
    while ((end = buffered.indexOf('\n\n')) !== -1) {
      const block = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      const event = JSON.parse(data) as AgentStreamEvent;
      if ('progress' in event) onProgress(event.progress);
      else if ('result' in event) return event.result;
      else if (event.status === 422) throw new UnreadableError();
      else throw new Error(event.error || 'The assistant failed');
    }
  }
  throw new Error('The connection closed before the answer arrived');
}
