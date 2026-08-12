import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DrawProps, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useStrokePredictionStore } from '../use-stroke-prediction-store';
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
    return 1;
  });
  try {
    run();
  } finally {
    vi.stubGlobal('requestAnimationFrame', () => 1);
  }
}

afterEach(() => {
  useStrokePredictionStore.getState().clearPrediction();
});

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
        props: patch.props ? { ...current.props, ...patch.props } : current.props,
      } as Shape);
    },
    deleteShapes: (ids) => {
      for (const id of ids) shapes.delete(id);
    },
    transact: (fn) => fn(),
  };
  return { ctx: { editor, setTool: () => undefined, complete: () => undefined }, shapes };
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

  it('samples a gesture identically at every zoom', () => {
    // Point density decides how much `streamline` smooths the stroke, so the
    // sampling gate must not depend on the camera — otherwise the same world
    // gesture renders differently depending on the zoom it was drawn at.
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

    const atZoom1 = walk(1);
    // 0.4-unit steps clear the 1-unit gate on every third sample, and do so
    // whether the camera is zoomed in or far out.
    expect(atZoom1?.length).toBe(14);
    expect(walk(4)).toEqual(atZoom1);
    expect(walk(0.05)).toEqual(atZoom1);
  });

  it('onCancel discards the in-progress stroke', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
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
    tool.onPointerUp?.(
      pointer(10, 0, { pointerType: 'pen', pressure: 0.9 }),
      ctx,
    );

    const shape = [...shapes.values()][0];
    expect(shape?.type).toBe('draw');
    if (shape?.type !== 'draw') return;
    expect(shape.props.simulatePressure).toBe(false);
    expect(shape.props.points[0]?.pressure).toBe(0.75);
    expect(shape.props.points[1]?.pressure).toBe(1);
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
    for (const [x, y] of rest) tool.onPointerMove?.(pointer(x, y, overrides), ctx);
    tool.onPointerUp?.(
      pointer(path[path.length - 1]![0], path[path.length - 1]![1], overrides),
      ctx,
    );
    return [...shapes.values()][0];
  }

  const closed = (shape: Shape | undefined) =>
    shape?.type === 'draw' ? shape.props.isClosed : undefined;

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
          [3, 0],
          [1.5, 3],
          [0.5, 0.5],
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
    if (first?.type !== 'draw' || second?.type !== 'draw') throw new Error('n/a');
    expect(second.props.color).toBe(first.props.color);
    expect(second.props.size).toBe(first.props.size);
    expect(second.props.streamline).toBe(first.props.streamline);
    expect(second.props.thinning).toBe(first.props.thinning);
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
    // Points now carry a real signal, so re-deriving one from sample spacing
    // would be second-guessing it.
    expect(shape.props.simulatePressure).toBe(false);
    // 1 px/ms against a 1.5 px/ms floor.
    for (const point of shape.props.points.slice(1)) {
      expect(point.pressure).toBeCloseTo(1 / 3, 5);
    }
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
    expect(shape.props.points[0]?.pressure).toBeCloseTo(1 / 3, 5);
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
    for (const pressure of [...fastPressures, ...slowPressures]) {
      expect(pressure).toBeCloseTo(1 / 3, 5);
    }
  });

  it('thins toward nothing as the pointer outruns the width floor', () => {
    const slow = withSimulation(() => drag(60, 120, 6));
    const quick = withSimulation(() => drag(60, 30, 6));

    const last = (shape: Shape | undefined) =>
      shape?.type === 'draw'
        ? shape.props.points[shape.props.points.length - 1]?.pressure
        : undefined;

    expect(last(slow)).toBeCloseTo(2 / 3, 5);
    expect(last(quick)).toBe(0);
  });
});

describe('predicted pointer tail', () => {
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

    const store = useStrokePredictionStore.getState();
    expect(store.shapeId).not.toBeNull();
    // Pressure goes through the same stylus conditioning as a real sample
    // (0.5 × 1.25), so the tail cannot change width at the junction.
    expect(store.points).toEqual([{ x: 30, y: 0, pressure: 0.625 }]);
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
    expect(useStrokePredictionStore.getState().points).toHaveLength(1);

    tool.onPointerUp?.(pointer(10, 0), ctx);
    expect(useStrokePredictionStore.getState().shapeId).toBeNull();
    expect(useStrokePredictionStore.getState().points).toEqual([]);
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
    expect(useStrokePredictionStore.getState().shapeId).toBeNull();
    expect(useStrokePredictionStore.getState().points).toEqual([]);
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

    expect(
      useStrokePredictionStore.getState().points.map((p) => p.x),
    ).toEqual([20, 30]);
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

    expect(
      useStrokePredictionStore.getState().points.map((p) => p.x),
    ).toEqual([16]);
  });

  it('drops prediction while shift-snapping to an angle', () => {
    const { ctx } = context();
    const tool = createDrawTool();

    withSynchronousFrames(() => {
      tool.onPointerDown?.(pointer(0, 0), ctx);
      tool.onPointerMove?.(
        pointer(10, 0, {
          shiftKey: true,
          predicted: [prediction(20, 5)],
        }),
        ctx,
      );
    });

    // A shift stroke is a two-point straight line; a predicted tail would bend
    // it off the snapped angle.
    expect(useStrokePredictionStore.getState().points).toEqual([]);
  });
});
