// @vitest-environment happy-dom
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doc = vi.hoisted(() => {
  // Before the persisted stores are created: they bind their storage on import.
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  });
  return { breakUndoCapture: vi.fn(), undo: vi.fn(), redo: vi.fn() };
});

vi.mock('./use-document-store', () => ({
  ...doc,
  editor: { getShape: () => undefined, getShapes: () => [] },
  spatialIndex: { totalBounds: () => null },
}));
vi.mock('./use-hover-store', () => ({
  clearHover: vi.fn(),
  updateHoverAt: vi.fn(),
}));

import { GestureArbiter, type GestureHost } from './gesture-arbiter';
import { toolRegistry } from './tools/tool-registry';
import type { Tool, ToolContext } from './tools/types';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { useSelectionStore } from './use-selection-store';
import { useToolStore } from './use-tool-store';

// Characterisation tests: what the canvas does with a sequence of pointer
// events, pinned as it behaved when this logic lived inside `Canvas.tsx`.

/** A tool that only records what it was told. */
function recorder(id: string, extra: Partial<Tool> = {}) {
  const calls: string[] = [];
  const tool: Tool = {
    id,
    label: id,
    onPointerDown: () => calls.push('down'),
    onPointerMove: () => calls.push('move'),
    onPointerUp: () => calls.push('up'),
    onCancel: () => calls.push('cancel'),
    onCommit: () => calls.push('commit'),
    ...extra,
  };
  toolRegistry.register(tool);
  return calls;
}

const pen = recorder('pen-tool');
const select = recorder('select');
const eraser = recorder('eraser');

let container: HTMLDivElement;
let captured: Set<number>;
let arbiter: GestureArbiter;
let pan: {
  isSpaceDown: boolean;
  beginPan: ReturnType<typeof vi.fn>;
  onPointerMove: ReturnType<typeof vi.fn>;
  onPointerUp: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};
let frames: unknown[];
let menus: MouseEvent[];

type Init = {
  id?: number;
  type?: 'mouse' | 'touch' | 'pen';
  x?: number;
  y?: number;
  t?: number;
  button?: number;
  buttons?: number;
  ctrlKey?: boolean;
  target?: Element;
};

function event(init: Init = {}): ReactPointerEvent {
  const native = {
    clientX: init.x ?? 100,
    clientY: init.y ?? 100,
    timeStamp: init.t ?? 0,
    pointerType: init.type ?? 'mouse',
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: false,
    button: init.button ?? 0,
  };
  return {
    ...native,
    pointerId: init.id ?? 1,
    buttons: init.buttons ?? 1,
    target: init.target ?? container,
    currentTarget: container,
    nativeEvent: native,
    preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent;
}

const down = (init?: Init) => arbiter.onPointerDown(event(init));
const move = (init?: Init) => arbiter.onPointerMove(event(init));
const up = (init?: Init) => arbiter.onPointerUp(event(init));
const finger = (id: number, x: number, t = 0): Init => ({
  id,
  type: 'touch',
  x,
  y: 100,
  t,
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const calls of [pen, select, eraser]) calls.length = 0;
  for (const fn of Object.values(doc)) fn.mockClear();

  container = document.createElement('div');
  document.body.append(container);
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;
  captured = new Set();
  container.setPointerCapture = (id) => void captured.add(id);
  container.hasPointerCapture = (id) => captured.has(id);
  container.releasePointerCapture = (id) => void captured.delete(id);
  menus = [];
  container.addEventListener('contextmenu', (e) => menus.push(e as MouseEvent));
  document.elementFromPoint = () => container;

  pan = {
    isSpaceDown: false,
    beginPan: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    cancel: vi.fn(),
  };
  frames = [];
  arbiter = new GestureArbiter();
  arbiter.host = {
    ctx: {} as ToolContext,
    pan: pan as unknown as GestureHost['pan'],
    edgeScroll: { track: vi.fn(), stop: vi.fn() },
    container: () => container,
    viewportSize: () => ({ width: 800, height: 600 }),
    setQuickZoomFrame: (frame) => frames.push(frame),
  };

  useToolStore.setState({ activeToolId: 'pen-tool' });
  useCanvasUiStore.setState({ fingerAction: 'draw', penSeen: false });
  useCameraStore.getState().setCamera({ x: 0, y: 0, z: 1 });
});

afterEach(() => {
  arbiter.dispose();
  container.remove();
  vi.useRealTimers();
});

describe('a mouse', () => {
  it('drives the active tool from press to release', () => {
    down();
    expect(captured.has(1)).toBe(true);
    move({ x: 120 });
    up({ x: 120 });

    expect(pen).toEqual(['down', 'move', 'up']);
    expect(captured.size).toBe(0);
    // One boundary going in, one coming out.
    expect(doc.breakUndoCapture).toHaveBeenCalledTimes(2);
  });

  it('ignores a press on floating UI inside the canvas', () => {
    const panel = document.createElement('div');
    panel.dataset.uiLayer = '';
    container.append(panel);
    down({ target: panel });
    expect(pen).toEqual([]);
  });

  it('ignores a pointer that is not the one in the gesture', () => {
    down();
    move({ id: 9 });
    up({ id: 9 });
    expect(pen).toEqual(['down']);
  });

  it('keeps a press with the tool it started on, and can end it early', () => {
    down();
    useToolStore.setState({ activeToolId: 'select' });
    move({ x: 120 });
    up({ x: 120 });
    expect(pen).toEqual(['down', 'move', 'up']);
    expect(select).toEqual([]);

    useToolStore.setState({ activeToolId: 'pen-tool' });
    pen.length = 0;
    down();
    expect(arbiter.endToolGestureNow('cancel')).toBe(true);
    move({ x: 130 });
    up({ x: 130 });
    expect(pen).toEqual(['down', 'cancel']);
    expect(arbiter.endToolGestureNow('cancel')).toBe(false);
  });

  it('leaves the selection to a press in flight when a paste lands', () => {
    useSelectionStore.getState().setSelection(['dragged']);
    down();
    arbiter.selectPasted(['pasted']);
    expect(useSelectionStore.getState().selectedIds).toEqual(['dragged']);
    expect(useToolStore.getState().activeToolId).toBe('pen-tool');
    up();

    arbiter.selectPasted(['pasted']);
    expect(useSelectionStore.getState().selectedIds).toEqual(['pasted']);
    expect(useToolStore.getState().activeToolId).toBe('select');
  });

  it('keeps the stroke when the OS takes the pointer away', () => {
    down();
    arbiter.onPointerCancel(event());
    expect(pen).toEqual(['down', 'commit']);

    pen.length = 0;
    down();
    arbiter.onLostPointerCapture(event());
    expect(pen).toEqual(['down', 'commit']);
  });

  it('pans with the middle button, whatever the tool', () => {
    down({ button: 1 });
    move({ button: 1, x: 150 });
    up({ button: 1, x: 150 });

    expect(pen).toEqual([]);
    expect(pan.beginPan).toHaveBeenCalledTimes(1);
    expect(pan.onPointerMove).toHaveBeenCalledTimes(1);
    expect(pan.onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('ends a pan whose capture the OS took away', () => {
    down({ button: 1 });
    arbiter.onLostPointerCapture(event({ button: 1 }));
    expect(pan.cancel).toHaveBeenCalledTimes(1);

    // The capture loss that trails an ordinary release ends nothing twice.
    down({ button: 1 });
    up({ button: 1 });
    arbiter.onLostPointerCapture(event({ button: 1 }));
    expect(pan.cancel).toHaveBeenCalledTimes(1);
    expect(pan.onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('pans while Space is held', () => {
    pan.isSpaceDown = true;
    down();
    expect(pen).toEqual([]);
    expect(pan.beginPan).toHaveBeenCalledTimes(1);
  });

  describe('right button', () => {
    it('opens the menu on release when it did not travel', () => {
      down({ button: 2 });
      // The browser's own event for the press is not ours to show.
      expect(arbiter.takeContextMenuSwallow()).toBe(true);
      up({ button: 2 });

      expect(menus).toHaveLength(1);
      expect(pan.beginPan).not.toHaveBeenCalled();
      // A `contextmenu` that rides the release is swallowed once.
      expect(arbiter.takeContextMenuSwallow()).toBe(true);
      expect(arbiter.takeContextMenuSwallow()).toBe(false);
    });

    it('is what a Ctrl+click is on macOS, never a press of the tool', () => {
      const platform = vi
        .spyOn(navigator, 'platform', 'get')
        .mockReturnValue('MacIntel');
      down({ ctrlKey: true });
      expect(arbiter.takeContextMenuSwallow()).toBe(true);
      up({ ctrlKey: true });
      platform.mockRestore();

      expect(pen).toEqual([]);
      expect(menus).toHaveLength(1);
    });

    it('pans instead once it has travelled, and opens nothing', () => {
      down({ button: 2 });
      move({ button: 2, x: 103 });
      expect(pan.beginPan).not.toHaveBeenCalled();
      move({ button: 2, x: 110 });
      expect(pan.beginPan).toHaveBeenCalledTimes(1);
      up({ button: 2, x: 110 });

      expect(menus).toHaveLength(0);
      expect(pan.onPointerUp).toHaveBeenCalledTimes(1);
    });
  });
});

describe('a finger', () => {
  it('draws when fingers draw', () => {
    down(finger(1, 100));
    move(finger(1, 120));
    up(finger(1, 120));
    expect(pen).toEqual(['down', 'move', 'up']);
  });

  it('discards the stroke when the browser steals the touch', () => {
    down(finger(1, 100));
    arbiter.onPointerCancel(event(finger(1, 100)));
    expect(pen).toEqual(['down', 'cancel']);
  });

  it('gives way to a second finger, and neither draws until both lift', () => {
    down(finger(1, 100));
    down(finger(2, 300));
    expect(pen).toEqual(['down', 'cancel']);

    move(finger(1, 90, 400));
    up(finger(2, 300, 500));
    // One finger still down after a pinch is not a stroke.
    move(finger(1, 80, 600));
    up(finger(1, 80, 700));
    expect(pen).toEqual(['down', 'cancel']);

    down(finger(3, 100, 800));
    expect(pen).toEqual(['down', 'cancel', 'down']);
  });

  it('zooms the board when two fingers spread', () => {
    down(finger(1, 300));
    down(finger(2, 500));
    move(finger(1, 200, 16));
    move(finger(2, 600, 32));
    move(finger(1, 100, 48));
    move(finger(2, 700, 64));
    up(finger(1, 100, 80));

    expect(useCameraStore.getState().camera.z).toBeGreaterThan(1);
    expect(doc.undo).not.toHaveBeenCalled();
  });

  it.each(['draw', 'pan'] as const)(
    'keeps pinching when the first finger loses the capture the second took (%s)',
    (fingerAction) => {
      useCanvasUiStore.setState({ fingerAction });
      // As `useSpacePan` does: a finger pan holds the capture too.
      pan.beginPan.mockImplementation((e: ReactPointerEvent) =>
        e.currentTarget.setPointerCapture(e.pointerId),
      );
      down(finger(1, 300));
      down(finger(2, 500));
      // A browser answers the arbiter's own release with this; the finger is
      // still on the glass.
      arbiter.onLostPointerCapture(event(finger(1, 300, 8)));
      move(finger(1, 200, 16));
      move(finger(2, 600, 32));
      move(finger(1, 100, 48));
      move(finger(2, 700, 64));
      up(finger(1, 100, 80));

      expect(useCameraStore.getState().camera.z).toBeGreaterThan(1);
    },
  );

  it('reads a three-finger tap as redo when a finger shifts between lifts', () => {
    down(finger(1, 100, 1000));
    down(finger(2, 300, 1010));
    down(finger(3, 500, 1020));
    up(finger(1, 100, 1100));
    move(finger(2, 301, 1105));
    up(finger(2, 301, 1110));
    up(finger(3, 500, 1120));
    expect(doc.redo).toHaveBeenCalledTimes(1);
  });

  it('reads a two-finger tap as undo and three as redo', () => {
    down(finger(1, 100, 0));
    down(finger(2, 300, 10));
    up(finger(1, 100, 100));
    up(finger(2, 300, 110));
    expect(doc.undo).toHaveBeenCalledTimes(1);

    down(finger(1, 100, 1000));
    down(finger(2, 300, 1010));
    down(finger(3, 500, 1020));
    up(finger(1, 100, 1100));
    up(finger(2, 300, 1110));
    up(finger(3, 500, 1120));
    expect(doc.redo).toHaveBeenCalledTimes(1);
  });

  it('does not read a slow two-finger rest as undo', () => {
    down(finger(1, 100, 0));
    down(finger(2, 300, 10));
    up(finger(1, 100, 900));
    up(finger(2, 300, 910));
    expect(doc.undo).not.toHaveBeenCalled();
  });

  it('heals from a lift the OS never reported', () => {
    down(finger(1, 100, 0));
    // No pointerup for finger 1. Long afterwards, a new finger is one finger.
    down(finger(2, 300, 5000));
    expect(pen).toEqual(['down', 'down']);
  });

  it('turns a held press into a context menu, discarding the stroke', () => {
    down(finger(1, 100));
    vi.advanceTimersByTime(500);
    expect(pen).toEqual(['down', 'cancel']);
    expect(menus).toHaveLength(1);
  });

  it('keeps drawing when the press travels before the hold elapses', () => {
    down(finger(1, 100));
    move(finger(1, 140));
    vi.advanceTimersByTime(500);
    expect(pen).toEqual(['down', 'move']);
    expect(menus).toHaveLength(0);
  });

  it('never turns a held eraser into a menu', () => {
    useToolStore.setState({ activeToolId: 'eraser' });
    down(finger(1, 100));
    vi.advanceTimersByTime(500);
    expect(eraser).toEqual(['down']);
    expect(menus).toHaveLength(0);
  });

  describe('when fingers pan', () => {
    beforeEach(() => useCanvasUiStore.setState({ fingerAction: 'pan' }));

    it('moves the board and leaves the tool alone', () => {
      down(finger(1, 100, 0));
      move(finger(1, 200, 50));
      up(finger(1, 200, 100));
      expect(pan.beginPan).toHaveBeenCalledTimes(1);
      expect(pan.onPointerUp).toHaveBeenCalledTimes(1);
      expect(pen).toEqual([]);
    });

    it('replays a press that went nowhere as a click', () => {
      down(finger(1, 100, 0));
      up(finger(1, 101, 100));
      expect(pen).toEqual(['down', 'up']);
    });

    it('cancels the pan, not a stroke, when a second finger lands', () => {
      down(finger(1, 100));
      down(finger(2, 300));
      expect(pan.cancel).toHaveBeenCalledTimes(1);
      expect(pen).toEqual([]);
    });
  });

  it('zooms on double-tap-and-drag under the select tool', () => {
    useToolStore.setState({ activeToolId: 'select' });
    down(finger(1, 100, 0));
    up(finger(1, 100, 50));
    down(finger(1, 100, 150));
    move({ ...finger(1, 100, 200), y: 300 });
    up({ ...finger(1, 100, 250), y: 300 });

    expect(useCameraStore.getState().camera.z).toBe(2);
    // The first tap was a click; the second press never reached the tool.
    expect(select).toEqual(['down', 'up']);
  });

  it('draws two dots rather than zooming under a stroke tool', () => {
    down(finger(1, 100, 0));
    up(finger(1, 100, 50));
    down(finger(1, 100, 150));
    expect(pen).toEqual(['down', 'up', 'down']);
  });
});

describe('a stylus', () => {
  const stylus = (id: number, t = 0): Init => ({ id, type: 'pen', t });

  it('takes over from a resting finger and rejects the palm after it', () => {
    down(finger(1, 100));
    down(stylus(2));
    expect(pen).toEqual(['down', 'cancel', 'down']);

    down(finger(3, 400, 10));
    move(finger(3, 420, 20));
    expect(pen).toEqual(['down', 'cancel', 'down']);

    up(stylus(2, 30));
    expect(pen).toEqual(['down', 'cancel', 'down', 'up']);
  });

  it('is not cut off by the resting palm’s long press', () => {
    down(finger(1, 100));
    down(stylus(2, 50));
    vi.advanceTimersByTime(1000);
    expect(pen).toEqual(['down', 'cancel', 'down']);
    expect(menus).toEqual([]);
  });

  it('ends a palm pan, so the pan does not outlive it', () => {
    useCanvasUiStore.setState({ fingerAction: 'pan' });
    down(finger(1, 100));
    down(stylus(2, 50));
    vi.advanceTimersByTime(1000);
    expect(pan.cancel).toHaveBeenCalledTimes(1);
    expect(pen).toEqual(['down']);
    expect(menus).toEqual([]);
  });

  it('does not read a palm lifting after a quick mark as undo', () => {
    down(finger(1, 100));
    down(finger(2, 300, 10));
    down(stylus(3, 50));
    up(stylus(3, 100));
    up(finger(1, 100, 150));
    up(finger(2, 300, 160));
    expect(doc.undo).not.toHaveBeenCalled();
  });

  it('does not let a resting palm zoom the board once the pen lifts', () => {
    down(finger(1, 100));
    down(finger(2, 300, 10));
    down(stylus(3, 50));
    up(stylus(3, 100));
    move(finger(1, 140, 120));
    move(finger(2, 380, 120));
    up(finger(1, 140, 150));
    up(finger(2, 380, 160));
    expect(doc.undo).not.toHaveBeenCalled();
    expect(useCameraStore.getState().camera.z).toBe(1);
  });

  it('keeps the previous stroke when its lift was never reported', () => {
    down(stylus(1));
    // Wacom tablets bump the pointer id per stroke; no pointerup arrived.
    down(stylus(2, 100));
    expect(pen).toEqual(['down', 'commit', 'down']);
  });

  it('is remembered, so fingers stop drawing under `auto`', () => {
    useCanvasUiStore.setState({ fingerAction: 'auto' });
    down(stylus(1));
    up(stylus(1, 10));
    pen.length = 0;

    down(finger(2, 100, 20));
    expect(pen).toEqual([]);
    expect(pan.beginPan).toHaveBeenCalledTimes(1);
  });
});

describe('Quick Zoom', () => {
  it('takes the press from the tool and frames until release', () => {
    arbiter.quickZoomArmed = true;
    down();
    expect(pen).toEqual([]);
    expect(frames.at(-1)).toMatchObject({ center: { x: 100, y: 100 } });

    move({ x: 300, y: 200 });
    expect(frames.at(-1)).toMatchObject({ center: { x: 300, y: 200 } });

    up({ x: 300, y: 200 });
    expect(frames.at(-1)).toBeNull();
    expect(captured.size).toBe(0);
  });

  it('frames rather than zooms after a one-finger zoom was cut short', () => {
    useToolStore.setState({ activeToolId: 'select' });
    down(finger(1, 100, 0));
    up(finger(1, 100, 50));
    down(finger(1, 100, 150));
    down(finger(2, 300, 200));
    up(finger(1, 100, 250));
    up(finger(2, 300, 260));

    arbiter.quickZoomArmed = true;
    down({ id: 7, x: 400, y: 300 });
    const z = useCameraStore.getState().camera.z;
    frames.length = 0;
    move({ id: 7, x: 400, y: 400 });
    expect(frames).toHaveLength(1);
    expect(useCameraStore.getState().camera.z).toBe(z);
  });
});

describe('a held tool hotkey', () => {
  const key = (t: number) => ({ key: 'e', timeStamp: t }) as KeyboardEvent;
  const hold = { key: 'e', from: 'pen-tool', to: 'eraser', at: 0, used: false };

  beforeEach(() => useToolStore.setState({ activeToolId: 'eraser' }));

  it('stays switched after a tap', () => {
    arbiter.armSpring({ ...hold });
    arbiter.releaseSpring(key(100));
    expect(useToolStore.getState().activeToolId).toBe('eraser');
  });

  it('springs back once the borrowed tool was used', () => {
    arbiter.armSpring({ ...hold });
    down();
    up();
    arbiter.releaseSpring(key(100));
    expect(useToolStore.getState().activeToolId).toBe('pen-tool');
  });

  it('waits for the stroke in flight before springing back', () => {
    arbiter.armSpring({ ...hold });
    down();
    arbiter.releaseSpring(key(100));
    expect(useToolStore.getState().activeToolId).toBe('eraser');
    up();
    expect(eraser).toEqual(['down', 'up']);
    expect(useToolStore.getState().activeToolId).toBe('pen-tool');
  });
});

describe('abandoning everything for a page switch', () => {
  it('keeps the stroke in flight and lets go of the pointer', () => {
    down();
    arbiter.abandonAll();
    expect(pen).toEqual(['down', 'commit']);
    expect(captured.size).toBe(0);
    expect(arbiter.pointer).toBeNull();

    move({ x: 150 });
    up({ x: 150 });
    expect(pen).toEqual(['down', 'commit']);
  });

  it('cancels a pan', () => {
    down({ button: 1 });
    arbiter.abandonAll();
    expect(pan.cancel).toHaveBeenCalledTimes(1);
    move({ button: 1, x: 150 });
    expect(pan.onPointerMove).not.toHaveBeenCalled();
  });

  it('forgets fingers on the glass, so the next one is a fresh stroke', () => {
    down(finger(1, 100));
    down(finger(2, 300));
    arbiter.abandonAll();
    pen.length = 0;

    down(finger(3, 100, 10));
    expect(pen).toEqual(['down']);
    // The abandoned pair was not a tap.
    up(finger(3, 100, 20));
    expect(doc.undo).not.toHaveBeenCalled();
  });

  it('closes Quick Zoom without flying anywhere', () => {
    arbiter.quickZoomArmed = true;
    down();
    arbiter.abandonAll();
    expect(frames.at(-1)).toBeNull();
  });
});
