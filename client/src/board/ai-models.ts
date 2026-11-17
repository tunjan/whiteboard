import type { AiJob, AiModel, AiModelsResponse } from '@whiteboard/shared';

/** The tutor's AI model picker. Tutor-only on the server. */
export async function fetchAiModels(signal?: AbortSignal): Promise<AiModelsResponse> {
  const res = await fetch('/api/ai/models', { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Model list failed (${res.status})`);
  return (await res.json()) as AiModelsResponse;
}

/** Choose the model a job runs on; throws the server's reason when refused. */
export async function saveAiModel(job: AiJob, model: string): Promise<void> {
  const res = await fetch('/api/ai/models', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job, model }),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error || 'Could not save the model');
  }
}

/** USD with enough digits that a fraction of a cent still reads as a number. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toPrecision(2).replace(/0+$/, '')}`;
}

/**
 * A model's list price in one line, from OpenRouter's per-unit strings. Token
 * prices are quoted per million, as OpenRouter's own pages quote them.
 */
export function formatPrice(job: AiJob, pricing: AiModel['pricing']): string {
  const n = (key: string) => Number(pricing[key] ?? 0);
  const perM = (v: number) => formatUsd(v * 1e6);
  if (n('prompt') < 0) return 'Variable price';
  if (job === 'image') {
    if (n('image') > 0) return `${formatUsd(n('image'))} / image`;
    if (n('image_output') > 0) return `${perM(n('image_output'))} / M image tokens`;
  }
  // Whisper-class listings bill per second of audio with no completion
  // price; token-billed transcribers carry one and fall through below.
  if (job === 'stt' && n('completion') === 0) return `${formatUsd(n('prompt') * 60)} / min`;
  if (n('prompt') === 0 && n('completion') === 0) return 'Free';
  return `${perM(n('prompt'))} in · ${perM(n('completion'))} out / M tokens`;
}
