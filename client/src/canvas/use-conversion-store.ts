import { create } from 'zustand';
import type { Bounds, Shape } from '@whiteboard/shared';

/** Must match the `equation-settle` keyframe duration in index.css. */
export const SETTLE_MS = 260;

interface ConversionStore {
  /** World bounds of the handwriting being read; null when nothing is in flight. */
  reading: Bounds | null;
  /** The equation that just took its source's place, for its arrival animation. */
  arrivedId: string | null;
  /**
   * The last conversion's source, kept as a local snapshot so the transcription
   * can be checked against what was written. Outside the document on purpose,
   * like a vanish ghost: it is not selectable, not exported, and peers never see
   * it. One entry — the next conversion replaces it.
   */
  original: { equationId: string; shapes: Shape[] } | null;
  /** The compare control is held down: draw `original` over the equation. */
  peeking: boolean;
}

export const useConversionStore = create<ConversionStore>(() => ({
  reading: null,
  arrivedId: null,
  original: null,
  peeking: false,
}));

let arrivalTimer: ReturnType<typeof setTimeout> | undefined;

/** Mark `equationId` as just arrived for one settle animation. */
export function markArrived(equationId: string): void {
  clearTimeout(arrivalTimer);
  useConversionStore.setState({ arrivedId: equationId });
  arrivalTimer = setTimeout(
    () => useConversionStore.setState({ arrivedId: null }),
    SETTLE_MS,
  );
}

export function setPeeking(peeking: boolean): void {
  if (useConversionStore.getState().peeking === peeking) return;
  useConversionStore.setState({ peeking });
}
