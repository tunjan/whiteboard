import { create } from 'zustand';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStore {
  status: ConnectionStatus;
  setStatus: (status: string) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'connecting',
  setStatus: (status) =>
    set({
      status:
        status === 'connected' || status === 'connecting'
          ? status
          : 'disconnected',
    }),
}));
