import { create } from 'zustand';
import {
  ALL_FEATURES,
  TOOL_FEATURE,
  type Feature,
  type FeatureSet,
} from '@whiteboard/shared';
import { boardKey } from './board-access';

/**
 * What the open board offers (`features.ts` in @whiteboard/shared), as the
 * server last said. Fetched on open and again whenever the tutor changes it
 * (the `FEATURES_MESSAGE` over the board socket).
 *
 * Until it answers, everything shows except AI, which is held back so a board
 * without it never flashes buttons that would fail.
 */
export const useFeaturesStore = create<{ features: FeatureSet }>(() => ({
  features: { ...ALL_FEATURES, ai: false },
}));

export const useFeature = (feature: Feature) =>
  useFeaturesStore((s) => s.features[feature]);

export const hasFeature = (feature: Feature) =>
  useFeaturesStore.getState().features[feature];

/** Whether a tool's feature (if it has one) is on. */
export function toolOffered(toolId: string): boolean {
  const feature = TOOL_FEATURE[toolId];
  return !feature || hasFeature(feature);
}

/** {@link toolOffered} as a hook: re-renders when the board's features change. */
export function useToolOffered(toolId: string): boolean {
  const feature = TOOL_FEATURE[toolId];
  return useFeaturesStore((s) => !feature || s.features[feature]);
}

let loading = 0;

export async function loadFeatures(boardId: string): Promise<void> {
  const ticket = ++loading;
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/features`, {
      credentials: 'include',
      headers: { 'X-Board-Key': boardKey() },
    });
    // A later load (another board, a newer change) wins over a slow one.
    if (!res.ok || ticket !== loading) return;
    useFeaturesStore.setState({ features: (await res.json()) as FeatureSet });
  } catch {
    // Offline: keep what we had. The board still draws.
  }
}

// --- The tutor's controls (tutor-gated server-side) ---

async function send(url: string, method: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Saving features failed (${res.status})`);
  return res;
}

/** A board's own set, or null to follow the defaults. Peers refetch on their own. */
export async function setBoardFeatures(
  boardId: string,
  features: FeatureSet | null,
): Promise<void> {
  await send(`/api/boards/${encodeURIComponent(boardId)}/access`, 'PATCH', { features });
}

export async function fetchDefaultFeatures(): Promise<FeatureSet> {
  const res = await fetch('/api/settings/features', { credentials: 'include' });
  if (!res.ok) throw new Error(`Loading features failed (${res.status})`);
  return (await res.json()) as FeatureSet;
}

export async function setDefaultFeatures(features: FeatureSet): Promise<FeatureSet> {
  const res = await send('/api/settings/features', 'PUT', features);
  return (await res.json()) as FeatureSet;
}
