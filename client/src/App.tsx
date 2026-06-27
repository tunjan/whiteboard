import { useEffect } from 'react';
import { paletteColors, useStyleStore } from '@/canvas/use-style-store';
import { parseBoardId, usePathname } from '@/router';
import { BoardView } from '@/screens/board-view';
import { Home } from '@/screens/home';
import { applyTheme, useThemeStore } from '@/use-theme-store';

// Router: `/board/:id` opens a board; anything else shows the board list.
export function App() {
  useEffect(() => {
    applyTheme(useThemeStore.getState().theme);
  }, []);

  // Keep the active pen color on the matching swatch when the palette or theme
  // changes, so flipping to dark mode (or another palette) moves the pen to the
  // counterpart color rather than stranding it on an off-theme hex.
  useEffect(() => {
    let prev = paletteColors(
      useStyleStore.getState().paletteId,
      useThemeStore.getState().theme,
    );
    const remap = () => {
      const { paletteId, color, setColor } = useStyleStore.getState();
      const next = paletteColors(paletteId, useThemeStore.getState().theme);
      if (next === prev) return;
      const i = prev.findIndex((c) => c.value === color);
      if (i !== -1 && next[i]) setColor(next[i].value);
      prev = next;
    };
    const unsubTheme = useThemeStore.subscribe(remap);
    const unsubStyle = useStyleStore.subscribe(remap);
    return () => {
      unsubTheme();
      unsubStyle();
    };
  }, []);

  const path = usePathname();
  const boardId = parseBoardId(path);
  return boardId ? <BoardView boardId={boardId} /> : <Home />;
}
