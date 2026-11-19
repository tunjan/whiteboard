import { isTypingTarget } from '@/canvas/canvas-shortcuts';
import { useHistoryStep } from '@/canvas/page-history';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { useToolStore } from '@/canvas/use-tool-store';

/**
 * The tutor's toolbar and tool use, as raw rows for `server/data/usage.csv`,
 * so toolbar decisions can be made from what was actually done in lessons.
 *
 * One row per event; the columns match `USAGE_COLUMNS` on the server:
 *   ts, session, board, event, tool, target, value, ms, count, pointer
 *
 * - `session` — once per board open: value = viewport, placement, input.
 * - `press`   — a press on any chrome (bar, trays, menus, corners):
 *               target = the control's label, value = where it sits.
 * - `key`     — a key pressed over the board (never while typing).
 * - `tool`    — the active tool changed: tool = the one left, target = the
 *               one picked, ms = time spent in the one left, count = presses
 *               on the board while it was held, value = what caused the change
 *               (the press or key just before, else `auto`: spring-hold
 *               return, revert after placing, agent, view-only switch).
 * - `style`   — a style setting changed by hand: target = field, value = new.
 * - `history` — an undo/redo step, from wherever it came.
 */

type Row = (string | number)[];

const FLUSH_MS = 15_000;
/** How recent an input must be to count as the cause of a tool change. */
const CAUSE_MS = 400;

function label(el: Element): string {
  const text =
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent?.replace(/\s+/g, ' ').trim() ||
    el.tagName.toLowerCase();
  return text.slice(0, 60);
}

function area(el: Element): string {
  if (el.closest('[data-canvas-toolbar]')) return 'toolbar';
  if (el.closest('[role="menu"], [role="listbox"], [role="dialog"]')) return 'menu';
  if (el.closest('[data-ui-layer]')) return 'chrome';
  return 'other';
}

const keyName = (e: KeyboardEvent) =>
  [e.metaKey && 'Meta', e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.key]
    .filter(Boolean)
    .join('+');

const fmt = (v: unknown) =>
  typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);

/** Start logging for this board; returns the stop function. */
export function startUsageLog(boardId: string): () => void {
  const session = crypto.randomUUID().slice(0, 8);
  let rows: Row[] = [];
  let pointer = 'mouse';
  let lastCause = { at: 0, what: '' };
  let toolSince = performance.now();
  let toolUses = 0;

  const push = (event: string, target: string, value = '', ms: number | '' = '', count: number | '' = '') =>
    rows.push([
      new Date().toISOString(),
      session,
      boardId,
      event,
      useToolStore.getState().activeToolId,
      target,
      value,
      ms,
      count,
      pointer,
    ]);

  const flush = () => {
    if (!rows.length) return;
    const body = JSON.stringify({ rows });
    rows = [];
    // keepalive lets the last batch out as the tab closes.
    void fetch('/api/usage', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {});
  };

  push(
    'session',
    'start',
    [
      `${innerWidth}x${innerHeight}`,
      useCanvasUiStore.getState().toolbarPlacement,
      matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    ].join(' '),
  );

  const onPointerDown = (e: PointerEvent) => {
    pointer = e.pointerType || pointer;
    const target = e.target as Element;
    if (target.closest('[data-canvas-surface]')) {
      toolUses++;
      return;
    }
    const control = target.closest(
      'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], [role="slider"], input, a',
    );
    if (!control) return;
    const name = label(control);
    lastCause = { at: performance.now(), what: `press:${name}` };
    push('press', name, area(control));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || isTypingTarget(e.target)) return;
    if (['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) return;
    const name = keyName(e);
    lastCause = { at: performance.now(), what: `key:${name}` };
    push('key', name);
  };

  const unsubs = [
    useToolStore.subscribe((s, prev) => {
      if (s.activeToolId === prev.activeToolId) return;
      const now = performance.now();
      const cause = now - lastCause.at < CAUSE_MS ? lastCause.what : 'auto';
      rows.push([
        new Date().toISOString(),
        session,
        boardId,
        'tool',
        prev.activeToolId,
        s.activeToolId,
        cause,
        Math.round(now - toolSince),
        toolUses,
        pointer,
      ]);
      toolSince = now;
      toolUses = 0;
    }),
    useStyleStore.subscribe((s, prev) => {
      // A slot change swaps every field at once; that is the tool change
      // above, not a choice.
      if (s.slot !== prev.slot) return;
      for (const key of Object.keys(s) as (keyof typeof s)[]) {
        const next = s[key];
        if (typeof next === 'function' || key === 'slots') continue;
        if (fmt(next) !== fmt(prev[key])) push('style', key, fmt(next).slice(0, 200));
      }
    }),
    useToolLockStore.subscribe((s, prev) => {
      if (s.locked !== prev.locked) push('style', 'toolLock', String(s.locked));
    }),
    useCanvasUiStore.subscribe((s, prev) => {
      if (s.toolbarPlacement !== prev.toolbarPlacement)
        push('style', 'toolbarPlacement', s.toolbarPlacement);
    }),
    useHistoryStep.subscribe((s) => push('history', s.dir)),
  ];

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('visibilitychange', onHide);
  const timer = setInterval(flush, FLUSH_MS);

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('visibilitychange', onHide);
    clearInterval(timer);
    unsubs.forEach((u) => u());
    push('session', 'end');
    flush();
  };
}
