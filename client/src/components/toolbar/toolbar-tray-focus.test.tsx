// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/canvas/tools/register';
import { useToolStore } from '@/canvas/use-tool-store';
import { TooltipProvider } from '@/components/ui/tooltip';
import { InkTray } from './toolbar-ink-tray';
import { ShapeTray } from './toolbar-shape-tray';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The style store reads this as it loads, ahead of any `beforeEach`.
vi.hoisted(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});

function Ink() {
  return <InkTray activeToolId={useToolStore((s) => s.activeToolId)} />;
}

function Shapes() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  return <ShapeTray activeToolId={activeToolId} barVisible compact={false} />;
}

/** Arrow keys move the choice, so focus has to move with it. */
async function pressRight(tray: ReactNode, first: string) {
  useToolStore.getState().setTool(first);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<TooltipProvider>{tray}</TooltipProvider>));
  const key = host.querySelector<HTMLElement>('[aria-checked="true"]')!;
  key.focus();
  await act(async () => {
    key.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await new Promise((done) => requestAnimationFrame(done));
  const focused = document.activeElement?.getAttribute('aria-label');
  await act(async () => root.unmount());
  host.remove();
  return focused;
}

describe('tray arrow keys', () => {
  afterEach(() => useToolStore.getState().setTool('select'));

  it('takes focus to the next inking tool', async () => {
    expect(await pressRight(<Ink />, 'draw')).toBe('Highlighter');
  });

  it('takes focus to the next shape', async () => {
    expect(await pressRight(<Shapes />, 'rectangle')).toBe('Ellipse');
  });
});
