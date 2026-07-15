import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PenPreset {
  color: string;
  size: number;
}

const DEFAULT_PRESETS: PenPreset[] = [
  { color: '#274001', size: 4 },
  { color: '#f25c05', size: 4 },
  { color: '#2563eb', size: 8 },
];

interface PenPresetsStore {
  /** The 3 pen presets (color + size), like Miro's pen slots. */
  presets: PenPreset[];
  /** Index of the currently selected preset. */
  activeIndex: number;
  setActive: (index: number) => void;
  /** Patches the active preset in place (used when the style panel's color/size
   * controls are changed while the draw tool is active). */
  updateActive: (patch: Partial<PenPreset>) => void;
}

// The pen tool's 3 color/size presets. Persisted locally, same pattern as
// useStyleStore.
export const usePenPresetsStore = create<PenPresetsStore>()(
  persist(
    (set) => ({
      presets: DEFAULT_PRESETS,
      activeIndex: 0,
      setActive: (activeIndex) => set({ activeIndex }),
      updateActive: (patch) =>
        set((state) => ({
          presets: state.presets.map((preset, i) =>
            i === state.activeIndex ? { ...preset, ...patch } : preset,
          ),
        })),
    }),
    { name: 'whiteboard:pen-presets' },
  ),
);
