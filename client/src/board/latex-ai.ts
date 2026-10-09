import type {
  AudioFormat,
  GraphFromInkResponse,
  LatexResponse,
  TranscribeResponse,
} from '@whiteboard/shared';
import { boardHeaders } from '@/board/board-access';

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
async function postAi(path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...boardHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
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
  return res.json().catch(() => null);
}

async function requestLatex(path: string, body: unknown): Promise<string> {
  const parsed = (await postAi(path, body)) as LatexResponse | null;
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
export async function latexFromImage(png: Blob): Promise<string> {
  return requestLatex('/api/ai/latex/ink', { image: await toDataUrl(png) });
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

/**
 * Transcribe a dictated clip from `MediaRecorder`. The container is read off
 * the blob's type: Safari records mp4, everything else webm.
 */
export async function transcribeAudio(clip: Blob): Promise<string> {
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
  return text;
}
