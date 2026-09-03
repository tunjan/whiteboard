import { lazy, Suspense, useEffect } from 'react';
import { paletteColors, useStyleStore } from '@/canvas/use-style-store';
import { parseBoardId, usePathname } from '@/router';
import { applyTheme, useThemeStore } from '@/use-theme-store';

// The two screens are the app's only routes, and they share almost nothing: the
// board list is a page of cards, while the editor pulls in the canvas engine,
// Yjs and every shape util. Splitting here keeps that engine out of the initial
// download for a visitor who lands on the list.
const Home = lazy(() =>
  import('@/screens/home').then(({ Home }) => ({ default: Home })),
);
const BoardView = lazy(() =>
  import('@/screens/board-view').then(({ BoardView }) => ({
    default: BoardView,
  })),
);

// Router: `/board/:id` opens a board; anything else shows the board list.
export function App() {
  useEffect(() => {
    applyTheme(useThemeStore.getState().theme);
  }, []);

  // Keep the active pen color on the matching swatch when the theme changes, so
  // flipping to dark mode moves the pen to the counterpart color rather than
  // stranding it on an off-theme hex.
  useEffect(() => {
    let prev = paletteColors(useThemeStore.getState().theme);
    const remap = () => {
      const { groups, setColor } = useStyleStore.getState();
      const next = paletteColors(useThemeStore.getState().theme);
      if (next === prev) return;
      // Each instrument remembers its own colour, so each is remapped by its
      // own slot — the highlighter's yellow and the pen's ink move together.
      for (const key of Object.keys(groups) as (keyof typeof groups)[]) {
        const i = prev.findIndex((c) => c.value === groups[key].color);
        if (i !== -1 && next[i]) setColor(key, next[i].value);
      }
      prev = next;
    };
    return useThemeStore.subscribe(remap);
  }, []);

  const path = usePathname();
  const boardId = parseBoardId(path);

  // Opening a board is the near-certain next move from the list, so fetch the
  // editor once the list is interactive rather than on the click. Without this
  // the split would trade a faster first paint for a slower board open.
  useEffect(() => {
    if (boardId) return;
    const prefetch = () => void import('@/screens/board-view');
    if (!window.requestIdleCallback) {
      const timer = setTimeout(prefetch, 1000);
      return () => clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(prefetch);
    return () => window.cancelIdleCallback(handle);
  }, [boardId]);

  // No spinner: both chunks are same-origin and land in well under the time a
  // spinner needs to avoid reading as a flash. The body background shows
  // through, so the page is already the right color.
  return (
    <Suspense fallback={null}>
      {boardId ? <BoardView boardId={boardId} /> : <Home />}
    </Suspense>
  );
}
