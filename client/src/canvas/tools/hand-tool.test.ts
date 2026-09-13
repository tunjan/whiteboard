import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandTool } from './hand-tool';
import type { ToolContext, ToolPointerInfo } from './types';

const mocks = vi.hoisted(() => ({
  stopCameraAnimation: vi.fn(),
  panByScreen: vi.fn(),
  slideCamera: vi.fn(),
  setHandDragging: vi.fn(),
  stopFollowing: vi.fn(),
}));

vi.mock('../use-camera-store', () => ({
  useCameraStore: {
    getState: () => ({
      stopCameraAnimation: mocks.stopCameraAnimation,
      panByScreen: mocks.panByScreen,
      slideCamera: mocks.slideCamera,
    }),
  },
}));

vi.mock('../use-camera-interaction', () => ({
  useCameraInteraction: vi.fn(),
  setHandDragging: mocks.setHandDragging,
}));

vi.mock('@/collab/use-follow-store', () => ({
  stopFollowingForManualCameraChange: mocks.stopFollowing,
}));

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
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    ...overrides,
  };
}

const context = {} as ToolContext;

describe('hand tool', () => {
  // The tool pans through a `PanScheduler`, which holds deltas until the next
  // animation frame. Drive frames by hand so a test says when one happens.
  let pending: Array<() => void> = [];
  const frame = () => {
    const due = pending;
    pending = [];
    for (const cb of due) cb();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pending = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      pending.push(cb);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pending[id - 1] = () => {};
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('publishes its grip state and pans with the pointer', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(10, 20), context);
    tool.onPointerMove?.(pointer(18, 14), context);

    expect(mocks.setHandDragging).toHaveBeenCalledWith(true);
    expect(mocks.stopFollowing).toHaveBeenCalledOnce();
    // Held until the frame, not written per move.
    expect(mocks.panByScreen).not.toHaveBeenCalled();
    frame();
    expect(mocks.panByScreen).toHaveBeenCalledWith(-8, 6);

    tool.onPointerUp?.(pointer(18, 14), context);
    expect(mocks.setHandDragging).toHaveBeenLastCalledWith(false);
  });

  it('writes the camera once per frame however many moves arrive', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0), context);
    for (let i = 1; i <= 8; i++) tool.onPointerMove?.(pointer(i * 3, 0), context);
    frame();

    expect(mocks.panByScreen).toHaveBeenCalledTimes(1);
    // And at the position the eight moves actually reached.
    expect(mocks.panByScreen).toHaveBeenCalledWith(-24, 0);
  });

  it('flushes the pending frame before the release coast starts', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0, { timestamp: 0 }), context);
    tool.onPointerMove?.(pointer(-16, 0, { timestamp: 16 }), context);
    tool.onPointerUp?.(pointer(-16, 0, { timestamp: 16 }), context);

    // The last frame of drag must land before the coast, or the coast starts
    // behind the finger — and a later flush would cancel it outright.
    expect(mocks.panByScreen).toHaveBeenCalledWith(16, 0);
    const panOrder = mocks.panByScreen.mock.invocationCallOrder[0]!;
    const slideOrder = mocks.slideCamera.mock.invocationCallOrder[0]!;
    expect(panOrder).toBeLessThan(slideOrder);
    // Nothing left queued to re-apply or to cancel the coast.
    frame();
    expect(mocks.panByScreen).toHaveBeenCalledTimes(1);
  });

  it('hands the release velocity to the camera to coast on', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0, { timestamp: 0 }), context);
    // A steady 1 px/ms leftward drag, sampled every 16 ms.
    for (let i = 1; i <= 8; i++) {
      tool.onPointerMove?.(pointer(-16 * i, 0, { timestamp: 16 * i }), context);
    }
    tool.onPointerUp?.(pointer(-128, 0, { timestamp: 128 }), context);

    const [velocity] = mocks.slideCamera.mock.calls[0]!;
    expect(velocity.x).toBeLessThan(0);
    expect(velocity.y).toBe(0);
  });

  it('does not coast after a drag that came to rest before lifting', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0, { timestamp: 0 }), context);
    for (let i = 1; i <= 8; i++) {
      tool.onPointerMove?.(pointer(-16 * i, 0, { timestamp: 16 * i }), context);
    }
    // Held still for a third of a second, then released.
    tool.onPointerUp?.(pointer(-128, 0, { timestamp: 460 }), context);

    const [velocity] = mocks.slideCamera.mock.calls[0]!;
    expect(velocity.x).toBe(0);
    expect(velocity.y).toBe(0);
  });

  it('ignores secondary-button and zero-distance movement', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0, { button: 2 }), context);
    tool.onPointerMove?.(pointer(8, 8), context);
    frame();
    expect(mocks.panByScreen).not.toHaveBeenCalled();
    expect(mocks.stopFollowing).not.toHaveBeenCalled();

    tool.onPointerDown?.(pointer(4, 4), context);
    tool.onPointerMove?.(pointer(4, 4), context);
    frame();
    expect(mocks.panByScreen).not.toHaveBeenCalled();
  });

  it('clears the grip state when cancelled or switched away', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(0, 0), context);
    tool.onCancel?.(context);
    tool.onExit?.(context);

    expect(mocks.setHandDragging).toHaveBeenLastCalledWith(false);
  });
});
