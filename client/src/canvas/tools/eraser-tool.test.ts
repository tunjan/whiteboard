import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { decodeEphemeral, type Shape } from '@whiteboard/shared';
import { setActiveAwareness } from '@/collab/presence';
import '../shapes/register';
import type { Editor, ShapePatch } from '../editor';
import { shapeRotatedBounds } from '../shape-bounds';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useEraserCutStore } from '../use-eraser-cut-store';
import { useEraserStore } from '../use-eraser-store';
import {
  ERASER_TRAIL_SIZE,
  useEraserTrailStore,
} from '../use-eraser-trail-store';
import { createEraserTool, ERASER_SCREEN_RADIUS } from './eraser-tool';
import type { ToolContext, ToolPointerInfo } from './types';

function rectangle(): Extract<Shape, { type: 'rectangle' }> {
  return {
    id: 'target',
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      w: 40,
      h: 30,
      color: '#111',
      fillStyle: 'solid',
      dash: 'solid',
      size: 2,
    },
  };
}

function textShape(): Extract<Shape, { type: 'text' }> {
  return {
    id: 'label',
    type: 'text',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      text: 'Erase me',
      color: '#111',
      fontSize: 24,
      fontFamily: 'sans',
      sizingMode: 'auto',
      width: 0,
      lineHeight: 1.2,
      align: 'start',
    },
  };
}

/** A horizontal pen stroke from (0,0) to (200,0), sampled every world unit. */
function stroke(): Extract<Shape, { type: 'draw' }> {
  const points = [];
  for (let x = 0; x <= 200; x++) points.push({ x, y: 0, pressure: 0.5 });
  return {
    id: 'ink',
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      points,
      isClosed: false,
      color: '#111',
      size: 4,
      dash: 'solid',
      fillStyle: 'none',
    },
  };
}

function pointer(x: number, y: number): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: 'pen',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
  };
}

interface Harness {
  ctx: ToolContext;
  shapes: Map<string, Shape>;
  created: Shape[];
  updated: [string, ShapePatch][];
  transacts: number;
}

function context(...initial: Shape[]): Harness {
  const shapes = new Map(initial.map((shape) => [shape.id, shape]));
  for (const shape of initial)
    spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
  const created: Shape[] = [];
  const updated: [string, ShapePatch][] = [];
  const harness = { shapes, created, updated, transacts: 0 } as Harness;
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (next) => {
      created.push(next);
      shapes.set(next.id, next);
    },
    updateShape: (id, patch) => {
      updated.push([id, patch]);
    },
    deleteShapes: (ids) => {
      for (const id of ids) {
        shapes.delete(id);
        spatialIndex.remove(id);
      }
    },
    transact: (fn) => {
      harness.transacts++;
      fn();
    },
  };
  harness.ctx = { editor, setTool: () => undefined, complete: () => undefined };
  return harness;
}

beforeEach(() => {
  useEraserTrailStore.getState().clear();
});

afterEach(() => {
  useEraserTrailStore.getState().clear();
});

describe('eraser tool stroke lifecycle', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  });

  afterEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
  });

  it('commits queued targets when a pen or mouse gesture loses capture', () => {
    const { ctx, shapes } = context(rectangle());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(20, 15), ctx);
    tool.onPointerMove?.(pointer(24, 15), ctx);
    expect(useEraserStore.getState().isMarked('target')).toBe(true);

    tool.onCommit?.(ctx);

    expect(shapes.has('target')).toBe(false);
    expect(useEraserStore.getState().marked).toEqual({});
  });

  it('deletes text on a discrete click instead of treating it as a container', () => {
    const { ctx, shapes } = context(textShape());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(20, 12), ctx);
    expect(useEraserStore.getState().isMarked('label')).toBe(true);
    tool.onPointerUp?.(pointer(20, 12), ctx);

    expect(shapes.has('label')).toBe(false);
  });

  it('lands the contact patch on the press, and lifts it on release', () => {
    const { ctx } = context(rectangle());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(20, 15), ctx);
    expect(useEraserTrailStore.getState().scribbles[0]).toMatchObject({
      state: 'active',
      points: [{ x: 20, y: 15 }],
    });

    tool.onPointerUp?.(pointer(20, 15), ctx);
    expect(useEraserTrailStore.getState().scribbles[0]?.state).toBe('stopping');
  });

  it('sizes the ribbon to what the swipe actually takes', () => {
    expect(ERASER_TRAIL_SIZE).toBe(ERASER_SCREEN_RADIUS * 2);
  });

  it('promotes a sustained unmodified press so a wobble still erases', () => {
    vi.useFakeTimers();
    try {
      const { ctx } = context(rectangle());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(500, 500), ctx);
      vi.advanceTimersByTime(500);
      tool.onPointerMove?.(pointer(21, 15), ctx);

      expect(useEraserStore.getState().isMarked('target')).toBe(true);
      tool.onCancel?.(ctx);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('precision mode', () => {
    beforeEach(() => {
      useCanvasUiStore.getState().setEraserMode('precision');
    });

    it('cuts a stroke in two and writes both halves in one transaction', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, -20), harness.ctx);
      tool.onPointerMove?.(pointer(100, 20), harness.ctx);

      // The document is untouched until release; the preview carries the cut.
      expect(harness.updated).toHaveLength(0);
      expect(useEraserCutStore.getState().fragments.ink).toHaveLength(2);

      tool.onPointerUp?.(pointer(100, 20), harness.ctx);

      expect(harness.transacts).toBe(1);
      // The near half keeps the original id; the far half becomes a new shape.
      expect(harness.updated.map(([id]) => id)).toEqual(['ink']);
      expect(harness.created).toHaveLength(1);
      expect(harness.created[0]!.id).not.toBe('ink');
      expect(harness.shapes.has('ink')).toBe(true);

      const kept = harness.updated[0]![1].props?.points as { x: number }[];
      const split = (harness.created[0]! as Extract<Shape, { type: 'draw' }>)
        .props.points;
      expect(kept[kept.length - 1]!.x).toBeLessThan(100);
      expect(split[0]!.x).toBeGreaterThan(100);
      expect(useEraserCutStore.getState().fragments).toEqual({});
    });

    it('deletes a stroke outright once the swipe covers all of it', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(-20, 0), harness.ctx);
      tool.onPointerMove?.(pointer(220, 0), harness.ctx);
      tool.onPointerUp?.(pointer(220, 0), harness.ctx);

      expect(harness.created).toHaveLength(0);
      expect(harness.shapes.has('ink')).toBe(false);
    });

    it('still removes an uncuttable shape whole', () => {
      const harness = context(rectangle());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(20, 15), harness.ctx);
      expect(useEraserStore.getState().isMarked('target')).toBe(true);

      tool.onPointerUp?.(pointer(20, 15), harness.ctx);

      expect(harness.shapes.has('target')).toBe(false);
      expect(harness.created).toHaveLength(0);
    });

    it('writes nothing when the stroke is cancelled mid-cut', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, -20), harness.ctx);
      tool.onPointerMove?.(pointer(100, 20), harness.ctx);
      tool.onCancel?.(harness.ctx);

      expect(harness.transacts).toBe(0);
      expect(harness.updated).toHaveLength(0);
      expect(harness.shapes.has('ink')).toBe(true);
      expect(useEraserCutStore.getState().fragments).toEqual({});
    });

    it('leaves a stroke alone when the swipe misses it', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, 60), harness.ctx);
      tool.onPointerMove?.(pointer(140, 60), harness.ctx);
      tool.onPointerUp?.(pointer(140, 60), harness.ctx);

      expect(harness.transacts).toBe(0);
      expect(harness.shapes.has('ink')).toBe(true);
    });
  });

  it('cycles the mode when the eraser hotkey is pressed while active', () => {
    const { ctx } = context();
    const tool = createEraserTool();
    const press = (key: string) =>
      tool.onKeyDown?.({ key } as unknown as KeyboardEvent, ctx);

    expect(press('e')).toBe(true);
    expect(useCanvasUiStore.getState().eraserMode).toBe('precision');

    press('e');
    expect(useCanvasUiStore.getState().eraserMode).toBe('object');

    // Anything else falls through to the canvas shortcuts.
    expect(press('v')).toBe(false);
  });
});

/** A short horizontal pen stroke of length 20 starting at (x, y). */
function ink(
  id: string,
  x: number,
  y: number,
  extra: Partial<Shape> = {},
): Extract<Shape, { type: 'draw' }> {
  return {
    id,
    type: 'draw',
    x,
    y,
    rotation: 0,
    index: 'a1',
    props: {
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 10, y: 0, pressure: 0.5 },
        { x: 20, y: 0, pressure: 0.5 },
      ],
      isClosed: false,
      color: '#111',
      size: 4,
      dash: 'solid',
      fillStyle: 'none',
    },
    ...extra,
  } as Extract<Shape, { type: 'draw' }>;
}

function group(id: string): Extract<Shape, { type: 'group' }> {
  return { id, type: 'group', x: 0, y: 0, rotation: 0, index: 'a0', props: {} };
}

function frame(
  id: string,
  w: number,
  h: number,
): Extract<Shape, { type: 'frame' }> {
  return {
    id,
    type: 'frame',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: { w, h, name: 'Frame' },
  };
}

function modifiedPointer(x: number, y: number): ToolPointerInfo {
  return { ...pointer(x, y), altKey: true };
}

describe('eraser hierarchy and containment', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  });

  afterEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
  });

  it('takes a whole group when the swipe starts outside it', () => {
    // Two members 100 apart; the swipe only ever crosses the first.
    const { ctx, shapes } = context(
      group('g'),
      ink('a', 0, 0, { parentId: 'g' }),
      ink('b', 0, 100, { parentId: 'g' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(-40, 0), ctx);
    tool.onPointerMove?.(pointer(30, 0), ctx);
    tool.onPointerUp?.(pointer(30, 0), ctx);

    expect(shapes.has('a')).toBe(false);
    // The untouched sibling goes with it: a group erases as one thing.
    expect(shapes.has('b')).toBe(false);
    expect(shapes.has('g')).toBe(false);
  });

  it('erases only the member when the swipe starts inside the group', () => {
    const { ctx, shapes } = context(
      group('g'),
      ink('a', 0, 0, { parentId: 'g' }),
      ink('b', 0, 100, { parentId: 'g' }),
    );
    const tool = createEraserTool();

    // (5, 50) is inside the group's bounds but on neither member.
    tool.onPointerDown?.(pointer(5, 50), ctx);
    tool.onPointerMove?.(pointer(5, 0), ctx);
    tool.onPointerUp?.(pointer(5, 0), ctx);

    expect(shapes.has('a')).toBe(false);
    expect(shapes.has('b')).toBe(true);
  });

  it('leaves a framed shape alone where its frame clips it away', () => {
    // Parented to the frame but parked far outside it, so the frame's clip
    // makes it invisible on screen.
    const { ctx, shapes } = context(
      frame('f', 100, 100),
      ink('hidden', 200, 0, { parentId: 'f' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(195, 0), ctx);
    tool.onPointerMove?.(pointer(230, 0), ctx);
    tool.onPointerUp?.(pointer(230, 0), ctx);

    expect(shapes.has('hidden')).toBe(true);
  });

  it('still erases a framed shape inside its frame', () => {
    const { ctx, shapes } = context(
      frame('f', 100, 100),
      ink('shown', 10, 10, { parentId: 'f' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(5, 10), ctx);
    tool.onPointerMove?.(pointer(40, 10), ctx);
    tool.onPointerUp?.(pointer(40, 10), ctx);

    expect(shapes.has('shown')).toBe(false);
    expect(shapes.has('f')).toBe(true);
  });

  it('takes only the topmost shape while the accelerator is held', () => {
    const { ctx, shapes } = context(
      ink('under', 0, 0, { index: 'a1' }),
      ink('over', 0, 0, { index: 'a2' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(modifiedPointer(10, 0), ctx);
    tool.onPointerUp?.(modifiedPointer(10, 0), ctx);

    expect(shapes.has('over')).toBe(false);
    expect(shapes.has('under')).toBe(true);
  });

  it('takes both stacked shapes without the accelerator', () => {
    const { ctx, shapes } = context(
      ink('under', 0, 0, { index: 'a1' }),
      ink('over', 0, 0, { index: 'a2' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(10, 0), ctx);
    tool.onPointerUp?.(pointer(10, 0), ctx);

    expect(shapes.has('over')).toBe(false);
    expect(shapes.has('under')).toBe(false);
  });
});

describe('precision eraser inside a group', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('precision');
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  });

  afterEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
  });

  it('does not cut a stroke whose group is being erased whole', () => {
    // The rectangle cannot be cut, so it takes the group with it; the stroke the
    // same swipe crosses must not be sliced into fragments left behind by it.
    const harness = context(
      group('g'),
      { ...rectangle(), id: 'r', index: 'a1', parentId: 'g' },
      ink('line', 0, 60, { parentId: 'g' }),
    );
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(10, -40), harness.ctx);
    tool.onPointerMove?.(pointer(10, 80), harness.ctx);
    tool.onPointerUp?.(pointer(10, 80), harness.ctx);

    expect(harness.created).toHaveLength(0);
    expect(harness.updated).toHaveLength(0);
    expect(harness.shapes.has('r')).toBe(false);
    expect(harness.shapes.has('line')).toBe(false);
    expect(harness.shapes.has('g')).toBe(false);
  });
});

describe('eraser trail reaches collaborators', () => {
  let awareness: Awareness;
  let sent: string[];
  const lastScribbles = () => {
    const message = decodeEphemeral(sent.at(-1) ?? '');
    return message?.kind === 'scribbles' ? message.scribbles : undefined;
  };

  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
    awareness = new Awareness(new Y.Doc());
    sent = [];
    setActiveAwareness(awareness, {
      on: () => {},
      off: () => {},
      sendStateless: (payload) => sent.push(payload),
    });
  });

  afterEach(() => {
    setActiveAwareness(null);
    awareness.destroy();
    awareness.doc.destroy();
    spatialIndex.clear();
    useEraserStore.getState().clear();
  });

  it('publishes the gesture and pending target ids, and clears both after release', async () => {
    const { ctx } = context(rectangle());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(20, 15), ctx);
    tool.onPointerMove?.(pointer(24, 15), ctx);

    expect(lastScribbles()).toEqual([
      expect.objectContaining({ state: 'active', points: [20, 15, 0.5] }),
    ]);
    expect(awareness.getLocalState()?.erasing).toEqual(['target']);

    tool.onPointerUp?.(pointer(20, 15), ctx);
    // Peers keep the shape faded until release, then let go at once.
    expect(awareness.getLocalState()?.erasing).toBeNull();
    useEraserTrailStore.getState().tick(performance.now() + 1000, 1);

    // The clear rides the throttle's trailing flush.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastScribbles()).toEqual([]);
  });

  it('stops the trail and preserves the document when a miss is cancelled', () => {
    const { ctx, shapes } = context(rectangle());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(500, 500), ctx);
    tool.onPointerMove?.(pointer(504, 500), ctx);
    tool.onCancel?.(ctx);

    expect(useEraserTrailStore.getState().scribbles[0]?.state).toBe('stopping');
    expect(shapes.has('target')).toBe(true);
  });
});
