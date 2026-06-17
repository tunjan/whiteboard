import { create } from 'zustand';

interface ToolStore {
  activeToolId: string;
  setTool: (id: string) => void;
}

// Ephemeral, per-session active tool (not persisted — always starts on select).
export const useToolStore = create<ToolStore>((set) => ({
  activeToolId: 'select',
  setTool: (activeToolId) => set({ activeToolId }),
}));
