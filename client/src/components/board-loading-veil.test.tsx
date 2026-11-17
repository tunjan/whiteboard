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
    // The sheet's own class: the pencil cursor inside it is click-through.
    expect(html.match(/^<div[^>]*class="([^"]*)"/)?.[1]).not.toContain(
      'pointer-events-none',
    );
  });

  it('lets the board through once it is ready', () => {
    const html = render({ ready: true, stage: 'ready' });
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('opacity-0');
  });

  it('finishes the underline when ready', () => {
    const html = render({ ready: true, stage: 'ready' });
    expect(html.match(/stroke-dashoffset:0;/g)).toHaveLength(1);
  });

  it('holds the underline empty until the figure is shown', () => {
    const html = render({ ready: false, stage: 'page' });
    expect(html.match(/stroke-dashoffset:1;/g)).toHaveLength(1);
  });

  it('gives each board its own underline, and the same one every time', () => {
    const algebra = render({ ready: true, stage: 'ready' }, 'Algebra');
    expect(render({ ready: true, stage: 'ready' }, 'Algebra')).toBe(algebra);
    expect(render({ ready: true, stage: 'ready' }, 'Geometry')).not.toBe(
      algebra.replace('Algebra', 'Geometry'),
    );
  });
});
