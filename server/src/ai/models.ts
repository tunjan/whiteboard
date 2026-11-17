import { AI_JOBS, type AiJob } from '@whiteboard/shared';
import { db } from '../db/client';
import { aiModels, aiUsage } from '../db/schema';
import { env } from '../env';
import type { CatalogueModel } from './openrouter';

/**
 * Which model runs each AI job, and what each request cost.
 *
 * The tutor's choice lives in `ai_models`; a job without a row runs on its
 * `env.ts` default, so an untouched install behaves exactly as before.
 */

const DEFAULTS: Record<AiJob, string> = {
  vision: env.openRouterVisionModel,
  text: env.openRouterTextModel,
  stt: env.openRouterSttModel,
  image: env.openRouterImageModel,
  agent: env.openRouterAgentModel,
  check: env.openRouterCheckModel,
};

export function isAiJob(value: unknown): value is AiJob {
  return (AI_JOBS as readonly unknown[]).includes(value);
}

/**
 * Whether a model can do a job, from the modalities OpenRouter lists for it:
 * the vision and check jobs send an image, dictation sends audio, stickers want
 * an image back, the agent needs tool calling and image input, and everything else is text in,
 * text out.
 */
export function fits(
  job: AiJob,
  model: Pick<CatalogueModel, 'input' | 'output'> & { tools?: boolean },
): boolean {
  const takes = (m: string) => model.input.includes(m);
  const gives = (m: string) => model.output.includes(m);
  switch (job) {
    case 'vision':
    case 'check':
      return takes('image') && gives('text');
    case 'text':
      return takes('text') && gives('text');
    case 'stt':
      return takes('audio') && gives('transcription');
    case 'image':
      return takes('text') && gives('image');
    case 'agent':
      // It looks at the board when asked about it, so it must read images too.
      return takes('text') && takes('image') && gives('text') && Boolean(model.tools);
  }
}

// Loaded once, then kept in step by `setModel`: one process owns the table.
let chosen: Promise<Map<string, string>> | null = null;

function loadChosen(): Promise<Map<string, string>> {
  chosen ??= db
    .select()
    .from(aiModels)
    .then((rows) => new Map(rows.map((row) => [row.job, row.model])))
    .catch((error: unknown) => {
      chosen = null;
      throw error;
    });
  return chosen;
}

export async function modelFor(job: AiJob): Promise<string> {
  return (await loadChosen()).get(job) ?? DEFAULTS[job];
}

export async function selectedModels(): Promise<Record<AiJob, string>> {
  const map = await loadChosen();
  return Object.fromEntries(
    AI_JOBS.map((job) => [job, map.get(job) ?? DEFAULTS[job]]),
  ) as Record<AiJob, string>;
}

export async function setModel(job: AiJob, model: string): Promise<void> {
  await db
    .insert(aiModels)
    .values({ job, model })
    .onConflictDoUpdate({ target: aiModels.job, set: { model } });
  (await loadChosen()).set(job, model);
}

/**
 * Log one billed request. Never awaited by the route and never throws: a
 * missed row under-reports the bill, which beats failing an answer the
 * student has already paid for.
 */
export function recordUsage(
  boardId: string | undefined,
  job: AiJob,
  model: string,
  cost: number,
): void {
  db.insert(aiUsage)
    .values({ boardId: boardId ?? null, job, model, cost })
    .catch((error: unknown) => console.error('[ai] usage not recorded', error));
}
