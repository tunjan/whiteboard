import { useEffect } from 'react';
import { parseBoardId, usePathname } from '@/router';
import { BoardView } from '@/screens/board-view';
import { Home } from '@/screens/home';
import { applyTheme, useThemeStore } from '@/use-theme-store';

// Router: `/board/:id` opens a board; anything else shows the board list.
export function App() {
  useEffect(() => {
    applyTheme(useThemeStore.getState().theme);
  }, []);

  const path = usePathname();
  const boardId = parseBoardId(path);
  return boardId ? <BoardView boardId={boardId} /> : <Home />;
}
