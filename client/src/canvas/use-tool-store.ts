import { create } from 'zustand';
import { playPenSound } from './tool-sounds';

interface ToolStore {
  activeToolId: string;
  setTool: (id: string) => void;
}

// Ephemeral, per-session active tool (not persisted — always starts on select).
export const useToolStore = create<ToolStore>((set, get) => ({
  activeToolId: 'select',
  setTool: (activeToolId) => {
    const previous = get().activeToolId;
    if (activeToolId === previous) return;
    // The sound belongs to the transition, not to the toolbar: the pen is
    // reached for by key, by spring-hold and by click, and all three should
    // sound the same.
    if (activeToolId === 'draw') playPenSound(true);
    else if (previous === 'draw') playPenSound(false);
    set({ activeToolId });
  },
}));
