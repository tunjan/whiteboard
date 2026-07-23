import { create } from 'zustand';
import {
  DEFAULT_GATE_THRESHOLD_DB,
  MIN_VOICE_LEVEL_DB,
  clampGateThreshold,
  clampVoiceLevel,
} from './voice-gate';

export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'joined'
  | 'test-connecting'
  | 'testing';
export type VoicePeerStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

interface VoiceStore {
  status: VoiceStatus;
  muted: boolean;
  noiseCancellation: boolean;
  gateThresholdDb: number;
  inputLevelDb: number;
  speaking: boolean;
  error: string | null;
  remotes: Map<number, MediaStream>;
  peerStatuses: Map<number, VoicePeerStatus>;
  setStatus: (status: VoiceStatus) => void;
  setMuted: (muted: boolean) => void;
  setNoiseCancellation: (enabled: boolean) => void;
  setGateThreshold: (thresholdDb: number) => void;
  setInputLevel: (levelDb: number, speaking: boolean) => void;
  setError: (error: string | null) => void;
  setRemote: (clientId: number, stream: MediaStream | null) => void;
  setPeerStatus: (
    clientId: number,
    status: VoicePeerStatus | null,
  ) => void;
  resetSession: () => void;
}

const NOISE_CANCELLATION_STORAGE_KEY =
  'whiteboard:voice-noise-cancellation';
const GATE_THRESHOLD_STORAGE_KEY = 'whiteboard:voice-gate-threshold-db';

function readStoredNoiseCancellation(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(
      NOISE_CANCELLATION_STORAGE_KEY,
    );
    return stored === null ? true : stored !== 'false';
  } catch {
    return true;
  }
}

function storeNoiseCancellation(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      NOISE_CANCELLATION_STORAGE_KEY,
      String(enabled),
    );
  } catch {
    // Storage can be unavailable in hardened/private contexts; the live device
    // preference still works for this session.
  }
}

function readStoredGateThreshold(): number {
  if (typeof window === 'undefined') return DEFAULT_GATE_THRESHOLD_DB;
  try {
    const stored = window.localStorage.getItem(GATE_THRESHOLD_STORAGE_KEY);
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(parsed)
      ? clampGateThreshold(parsed)
      : DEFAULT_GATE_THRESHOLD_DB;
  } catch {
    return DEFAULT_GATE_THRESHOLD_DB;
  }
}

function storeGateThreshold(thresholdDb: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      GATE_THRESHOLD_STORAGE_KEY,
      String(thresholdDb),
    );
  } catch {
    // The live threshold still works when local storage is unavailable.
  }
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  status: 'idle',
  muted: true,
  noiseCancellation: readStoredNoiseCancellation(),
  gateThresholdDb: readStoredGateThreshold(),
  inputLevelDb: MIN_VOICE_LEVEL_DB,
  speaking: false,
  error: null,
  remotes: new Map(),
  peerStatuses: new Map(),
  setStatus: (status) => set({ status }),
  setMuted: (muted) => set({ muted }),
  setNoiseCancellation: (noiseCancellation) => {
    storeNoiseCancellation(noiseCancellation);
    set({ noiseCancellation });
  },
  setGateThreshold: (nextThresholdDb) => {
    const gateThresholdDb = clampGateThreshold(nextThresholdDb);
    storeGateThreshold(gateThresholdDb);
    set({ gateThresholdDb });
  },
  setInputLevel: (levelDb, speaking) =>
    set({
      inputLevelDb: clampVoiceLevel(levelDb),
      speaking,
    }),
  setError: (error) => set({ error }),
  setRemote: (clientId, stream) =>
    set((state) => {
      if (
        (stream && state.remotes.get(clientId) === stream) ||
        (!stream && !state.remotes.has(clientId))
      ) {
        return state;
      }
      const remotes = new Map(state.remotes);
      if (stream) remotes.set(clientId, stream);
      else remotes.delete(clientId);
      return { remotes };
    }),
  setPeerStatus: (clientId, status) =>
    set((state) => {
      if (
        state.peerStatuses.get(clientId) === status ||
        (status === null && !state.peerStatuses.has(clientId))
      ) {
        return state;
      }
      const peerStatuses = new Map(state.peerStatuses);
      if (status) peerStatuses.set(clientId, status);
      else peerStatuses.delete(clientId);
      return { peerStatuses };
    }),
  resetSession: () =>
    set({
      status: 'idle',
      muted: true,
      inputLevelDb: MIN_VOICE_LEVEL_DB,
      speaking: false,
      error: null,
      remotes: new Map(),
      peerStatuses: new Map(),
    }),
}));
