import { create } from 'zustand';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStore {
  status: ConnectionStatus;
  latencyMs: number | null;
  setStatus: (status: string) => void;
  setLatency: (latencyMs: number | null) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'connecting',
  latencyMs: null,
  setStatus: (status) =>
    set((state) => {
      const nextStatus =
        status === 'connected' || status === 'connecting'
          ? status
          : 'disconnected';
      return {
        status: nextStatus,
        latencyMs: nextStatus === 'connected' ? state.latencyMs : null,
      };
    }),
  setLatency: (latencyMs) => set({ latencyMs }),
}));
