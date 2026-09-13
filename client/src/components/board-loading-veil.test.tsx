import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BoardLoadStage } from '@/board/board-readiness';
import { BoardLoadingVeil } from './board-loading-veil';

// Zustand hands `useSyncExternalStore` its *initial* state as the server
// snapshot, so a server-rendered component never sees `setState`. The store is
// stubbed instead, which is also what lets one render pin one stage.
const store = vi.hoisted(() => ({
  state: { ready: false, stage: 'local' as BoardLoadStage },
}));

vi.mock('@/board/use-board-loading-store', () => ({
  useBoardLoadingStore: (selector: (s: typeof store.state) => unknown) =>
    selector(store.state),
}));

function render(
  state: { ready: boolean; stage: BoardLoadStage },
  title = 'Algebra',
) {
  store.state = state;
  return renderToStaticMarkup(<BoardLoadingVeil title={title} />);
}

describe('BoardLoadingVeil', () => {
  it('covers the board and names the stage while it is joining', () => {
    const html = render({ ready: false, stage: 'remote' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Syncing board');
    expect(html).toContain('Algebra');
    expect(html).not.toContain('pointer-events-none');
  });

  it('lets the board through once it is ready', () => {
    const html = render({ ready: true, stage: 'ready' });
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('opacity-0');
  });

  it('fills the rule completely when ready', () => {
    expect(render({ ready: true, stage: 'ready' })).toContain('scaleX(1)');
  });
});
