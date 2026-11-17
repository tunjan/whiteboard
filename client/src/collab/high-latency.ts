const HIGH_LATENCY_THRESHOLD_MS = 1_000;
/** Lower than the way in, so a link hovering at the threshold can't flap. */
const RECOVERED_THRESHOLD_MS = 700;

export interface HighLatencyEpisodeTransition {
  active: boolean;
  shouldNotify: boolean;
}

/** Advance the once-per-episode notification state for a latency sample. */
export function nextHighLatencyEpisode(
  wasActive: boolean,
  latencyMs: number | null,
): HighLatencyEpisodeTransition {
  const active =
    latencyMs !== null &&
    latencyMs >
      (wasActive ? RECOVERED_THRESHOLD_MS : HIGH_LATENCY_THRESHOLD_MS);

  return {
    active,
    shouldNotify: active && !wasActive,
  };
}
