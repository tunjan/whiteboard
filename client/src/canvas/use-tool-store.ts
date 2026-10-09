import { create } from 'zustand';
import { isViewOnly } from '@/board/board-access';
import { playPenSound } from './tool-sounds';

interface ToolStore {
  activeToolId: string;
  setTool: (id: string) => void;
}

const VIEW_ONLY_TOOLS = new Set(['hand', 'laser']);

// Ephemeral, per-session active tool (not persisted — always starts on select).
export const useToolStore = create<ToolStore>((set, get) => ({
  activeToolId: 'select',
  setTool: (activeToolId) => {
    const previous = get().activeToolId;
    if (activeToolId === previous) return;
    // A view-only link can look around and point, nothing else — whether the
    // tool is reached by toolbar, key or spring-hold.
    if (isViewOnly() && !VIEW_ONLY_TOOLS.has(activeToolId)) return;
    // The sound belongs to the transition, not to the toolbar: the pen is
    // reached for by key, by spring-hold and by click, and all three should
    // sound the same.
    if (activeToolId === 'draw') playPenSound(true);
    else if (previous === 'draw') playPenSound(false);
    set({ activeToolId });
  },
}));
