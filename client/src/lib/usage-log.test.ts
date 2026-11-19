// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

// The stores persist; their storage is read as they are created, at import.
vi.hoisted(() => {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
});
import { useToolStore } from '@/canvas/use-tool-store';
import { startUsageLog } from './usage-log';

it('logs a toolbar press, a key, and the tool change each caused', () => {
  const fetch = vi.fn(() => Promise.resolve(new Response()));
  vi.stubGlobal('fetch', fetch);
  const stop = startUsageLog('b1');

  document.body.innerHTML =
    '<div data-canvas-toolbar><button aria-label="Pen">x</button></div><div data-canvas-surface></div>';
  document.querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen' }));
  useToolStore.getState().setTool('draw');
  document.querySelector('[data-canvas-surface]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
  useToolStore.getState().setTool('select');
  stop();

  const rows: string[][] = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).rows;
  const brief = rows.map((r) => [r[3], r[4], r[5], r[6], r[8]].join('|'));
  expect(brief.slice(1)).toEqual([
    'press|select|Pen|toolbar|',
    'tool|select|draw|press:Pen|0',
    'key|draw|v||',
    'tool|draw|select|key:v|1',
    'session|select|end||',
  ]);
  expect(rows[1]?.[9]).toBe('pen');
});
