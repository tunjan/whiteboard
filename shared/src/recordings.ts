/** Metadata for a saved animation recording; the payload lives server-side. */
export interface RecordingMeta {
  /** Client-minted via genId() so create is idempotent/retryable. */
  id: string;
  boardId: string;
  pageId: string;
  name: string;
  durationMs: number;
  createdAt: number;
}

export const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
export const MAX_RECORDING_NAME_LENGTH = 120;
