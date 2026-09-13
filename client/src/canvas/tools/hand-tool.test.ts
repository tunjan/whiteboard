import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => vi.clearAllMocks());

  it('publishes its grip state and pans with the pointer', () => {
    const tool = createHandTool();

    tool.onPointerDown?.(pointer(10, 20), context);
    tool.onPointerMove?.(pointer(18, 14), context);

    expect(mocks.setHandDragging).toHaveBeenCalledWith(true);
    expect(mocks.stopFollowing).toHaveBeenCalledOnce();
    expect(mocks.panByScreen).toHaveBeenCalledWith(-8, 6);

    tool.onPointerUp?.(pointer(18, 14), context);
    expect(mocks.setHandDragging).toHaveBeenLastCalledWith(false);
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
    expect(mocks.panByScreen).not.toHaveBeenCalled();
    expect(mocks.stopFollowing).not.toHaveBeenCalled();

    tool.onPointerDown?.(pointer(4, 4), context);
    tool.onPointerMove?.(pointer(4, 4), context);
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
