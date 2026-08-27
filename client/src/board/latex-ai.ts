import type { LatexResponse } from '@whiteboard/shared';

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

async function requestLatex(path: string, body: unknown): Promise<string> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
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

  const parsed = (await res.json().catch(() => null)) as LatexResponse | null;
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

/** Transcribe rasterized handwriting into a LaTeX body. */
export async function latexFromInk(png: Blob): Promise<string> {
  return requestLatex('/api/ai/latex/ink', { image: await toDataUrl(png) });
}

/** Write the LaTeX for a formula named in plain language. */
export function latexFromPrompt(prompt: string): Promise<string> {
  return requestLatex('/api/ai/latex/prompt', { prompt });
}
