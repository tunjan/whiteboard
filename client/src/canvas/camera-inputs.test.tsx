// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useWheel, cameraFromWheel } from './use-wheel';
import { useSafariGestures } from './use-safari-gestures';
import { useCameraStore } from './use-camera-store';
import { screenToWorld, worldToScreen, zoomCameraAtScreen } from './camera';

vi.mock('@/collab/attention', () => ({ noteActivity: vi.fn() }));
vi.mock('@/collab/use-follow-store', () => ({ stopFollowingForManualCameraChange: vi.fn() }));
const platform = vi.hoisted(() => ({ ios: false }));
vi.mock('./platform', () => ({ isDarwin: () => false, isIos: () => platform.ios }));
// Stubbed rather than driven through the real store, whose persistence has no
// working backing store in this environment.
const preferences = vi.hoisted(() => ({ invertScroll: false }));
vi.mock('./use-canvas-ui-store', () => ({ useCanvasUiStore: { getState: () => preferences } }));
let host: HTMLDivElement, root: Root, surface: HTMLElement, frames: Map<number, FrameRequestCallback>, nextId: number;
const store = () => useCameraStore.getState();
function Surface() {
  const ref = useRef<HTMLDivElement>(null);
  useWheel(ref);
  useSafariGestures(ref);
  return <div ref={ref} data-testid="surface" />;
}
async function mount() {
  await act(async () => root.render(<Surface />));
  surface = host.firstElementChild as HTMLElement;
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 1000, 600));
}
// happy-dom's WheelEvent extends UIEvent and omits MouseEvent fields.
const wheel = (init: WheelEventInit) => {
  const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  Object.assign(e, { clientX: 300, clientY: 250, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...init });
  return surface.dispatchEvent(e);
};
const gesture = (type: string, scale = 1, clientX = 300, clientY = 250) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { scale, clientX, clientY });
  surface.dispatchEvent(e);
};
function frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(performance.now() + 16)); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('GestureEvent', Event);
  frames = new Map(); nextId = 0; platform.ios = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  useCameraStore.setState({ camera: { x: 10, y: -20, z: 1 }, activeKey: 'test/one', constraints: null, viewport: { width: 1000, height: 600 } });
  preferences.invertScroll = false;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); store().stopCameraAnimation(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('wheel gesture integration', () => {
  it('publishes once per frame while preserving changing anchors and mixed pan/zoom order', async () => {
    await mount();
    const original = store().camera;
    const notify = vi.fn(), unsubscribe = useCameraStore.subscribe(notify);
    wheel({ deltaY: -10, ctrlKey: true });
    wheel({ deltaX: 22, deltaY: -11 });
    wheel({ deltaY: 10, ctrlKey: true, clientX: 750, clientY: 450 });
    expect(store().camera).toBe(original);
    let expected = zoomCameraAtScreen(original, { x: 200, y: 200 }, 1.1);
    expected = { ...expected, x: expected.x + 22 / expected.z, y: expected.y - 11 / expected.z };
    expected = zoomCameraAtScreen(expected, { x: 650, y: 400 }, expected.z * 0.9);
    frame();
    expect(store().camera).toEqual(expected);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('clamps each event, so reversing after the upper bound responds immediately', async () => {
    await mount(); store().setCamera({ x: 0, y: 0, z: 7.9 });
    wheel({ deltaY: -10, ctrlKey: true });
    wheel({ deltaY: 10, ctrlKey: true });
    frame();
    expect(store().camera.z).toBeCloseTo(7.2);
  });

  it('flushes before a pointer press and cancels existing momentum synchronously', async () => {
    await mount();
    store().slideCamera({ x: 1, y: 0 });
    wheel({ deltaY: 20 });
    expect(frames.size).toBe(1);
    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(store().camera.y).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('discards pending wheel input on a page switch', async () => {
    await mount(); wheel({ deltaY: 100 });
    store().switchTo('test', 'two');
    const camera = store().camera;
    frame();
    expect(store().camera).toBe(camera);
    expect(camera.y).toBe(0);
  });

  it('reverses a wheel, but not a trackpad, while the preference is on', async () => {
    await mount();
    preferences.invertScroll = true;
    const start = store().camera.y;
    // A whole notch on one axis: a wheel, so the preference applies.
    wheel({ deltaY: 120 });
    frame();
    expect(store().camera.y).toBe(start - 120);
    // A small delta from a surface under two fingers: left as the OS sent it.
    const afterWheel = store().camera.y;
    wheel({ deltaY: 12 });
    frame();
    expect(store().camera.y).toBe(afterWheel + 12);
  });

  it('does not reinterpret Shift + Ctrl as horizontal pan on Windows', () => {
    const original = store().camera;
    const next = cameraFromWheel(original, { deltaX: 0, deltaY: -10, deltaMode: 0, shiftKey: true, ctrlKey: true }, { x: 100, y: 200 }, null, undefined, false);
    expect(next.z).toBe(1.1);
    expect(screenToWorld({ x: 100, y: 200 }, next)).toEqual(screenToWorld({ x: 100, y: 200 }, original));
  });
});

describe('Safari gesture integration', () => {
  it('uses the cumulative scale and follows the moving midpoint', async () => {
    await mount();
    const world = screenToWorld({ x: 200, y: 200 }, store().camera);
    gesture('gesturestart'); gesture('gesturechange', 2, 320, 260);
    gesture('gesturechange', 3, 340, 280);
    expect(store().camera.z).toBe(3);
    const actual = worldToScreen(world, store().camera);
    expect(actual.x).toBeCloseTo(240); expect(actual.y).toBeCloseTo(230);
  });

  it('ignores malformed scales, orphan changes, and changes after ending', async () => {
    await mount(); const original = store().camera;
    gesture('gesturechange', 2); expect(store().camera).toBe(original);
    gesture('gesturestart'); gesture('gesturechange', NaN); gesture('gesturechange', 0);
    expect(store().camera).toBe(original);
    gesture('gestureend'); gesture('gesturechange', 3);
    expect(store().camera).toBe(original);
  });

  it('does not double-process native gesture events on iOS', async () => {
    platform.ios = true; await mount(); const original = store().camera;
    gesture('gesturestart'); gesture('gesturechange', 2);
    expect(store().camera).toBe(original);
  });
});
