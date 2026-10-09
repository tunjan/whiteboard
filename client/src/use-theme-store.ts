import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

/**
 * `--bg-canvas` per theme. Safari tints the iPad tab bar, and the status bar of
 * a Home Screen install, with `theme-color`; the app picks its theme itself
 * rather than following the OS, so the meta has to follow the app.
 */
const THEME_COLOR: Record<Theme, string> = {
  light: '#fafafa',
  dark: '#0a0a0a',
};

/** Toggle the `.dark` class that drives the CSS-variable theme. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', THEME_COLOR[theme]);
  }
}

interface ThemeStore {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

// Minimal light/dark toggle (Phase 22 adds the Settings dialog + persistence of
// related canvas prefs). Persisted locally.
export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggle: () => {
        const next: Theme = get().theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        set({ theme: next });
      },
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: 'whiteboard:theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
