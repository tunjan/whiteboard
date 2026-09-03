import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pencil } from 'lucide-react';
import type { DrawPoint, DrawProps, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import type { EndTaperMode } from '../shapes/ink';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import {
  endLiveStroke,
  setLiveStrokeSink,
  useLiveStrokeStore,
  type LiveStrokeFrame,
} from '../use-live-stroke-store';
import { useStyleStore } from '../use-style-store';
import { createDrawTool } from './draw-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// The node test env has no rAF; the live-stroke flush is scheduled via it but
// finalize/cancel always write synchronously, so a no-op stub is enough.
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

/** Run scheduled frames inline, for the tests that assert on flushed state. */
function withSynchronousFrames(run: () => void): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    // The callback has already completed, so no frame remains pending. Returning
    // a numeric id here leaves the tool's `rafId` set after the inline callback
    // clears it and prevents a later move in the same test from flushing.
    return null;
  });
  try {
    run();
  } finally {
    vi.stubGlobal('requestAnimationFrame', () => 1);
  }
}

/**
 * The predicted tail of the last frame handed to the active-stroke layer.
 *
 * The tail never reaches the document — that is the point of it — so the only
 * place to observe it is where the layer would draw it from. Copied on arrival:
 * the tool hands over its own arrays and goes on mutating them.
 */
let publishedTail: DrawPoint[] | null = null;
let releaseSink: (() => void) | null = null;

beforeEach(() => {
  publishedTail = null;
  releaseSink = setLiveStrokeSink((frame: LiveStrokeFrame) => {
    publishedTail = frame.predicted.map((p) => ({ ...p }));
  });
});

afterEach(() => {
  releaseSink?.();
  releaseSink = null;
  endLiveStroke();
});

/** Id of the stroke the active-stroke layer currently owns. */
function liveStrokeId(): string | null {
  return useLiveStrokeStore.getState().shapeId;
}

function pointer(
  x: number,
  y: number,
  overrides: Partial<ToolPointerInfo> = {},
): ToolPointerInfo {
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
    ...overrides,
  };
}

/** A predicted sample, timestamped inside the tool's one-frame horizon. */
function prediction(
  x: number,
  y: number,
  t = 8,
): { x: number; y: number; pressure: number; t: number } {
  return { x, y, pressure: 0.5, t };
}

function context(): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map<string, Shape>();
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (shape) => shapes.set(shape.id, shape),
    updateShape: (id, patch) => {
      const current = shapes.get(id);
      if (!current) return;
      shapes.set(id, {
        ...current,
        ...patch,
        props: patch.props
          ? { ...current.props, ...patch.props }
          : current.props,
      } as Shape);
    },
    deleteShapes: (ids) => {
      for (const id of ids) shapes.delete(id);
    },
    transact: (fn) => fn(),
  };
  return {
    ctx: { editor, setTool: () => undefined, complete: () => undefined },
    shapes,
  };
}

function drawPoints(shape: Shape | undefined): DrawProps['points'] | undefined {
  return shape?.type === 'draw' ? shape.props.points : undefined;
}

describe('draw tool stroke lifecycle', () => {
  it('onCommit keeps every sample, even ones the chord could describe', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
    tool.onPointerMove?.(pointer(20, 0), ctx);
    tool.onCommit?.(ctx);

    expect(shapes.size).toBe(1);
    const points = drawPoints([...shapes.values()][0]);
    // The midpoint here is collinear and so contributes nothing geometrically,
    // but it is still kept: samples record when the hand was where, which is
    // what velocity-derived width is measured from, and the outline decimates
    // redundant points itself at render time anyway.
    expect(points?.length).toBe(3);
    expect(points?.[0]).toMatchObject({ x: 0, y: 0 });
    expect(points?.[1]).toMatchObject({ x: 10, y: 0 });
    expect(points?.[2]).toMatchObject({ x: 20, y: 0 });
  });

  it('onCommit preserves points that carry the curve', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 5), ctx);
    tool.onPointerMove?.(pointer(20, 0), ctx);
    tool.onCommit?.(ctx);

    const points = drawPoints([...shapes.values()][0]);
    expect(points?.length).toBe(3);
    expect(points?.[1]).toMatchObject({ x: 10, y: 5 });
  });

  it('subsamples pen jitter at one screen pixel for every zoom', () => {
    const walk = (zoom: number) => {
      const { ctx, shapes } = context();
      const tool = createDrawTool();
      tool.onPointerDown?.(pointer(0, 0, { zoom }), ctx);
      for (let i = 1; i <= 40; i++) {
        tool.onPointerMove?.(pointer(i * 0.4, 0, { zoom }), ctx);
      }
      tool.onCommit?.(ctx);
      return drawPoints([...shapes.values()][0]);
    };

    // At 4x, 0.4 world units exceeds one screen pixel (0.25 world units), so
    // every digitizer report survives. At 1x, the same reports are merged until
    // they clear one world unit. Far out, the entire 16-unit trace is smaller
    // than one screen pixel and remains one pressure-merged point.
    expect(walk(4)).toHaveLength(41);
    expect(walk(1)).toHaveLength(14);
    expect(walk(0.05)).toHaveLength(1);
  });

  it('onCancel discards the in-progress stroke', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
    tool.onCancel?.(ctx);

    expect(shapes.size).toBe(0);
  });

  it('onCancel discards every chunk the gesture committed', () => {
    // `id` only ever names the chunk being drawn. A gesture past the point cap
    // has already committed the ones before it, and they were left behind.
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    for (let i = 1; i <= 650; i++) tool.onPointerMove?.(pointer(i * 2, 0), ctx);
    expect(shapes.size).toBe(2);
    tool.onCancel?.(ctx);

    expect(shapes.size).toBe(0);
  });

  it('applies the stylus pressure gain exactly once at ingestion', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(
      pointer(0, 0, { pointerType: 'pen', pressure: 0.6 }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(10, 0, { pointerType: 'pen', pressure: 0.9 }),
      ctx,
    );
    tool.onPointerUp?.(
      pointer(10, 0, { pointerType: 'pen', pressure: 0.5 }),
      ctx,
    );

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.simulatePressure).toBe(false);
    expect(shape.props.pressureEasing).toBe('stylus');
    expect(shape.props.pressureWarmup).toBe(true);
    expect(shape.props.points[0]?.pressure).toBe(0.75);
    expect(shape.props.points[1]?.pressure).toBe(1);
  });

  it('merges sub-pixel pen reports using their maximum pressure', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(
      pointer(0, 0, { pointerType: 'pen', pressure: 0.2 }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(0.2, 0, { pointerType: 'pen', pressure: 0.8 }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(0.6, 0, { pointerType: 'pen', pressure: 0.4 }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(1.2, 0, { pointerType: 'pen', pressure: 0.3 }),
      ctx,
    );
    tool.onCommit?.(ctx);

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.points).toHaveLength(2);
    expect(shape.props.points[0]?.pressure).toBe(1);
    expect(shape.props.points[1]?.pressure).toBeCloseTo(0.375, 12);
  });

  it('does not replace the last stylus pressure reading on lift', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(
      pointer(0, 0, { pointerType: 'pen', pressure: 0.4 }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(10, 0, { pointerType: 'pen', pressure: 0.2 }),
      ctx,
    );
    // Pointer-up has no contact pressure. Canvas normalizes that zero reading
    // to its neutral fallback; it must not make the settled tip jump to 0.625.
    tool.onPointerUp?.(
      pointer(10, 0, { pointerType: 'pen', pressure: 0.5 }),
      ctx,
    );

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.points.at(-1)?.pressure).toBe(0.25);
  });

  it('stores neutral mouse pressure when simulation is off', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(
      pointer(0, 0, { pointerType: 'mouse', pressure: 0 }),
      ctx,
    );
    tool.onPointerUp?.(
      pointer(20, 0, { pointerType: 'mouse', pressure: 0, timestamp: 20 }),
      ctx,
    );

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.points.map((point) => point.pressure)).toEqual([
      0.5, 0.5,
    ]);
  });
});

describe('auto-closure', () => {
  /** Walk a path and lift, returning the one shape it produced. */
  function trace(
    path: [number, number][],
    overrides: Partial<ToolPointerInfo> = {},
  ): Shape | undefined {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    const [first, ...rest] = path;
    tool.onPointerDown?.(pointer(first![0], first![1], overrides), ctx);
    for (const [x, y] of rest)
      tool.onPointerMove?.(pointer(x, y, overrides), ctx);
    tool.onPointerUp?.(
      pointer(path[path.length - 1]![0], path[path.length - 1]![1], overrides),
      ctx,
    );
    return [...shapes.values()][0];
  }

  const closed = (shape: Shape | undefined) =>
    shape?.type === 'draw' ? shape.props.isClosed : undefined;

  it('closes a loop that ends exactly on the press point', () => {
    // Landing on the start is the clearest statement of intent there is, and
    // it was the one case refused: an exact coordinate match returned early
    // before the distance test could accept it.
    expect(
      closed(
        trace([
          [0, 0],
          [40, 0],
          [40, 40],
          [0, 40],
          [0, 0],
        ]),
      ),
    ).toBe(true);
  });

  it('closes a loop that ends back near where it began', () => {
    // A 40-unit box lifted 5 units from the press — inside the ~10-unit
    // tolerance a size-4 brush gets at 1:1.
    expect(
      closed(
        trace([
          [0, 0],
          [40, 0],
          [40, 40],
          [0, 40],
          [0, 5],
        ]),
      ),
    ).toBe(true);
  });

  it('leaves a stroke that ends elsewhere open', () => {
    expect(
      closed(
        trace([
          [0, 0],
          [40, 0],
          [40, 40],
        ]),
      ),
    ).toBe(false);
  });

  it('will not close a stroke shorter than a few brush widths', () => {
    // Ends 0.7 units from the press, well inside the tolerance, but the whole
    // path is only ~9 units long: over that distance the two ends were never
    // far enough apart for meeting again to say anything about intent.
    expect(
      closed(
        trace([
          [0, 0],
          [2, 0],
          [1, 2],
          [0.3, 0.3],
        ]),
      ),
    ).toBe(false);
  });

  it('widens the tolerance as the camera zooms out', () => {
    // The same 40-unit gap: a hand's-breadth on screen when zoomed far out,
    // and four brush widths of daylight at 1:1.
    const path: [number, number][] = [
      [0, 0],
      [120, 0],
      [120, 120],
      [0, 120],
      [0, 40],
    ];
    expect(closed(trace(path, { zoom: 1 }))).toBe(false);
    expect(closed(trace(path, { zoom: 0.05 }))).toBe(true);
  });

  it('judges closure at the zoom the stroke began at', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0, { zoom: 0.05 }), ctx);
    for (const [x, y] of [
      [120, 0],
      [120, 120],
      [0, 120],
      [0, 40],
    ]) {
      // Zooming in mid-stroke must not retroactively pull the ends apart.
      tool.onPointerMove?.(pointer(x!, y!, { zoom: 4 }), ctx);
    }
    tool.onPointerUp?.(pointer(0, 40, { zoom: 4 }), ctx);

    expect(closed([...shapes.values()][0])).toBe(true);
  });
});

describe('long-stroke chunking', () => {
  it('continues past the point cap in a new, connected shape', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0), ctx);
    for (let i = 1; i <= 700; i++) tool.onPointerMove?.(pointer(i * 2, 0), ctx);
    tool.onCommit?.(ctx);

    const [first, second] = [...shapes.values()];
    expect(shapes.size).toBe(2);
    expect(drawPoints(first)).toHaveLength(600);
    // Every sample is kept — the gesture is split across two shapes, not
    // thinned. 701 samples in, 600 + 102 out, sharing the seam point.
    expect(drawPoints(second)).toHaveLength(102);

    // The child starts exactly where the parent ended, so both round caps land
    // on the same world point and the seam is invisible.
    const tail = drawPoints(first)?.[599];
    expect(second?.x).toBe((first?.x ?? 0) + (tail?.x ?? 0));
    expect(second?.y).toBe((first?.y ?? 0) + (tail?.y ?? 0));
    expect(drawPoints(second)?.[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('never closes a chunk, however near its ends land', () => {
    // A circle sampled so that its 600th point — where the cap falls — lands
    // one unit from the press. The chunk therefore looks exactly like a closed
    // loop, but the hand never lifted there: the cut is an artefact of the cap,
    // and filling the region it appears to enclose would be filling nothing
    // anybody drew.
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(100, 0), ctx);
    for (let i = 1; i <= 800; i++) {
      const theta = (i / 600) * Math.PI * 2;
      tool.onPointerMove?.(
        pointer(100 * Math.cos(theta), 100 * Math.sin(theta)),
        ctx,
      );
    }
    tool.onCommit?.(ctx);

    const [first] = [...shapes.values()];
    expect(shapes.size).toBe(2);
    expect(drawPoints(first)).toHaveLength(600);
    // Within the ~10-unit tolerance a size-4 brush gets at 1:1.
    const tail = drawPoints(first)?.[599];
    expect(Math.hypot(tail?.x ?? 0, tail?.y ?? 0)).toBeLessThan(2);
    for (const shape of shapes.values()) {
      expect(shape.type === 'draw' && shape.props.isClosed).toBe(false);
    }
  });

  it('carries the same brush into the continuation', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0), ctx);
    for (let i = 1; i <= 650; i++) tool.onPointerMove?.(pointer(i * 2, 0), ctx);
    tool.onCommit?.(ctx);

    const [first, second] = [...shapes.values()];
    if (first?.type !== 'draw' || second?.type !== 'draw')
      throw new Error('n/a');
    expect(second.props.color).toBe(first.props.color);
    expect(second.props.size).toBe(first.props.size);
    expect(second.props.streamline).toBe(first.props.streamline);
    expect(second.props.thinning).toBe(first.props.thinning);
  });

  it('does not taper at the seam', () => {
    // Tapers describe where the hand pressed and where it lifted. The cap falls
    // in the middle of an unbroken gesture, so applying them there pinches the
    // line to nothing at a place nobody stopped.
    const ui = useCanvasUiStore.getState();
    const before = { start: ui.pencilStartTaper, end: ui.pencilEndTaper };
    ui.setPencilStartTaper(20);
    ui.setPencilEndTaper('full');
    try {
      const { ctx, shapes } = context();
      const tool = createDrawTool();
      tool.onPointerDown?.(pointer(0, 0), ctx);
      for (let i = 1; i <= 650; i++)
        tool.onPointerMove?.(pointer(i * 2, 0), ctx);
      tool.onCommit?.(ctx);

      const [first, second] = [...shapes.values()];
      if (first?.type !== 'draw' || second?.type !== 'draw')
        throw new Error('n/a');
      // The cut end keeps its round cap; the continuation opens at full width.
      expect(first.props.endTaper).toBe(false);
      expect(second.props.startTaper).toBe(0);
      // The two ends the hand really made still taper as asked.
      expect(first.props.startTaper).toBe(20);
      expect(second.props.endTaper).toBe(true);
    } finally {
      ui.setPencilStartTaper(before.start);
      ui.setPencilEndTaper(before.end);
    }
  });
});

describe('velocity-derived pressure', () => {
  function withSimulation<T>(run: () => T): T {
    const previous = useCanvasUiStore.getState().pencilSimulatePressure;
    useCanvasUiStore.getState().setPencilSimulatePressure(true);
    try {
      return run();
    } finally {
      useCanvasUiStore.getState().setPencilSimulatePressure(previous);
    }
  }

  /** Drag `distance` px in a straight line over `duration` ms, in `steps` samples. */
  function drag(distance: number, duration: number, steps: number) {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(
      pointer(0, 0, { pointerType: 'mouse', pressure: 0, timestamp: 0 }),
      ctx,
    );
    for (let i = 1; i <= steps; i++) {
      tool.onPointerMove?.(
        pointer((distance * i) / steps, 0, {
          pointerType: 'mouse',
          pressure: 0,
          timestamp: (duration * i) / steps,
        }),
        ctx,
      );
    }
    tool.onCommit?.(ctx);
    return [...shapes.values()][0];
  }

  it('resolves pressure at capture, leaving the engine nothing to simulate', () => {
    const shape = withSimulation(() => drag(60, 60, 6));

    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    // Points now carry a filtered real signal, so re-deriving one from sample
    // spacing would be second-guessing it.
    expect(shape.props.simulatePressure).toBe(false);
    expect(shape.props.pressureEasing).toBe('ease-out-sine');
    expect(shape.props.pressureWarmup).toBe(true);
    const expectedFinalSpeed = 1 - 0.5 ** (60 / 16);
    expect(shape.props.points.at(-1)?.pressure).toBeCloseTo(
      1 - expectedFinalSpeed / 1.5,
      5,
    );
  });

  it('opens the stroke at the speed the hand was moving, not at neutral', () => {
    // Pointer-down has nothing to measure against, so the opening sample used
    // to keep the neutral default and the engine then spent several world units
    // easing away from it: every velocity-drawn stroke began at mid weight
    // however it was actually drawn. The first real reading is the one that
    // describes that opening.
    const shape = withSimulation(() => drag(60, 60, 6));

    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    const firstFilteredSpeed = 1 - 0.5 ** (10 / 16);
    expect(shape.props.points[0]?.pressure).toBeCloseTo(
      1 - firstFilteredSpeed / 1.5,
      5,
    );
  });

  it('leaves a stylus stroke to open on its own hardware reading', () => {
    // Only mouse and touch derive pressure from velocity; a pen already has a
    // real reading at pointer-down and must keep it.
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0, { pressure: 0.4 }), ctx);
    tool.onPointerMove?.(pointer(30, 0, { pressure: 0.8, timestamp: 10 }), ctx);
    tool.onCommit?.(ctx);

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    // 0.4 * the 1.25 stylus gain.
    expect(shape.props.points[0]?.pressure).toBeCloseTo(0.5, 5);
  });

  it('reads the same gesture identically at any hardware report rate', () => {
    // The previous per-sample heuristic measured travel between reports, so
    // this same 1 px/ms drag came out thinner the slower the device reported.
    const fast = withSimulation(() => drag(60, 60, 12));
    const slow = withSimulation(() => drag(60, 60, 3));

    const pressures = (shape: Shape | undefined) =>
      shape?.type === 'draw'
        ? shape.props.points.slice(1).map((p) => p.pressure)
        : [];
    const fastPressures = pressures(fast);
    const slowPressures = pressures(slow);

    expect(fastPressures.length).toBeGreaterThan(slowPressures.length);
    // Intermediate reports naturally sample different instants, but the exact
    // time-normalized EMA reaches the same value after the same 60 ms gesture.
    expect(fastPressures.at(-1)).toBeCloseTo(slowPressures.at(-1)!, 10);
  });

  it('thins toward nothing as the pointer outruns the width floor', () => {
    const slow = withSimulation(() => drag(60, 120, 6));
    const quick = withSimulation(() => drag(60, 30, 6));

    const last = (shape: Shape | undefined) =>
      shape?.type === 'draw'
        ? shape.props.points[shape.props.points.length - 1]?.pressure
        : undefined;

    const filteredSlowSpeed = 0.5 * (1 - 0.5 ** (120 / 16));
    const filteredQuickSpeed = 2 * (1 - 0.5 ** (30 / 16));
    expect(last(slow)).toBeCloseTo(1 - filteredSlowSpeed / 1.5, 5);
    expect(last(quick)).toBeCloseTo(
      Math.max(0, 1 - filteredQuickSpeed / 1.5),
      5,
    );
  });
});

describe('predicted pointer tail', () => {
  // The tail is opt-in and off by default, so every case below that expects one
  // has to ask for it. The gate itself is covered by its own test.
  beforeEach(() => {
    useCanvasUiStore.getState().setPencilPrediction(true);
  });
  afterEach(() => {
    useCanvasUiStore.getState().setPencilPrediction(false);
  });

  it('draws no tail at all while the preference is off', () => {
    useCanvasUiStore.getState().setPencilPrediction(false);
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, { predicted: [prediction(25, 8)] }),
        ctx,
      );
    });

    expect(publishedTail).toEqual([]);
  });

  it('does not extrapolate when stroke stabilisation is disabled', () => {
    const previous = useCanvasUiStore.getState().pencilStabilization;
    useCanvasUiStore.getState().setPencilStabilization(0);
    try {
      const { ctx } = context();
      const tool = createDrawTool();

      withSynchronousFrames(() => {
        tool.onPointerDown?.(pointer(0, 0), ctx);
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(25, 8)] }),
          ctx,
        );
      });

      // Prediction is a form of input correction. Raw mode follows only real
      // hardware samples, irrespective of the outline-smoothing preference.
      expect(publishedTail).toEqual([]);
    } finally {
      useCanvasUiStore.getState().setPencilStabilization(previous);
    }
  });

  it('keeps predicted samples out of the document', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(
      pointer(10, 0, {
        predicted: [prediction(16, 0), prediction(22, 0, 12)],
      }),
      ctx,
    );
    tool.onPointerUp?.(pointer(10, 0), ctx);

    // Prediction is the browser guessing ahead. Persisting it would ship a
    // guess to every peer and bake it into the saved stroke.
    const points = drawPoints([...shapes.values()][0]);
    expect(points?.map((p) => p.x)).toEqual([0, 10]);
  });

  it('publishes the tail for local rendering, in shape-local coordinates', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      // Origin is the pointer-down point, so the tail is stored relative to it.
      tool.onPointerDown?.(pointer(100, 100), ctx);
      tool.onPointerMove?.(
        pointer(110, 100, {
          predicted: [prediction(130, 100)],
        }),
        ctx,
      );
    });

    expect(liveStrokeId()).not.toBeNull();
    // Pressure goes through the same stylus conditioning as a real sample
    // (0.5 × 1.25), so the tail cannot change width at the junction.
    expect(publishedTail).toEqual([{ x: 30, y: 0, pressure: 0.625 }]);
  });

  it('clears the tail when the stroke ends', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, { predicted: [prediction(20, 0)] }),
        ctx,
      );
    });
    expect(publishedTail).toHaveLength(1);

    tool.onPointerUp?.(pointer(10, 0), ctx);
    expect(liveStrokeId()).toBeNull();
  });

  it('clears the tail when the stroke is cancelled', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, { predicted: [prediction(20, 0)] }),
        ctx,
      );
    });

    tool.onCancel?.(ctx);
    expect(liveStrokeId()).toBeNull();
  });

  it('reaches no further ahead than one frame', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, {
          timestamp: 100,
          predicted: [
            prediction(20, 0, 108),
            prediction(30, 0, 116),
            // Past the horizon: extrapolation this far out is guesswork, and
            // the tip would visibly snap back once real samples landed.
            prediction(40, 0, 124),
          ],
        }),
        ctx,
      );
    });

    expect(publishedTail?.map((p) => p.x)).toEqual([20, 30]);
  });

  it('stops the tail where the prediction doubles back', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, {
          predicted: [
            prediction(16, 0),
            // The browser overshooting a direction change. Following it hooks
            // the tip back over ink that is already drawn.
            prediction(4, 0, 12),
          ],
        }),
        ctx,
      );
    });

    expect(publishedTail?.map((p) => p.x)).toEqual([16]);
  });

  it('takes the tail back down once the hand stops moving', () => {
    vi.useFakeTimers();
    try {
      const { ctx, shapes } = context();
      const tool = createDrawTool();

      withSynchronousFrames(() => {
        tool.onPointerDown?.(pointer(0, 0), ctx);
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(20, 0)] }),
          ctx,
        );
      });
      expect(publishedTail).toHaveLength(1);

      // The hand has stopped, and a pointer that isn't moving emits no
      // `pointermove` — so nothing arrives to re-derive the tail. Left alone it
      // stayed painted 10 units past where the hand actually stopped, for as
      // long as the button was held, and then snapped back on release.
      vi.advanceTimersByTime(200);
      expect(publishedTail).toEqual([]);
      // Local-only: expiring the tail must not touch the document.
      expect(drawPoints([...shapes.values()][0])?.map((p) => p.x)).toEqual([
        0, 10,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pushes the deadline back while moves keep arriving', () => {
    vi.useFakeTimers();
    try {
      const { ctx } = context();
      const tool = createDrawTool();

      withSynchronousFrames(() => {
        tool.onPointerDown?.(pointer(0, 0), ctx);
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(20, 0)] }),
          ctx,
        );
        expect(publishedTail).toHaveLength(1);
        // Still drawing, one 60 Hz frame later. That move has to reset the
        // deadline: the total elapsed here passes the one the first move armed,
        // so a deadline that ignored it would blank the tip mid-stroke, once a
        // frame, for the whole stroke.
        vi.advanceTimersByTime(17);
        tool.onPointerMove?.(
          pointer(20, 0, { predicted: [prediction(30, 0)] }),
          ctx,
        );
        vi.advanceTimersByTime(17);
      });

      expect(publishedTail).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not keep a stale tail alive on stationary pointer events', () => {
    vi.useFakeTimers();
    try {
      const { ctx } = context();
      const tool = createDrawTool();

      withSynchronousFrames(() => {
        tool.onPointerDown?.(pointer(0, 0), ctx);
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(20, 0)] }),
          ctx,
        );
        expect(publishedTail).toHaveLength(1);

        vi.advanceTimersByTime(17);
        // Some browsers keep dispatching the same move and prediction after
        // the hand has stopped. That is not fresh motion and must not extend
        // the lifetime of an already-stale extrapolation.
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(20, 0)] }),
          ctx,
        );
        vi.advanceTimersByTime(17);
      });

      expect(publishedTail).toEqual([]);

      withSynchronousFrames(() => {
        // Nor may the next repeated event immediately resurrect the same bad
        // extrapolation after the deadline has taken it down.
        tool.onPointerMove?.(
          pointer(10, 0, { predicted: [prediction(20, 0)] }),
          ctx,
        );
      });
      expect(publishedTail).toEqual([]);

      withSynchronousFrames(() => {
        // Real motion lifts the suppression immediately; prediction is still
        // available while the stroke is genuinely advancing.
        tool.onPointerMove?.(
          pointer(20, 0, { predicted: [prediction(30, 0)] }),
          ctx,
        );
      });
      expect(publishedTail?.map((point) => point.x)).toEqual([30]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops prediction once shift-snapping is active', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      // Arms the switch; the mode changes on the move that follows it.
      tool.onPointerMove?.(pointer(10, 0, { shiftKey: true }), ctx);
      tool.onPointerMove?.(
        pointer(20, 0, {
          shiftKey: true,
          predicted: [prediction(30, 5)],
        }),
        ctx,
      );
    });

    // A straight segment ends where the pointer is; a predicted tail would bend
    // it off the snapped angle.
    expect(publishedTail).toEqual([]);
  });
});

describe('straight-segment mode', () => {
  it('leaves the stroke alone until the hand follows the modifier', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(10, 0), ctx);
      tool.onPointerMove?.(pointer(20, 4), ctx);
      // Shift goes down and the hand barely moves: a tap, not a gesture.
      tool.onPointerMove?.(pointer(21, 4, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(22, 4, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(22, 4, { shiftKey: true }), ctx);
    });

    const points = drawPoints([...shapes.values()][0])!;
    // Every freehand sample survives; nothing was replaced by a segment.
    expect(points.map((point) => point.x)).toEqual([0, 10, 20, 21, 22]);
  });

  it('replaces only what follows the anchor once the mode takes', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(10, 0), ctx);
      // Arms at (10, 0), commits on the next move past the travel threshold.
      tool.onPointerMove?.(pointer(20, 0, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(60, 3, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(90, 4, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(90, 4, { shiftKey: true }), ctx);
    });

    const points = drawPoints([...shapes.values()][0])!;
    // The freehand run up to the anchor is kept, and the segment that follows
    // it is a single point snapped to the nearest 15 degrees — here, flat.
    expect(points).toHaveLength(4);
    expect(points.slice(0, 3).map((point) => point.x)).toEqual([0, 10, 20]);
    expect(points[3]!.y).toBeCloseTo(0, 9);
  });

  it('resumes freehand after the segment when shift is released', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(10, 0, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(50, 0, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(80, 0, { shiftKey: true }), ctx);
      // Released, then travelled: back to freehand. The first move after the
      // release is still inside the threshold, so it moves the segment's
      // endpoint; freehand then continues from there.
      tool.onPointerMove?.(pointer(85, 10), ctx);
      tool.onPointerMove?.(pointer(90, 20), ctx);
      tool.onPointerMove?.(pointer(95, 30), ctx);
      tool.onPointerUp?.(pointer(95, 30), ctx);
    });

    const points = drawPoints([...shapes.values()][0])!;
    expect(points.map((point) => point.y)).toEqual([0, 0, 10, 20, 30]);
  });
});

describe('segment extension', () => {
  it("shift-clicking a stroke's free end appends to that same shape", () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(30, 0), ctx);
      tool.onPointerUp?.(pointer(30, 0), ctx);
    });
    const [existing] = [...shapes.values()];
    expect(shapes.size).toBe(1);

    withSynchronousFrames(() => {
      // Lands within the grab radius of the endpoint at world (30, 0).
      tool.onPointerDown?.(pointer(32, 1, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(60, 2, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(60, 2, { shiftKey: true }), ctx);
    });

    // No second shape, and the appended segment extends past the old end.
    expect(shapes.size).toBe(1);
    expect([...shapes.values()][0]!.id).toBe(existing!.id);
    const points = drawPoints([...shapes.values()][0])!;
    expect(points.length).toBeGreaterThan(2);
    // Snapped flat off the old endpoint, keeping the length of the drag.
    expect(points.at(-1)!.y).toBeCloseTo(0, 9);
    expect(points.at(-1)!.x).toBeGreaterThan(30);
  });

  it('does not adopt a stroke whose end is out of reach', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(30, 0), ctx);
      tool.onPointerUp?.(pointer(30, 0), ctx);
    });

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(300, 300, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(340, 300, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(340, 300, { shiftKey: true }), ctx);
    });

    expect(shapes.size).toBe(2);
  });

  it("leaves the adopted stroke's opening pressure alone", () => {
    const previous = useCanvasUiStore.getState().pencilSimulatePressure;
    useCanvasUiStore.getState().setPencilSimulatePressure(true);
    try {
      const { ctx, shapes } = context();
      const tool = createDrawTool();
      const mouse = { pointerType: 'mouse', pressure: 0 };

      withSynchronousFrames(() => {
        tool.onPointerDown?.(pointer(0, 0, { ...mouse, timestamp: 0 }), ctx);
        tool.onPointerMove?.(pointer(30, 0, { ...mouse, timestamp: 16 }), ctx);
        tool.onPointerUp?.(pointer(30, 0, { ...mouse, timestamp: 16 }), ctx);
      });
      const opening = drawPoints([...shapes.values()][0])![0]!.pressure;

      withSynchronousFrames(() => {
        tool.onPointerDown?.(
          pointer(30, 0, { ...mouse, timestamp: 100, shiftKey: true }),
          ctx,
        );
        tool.onPointerMove?.(
          pointer(90, 0, { ...mouse, timestamp: 116, shiftKey: true }),
          ctx,
        );
        tool.onPointerUp?.(
          pointer(90, 0, { ...mouse, timestamp: 116, shiftKey: true }),
          ctx,
        );
      });

      // The first-sample seeding belongs to the stroke that opened the gesture.
      // An extension has no opening sample, and must not reach back to one.
      expect(drawPoints([...shapes.values()][0])![0]!.pressure).toBe(opening);
    } finally {
      useCanvasUiStore.getState().setPencilSimulatePressure(previous);
    }
  });

  it('restores the adopted stroke when the gesture is cancelled', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(pointer(30, 0), ctx);
      tool.onPointerUp?.(pointer(30, 0), ctx);
    });
    const before = drawPoints([...shapes.values()][0])!;

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(30, 0, { shiftKey: true }), ctx);
      tool.onPointerMove?.(pointer(90, 0, { shiftKey: true }), ctx);
    });
    tool.onCancel?.(ctx);

    // A cancel discards the stroke it was making, not the one it joined.
    expect(shapes.size).toBe(1);
    expect(drawPoints([...shapes.values()][0])!).toEqual(before);
  });
});

describe('highlighter (marker ink)', () => {
  const MARKER = {
    id: 'highlighter',
    label: 'Highlighter',
    hotkey: 'i',
    icon: Pencil,
    ink: 'marker',
  } as const;

  function marker() {
    return createDrawTool(MARKER);
  }

  function frame(id: string, index: string): Shape {
    return {
      id,
      type: 'frame',
      x: 0,
      y: 0,
      rotation: 0,
      index,
      parentId: null,
      props: { w: 100, h: 100, name: 'Slide' },
    } as Shape;
  }

  function stroke(id: string, index: string): Shape {
    return {
      id,
      type: 'draw',
      x: 0,
      y: 0,
      rotation: 0,
      index,
      parentId: null,
      props: { points: [{ x: 0, y: 0, pressure: 0.5 }], isClosed: false },
    } as unknown as Shape;
  }

  /** The single shape the gesture created, ignoring anything seeded first. */
  function only(shapes: Map<string, Shape>, ...seeded: string[]): Shape {
    const created = [...shapes.values()].filter(
      (s) => !seeded.includes(s.id),
    );
    expect(created).toHaveLength(1);
    return created[0]!;
  }

  it('lays a flat band: constant width, no taper, no dash, no fill', () => {
    const { ctx, shapes } = context();
    const tool = marker();
    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(40, 0), ctx);
    tool.onPointerUp?.(pointer(40, 0), ctx);

    const shape = only(shapes);
    expect(shape.type).toBe('draw');
    if (shape.type !== 'draw') return;
    expect(shape.props.thinning).toBe(0);
    expect(shape.props.startTaper).toBe(0);
    expect(shape.props.endTaper).toBe(false);
    expect(shape.props.dash).toBe('solid');
    expect(shape.props.fillStyle).toBe('none');
    expect(shape.props.simulatePressure).toBe(false);
  });

  it('is wider than the pen at the same size, and translucent', () => {
    useStyleStore.getState().setSize('pen', 2);
    useStyleStore.getState().setSize('marker', 2);
    useStyleStore.getState().setOpacity('pen', 1);
    const pen = context();
    createDrawTool().onPointerDown?.(pointer(0, 0), pen.ctx);
    createDrawTool().onPointerUp?.(pointer(0, 0), pen.ctx);
    const penShape = only(pen.shapes);

    const wash = context();
    const tool = marker();
    tool.onPointerDown?.(pointer(0, 0), wash.ctx);
    tool.onPointerUp?.(pointer(0, 0), wash.ctx);
    const markerShape = only(wash.shapes);

    if (penShape.type !== 'draw' || markerShape.type !== 'draw') return;
    expect(markerShape.props.size).toBeGreaterThan(penShape.props.size);
    expect(markerShape.opacity).toBeLessThan(1);
    expect(penShape.opacity).toBe(1);
  });

  // The two instruments remember their own colour. Sharing one slot meant
  // reaching for the highlighter after writing in black laid a black wash.
  it('inks from the marker slot, leaving the pen on its own colour', () => {
    useStyleStore.getState().setColor('pen', '#1d1d1d');
    useStyleStore.getState().setColor('marker', '#f1ac4b');

    const wash = context();
    marker().onPointerDown?.(pointer(0, 0), wash.ctx);
    const washShape = only(wash.shapes);

    const pen = context();
    createDrawTool().onPointerDown?.(pointer(0, 0), pen.ctx);
    const penShape = only(pen.shapes);

    if (washShape.type !== 'draw' || penShape.type !== 'draw') return;
    expect(washShape.props.color).toBe('#f1ac4b');
    expect(penShape.props.color).toBe('#1d1d1d');
  });

  it('lands under the drawing, where the pen lands on top of it', () => {
    const { ctx, shapes } = context();
    shapes.set('ink', stroke('ink', 'a1'));

    marker().onPointerDown?.(pointer(0, 0), ctx);
    const wash = only(shapes, 'ink');
    expect(wash.index < 'a1').toBe(true);

    shapes.delete(wash.id);
    createDrawTool().onPointerDown?.(pointer(0, 0), ctx);
    expect(only(shapes, 'ink').index > 'a1').toBe(true);
  });

  it('stays above a frame it is drawn on, which would paint over it', () => {
    const { ctx, shapes } = context();
    shapes.set('slide', frame('slide', 'a1'));
    shapes.set('ink', stroke('ink', 'a3'));

    marker().onPointerDown?.(pointer(50, 50), ctx);
    const wash = only(shapes, 'slide', 'ink');
    // Above the frame's background, still below the ink it is highlighting.
    expect(wash.index > 'a1').toBe(true);
    expect(wash.index < 'a3').toBe(true);
  });

  it('goes all the way to the back when no frame is under it', () => {
    const { ctx, shapes } = context();
    // The frame is elsewhere on the board, so it cannot hide this stroke.
    shapes.set('slide', frame('slide', 'a1'));
    shapes.set('ink', stroke('ink', 'a3'));

    marker().onPointerDown?.(pointer(500, 500), ctx);
    expect(only(shapes, 'slide', 'ink').index < 'a1').toBe(true);
  });

  it('takes Shift as straight-line mode rather than extending pen ink', () => {
    const { ctx, shapes } = context();
    shapes.set('ink', stroke('ink', 'a1'));

    // Pressing right on the existing stroke's free end, which is what the pen
    // reads as "continue this stroke".
    marker().onPointerDown?.(pointer(0, 0, { shiftKey: true }), ctx);
    expect(shapes.size).toBe(2);
    expect(drawPoints(shapes.get('ink'))).toHaveLength(1);
  });
});

describe('velocity-driven lift taper', () => {
  /** Draw one straight stroke, `step` world units and `ms` apart per sample. */
  function drawAndLift(step: number, ms: number): Shape | undefined {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0, { timestamp: 0 }), ctx);
    for (let i = 1; i <= 30; i++) {
      tool.onPointerMove?.(pointer(i * step, 0, { timestamp: i * ms }), ctx);
    }
    tool.onPointerUp?.(pointer(30 * step, 0, { timestamp: 30 * ms }), ctx);
    return [...shapes.values()][0];
  }

  function withEndTaper(mode: EndTaperMode, run: () => void): void {
    const ui = useCanvasUiStore.getState();
    const before = ui.pencilEndTaper;
    ui.setPencilEndTaper(mode);
    try {
      run();
    } finally {
      ui.setPencilEndTaper(before);
    }
  }

  it('tapers a stroke lifted at speed and not one lifted at rest', () => {
    withEndTaper('velocity', () => {
      // Same path, same length, same brush — the only thing separating these
      // two is how fast the hand was going when it left the page, which is the
      // whole claim the mode makes.
      const flicked = drawAndLift(30, 8);
      const settled = drawAndLift(30, 400);
      if (flicked?.type !== 'draw' || settled?.type !== 'draw')
        throw new Error('n/a');

      expect(flicked.props.endTaper).toBeGreaterThan(0);
      expect(settled.props.endTaper).toBe(0);
    });
  });

  it('leaves the other two modes alone', () => {
    withEndTaper('off', () => {
      const shape = drawAndLift(30, 8);
      if (shape?.type !== 'draw') throw new Error('n/a');
      expect(shape.props.endTaper).toBe(false);
    });
    withEndTaper('full', () => {
      const shape = drawAndLift(30, 400);
      if (shape?.type !== 'draw') throw new Error('n/a');
      expect(shape.props.endTaper).toBe(true);
    });
  });
});

describe('stylus tilt capture', () => {
  function drawWith(overrides: Partial<ToolPointerInfo>): Shape | undefined {
    const { ctx, shapes } = context();
    const tool = createDrawTool();
    tool.onPointerDown?.(pointer(0, 0, overrides), ctx);
    for (let i = 1; i <= 10; i++) {
      tool.onPointerMove?.(
        pointer(i * 4, 0, { ...overrides, timestamp: i * 8 }),
        ctx,
      );
    }
    tool.onPointerUp?.(pointer(40, 0, { ...overrides, timestamp: 88 }), ctx);
    return [...shapes.values()][0];
  }

  it('records the lean of a pen and nothing for a mouse', () => {
    const pen = drawWith({ pointerType: 'pen', tiltX: 0.4, tiltY: -0.6 });
    if (pen?.type !== 'draw') throw new Error('n/a');
    const sample = pen.props.points[pen.props.points.length - 1]!;
    expect(sample.tiltX).toBeCloseTo(0.4, 5);
    expect(sample.tiltY).toBeCloseTo(-0.6, 5);

    // A mouse reports a tilt of nothing; storing it as a measured zero would
    // widen every mouse stroke to five channels to say so.
    const mouse = drawWith({ pointerType: 'mouse', pressure: 0.5 });
    if (mouse?.type !== 'draw') throw new Error('n/a');
    expect(mouse.props.points[0]).not.toHaveProperty('tiltX');
  });
});
