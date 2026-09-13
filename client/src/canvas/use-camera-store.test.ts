// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useCameraStore } from './use-camera-store';
import { screenToWorld, worldToScreen } from './camera';

let frames: Map<number, FrameRequestCallback>, now: number, id: number;
const store = () => useCameraStore.getState();
function frame(ms: number) {
  now += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(now));
}

beforeEach(() => {
  frames = new Map(); now = 0; id = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  store().stopCameraAnimation();
  useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 }, cameras: {}, activeKey: '', constraints: null, viewport: { width: 1000, height: 600 }, baseZoom: 1 });
});
afterEach(() => { store().stopCameraAnimation(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('camera lifecycle', () => {
  it('interrupts an animation without changing the current view', () => {
    store().animateZoomAtScreen({ x: 400, y: 300 }, 4);
    frame(140);
    expect(store().camera.z).toBeCloseTo(1.6);
    const before = store().camera;
    store().stopCameraAnimation();
    frame(1000);
    expect(store().camera).toBe(before);
    expect(frames.size).toBe(0);
  });

  it('stops a coast immediately when a new interaction begins', () => {
    store().slideCamera({ x: 1, y: -0.5 });
    frame(16);
    expect(store().camera.x).toBeLessThan(0);
    const before = store().camera;
    store().stopCameraAnimation();
    frame(1000);
    expect(store().camera).toBe(before);
  });

  it('does not reschedule a tween after a subscriber interrupts it', () => {
    const stop = useCameraStore.subscribe(() => store().stopCameraAnimation());
    store().animateZoomAtScreen({ x: 100, y: 200 }, 4);
    frame(16);
    expect(frames.size).toBe(0);
    stop();
  });

  it('keeps page cameras local and cancels movement when switching pages', () => {
    store().switchTo('board', 'one');
    store().setCamera({ x: 20, y: 30, z: 2 });
    store().slideCamera({ x: 1, y: 0 });
    store().switchTo('board', 'two');
    frame(500);
    expect(store().camera).toEqual({ x: 0, y: 0, z: 1 });
    store().switchTo('board', 'one');
    expect(store().camera).toEqual({ x: 20, y: 30, z: 2 });
  });

  it('keeps panning with the midpoint at a constrained pinch zoom limit', () => {
    store().setConstraints({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, behavior: 'free', maxZoom: 2 });
    const previousMidpoint = { x: 100, y: 200 }, midpoint = { x: 140, y: 180 };
    const world = screenToWorld(previousMidpoint, store().camera);
    store().zoomAtScreenWithPan(midpoint, 20, 40, -20);
    const actual = worldToScreen(world, store().camera);
    expect(store().camera.z).toBe(2);
    expect(actual.x).toBeCloseTo(midpoint.x);
    expect(actual.y).toBeCloseTo(midpoint.y);
  });

  it('publishes no movement for a no-op at a zoom limit', () => {
    store().zoomAtScreen({ x: 100, y: 200 }, 8);
    const notify = vi.fn(), stop = useCameraStore.subscribe(notify);
    store().zoomAtScreen({ x: 100, y: 200 }, 80);
    expect(notify).not.toHaveBeenCalled();
    stop();
  });

  it('honors reduced motion for zoom animations and momentum', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    store().animateZoomAtScreen({ x: 100, y: 200 }, 4);
    expect(store().camera.z).toBe(4);
    store().slideCamera({ x: 1, y: 0 });
    expect(frames.size).toBe(0);
  });

  it('centers a point at a requested zoom, clamped to the zoom limits', () => {
    store().centerOn({ x: 500, y: 400 }, 2);
    expect(store().camera.z).toBe(2);
    const screen = worldToScreen({ x: 500, y: 400 }, store().camera);
    expect(screen.x).toBeCloseTo(500);
    expect(screen.y).toBeCloseTo(300);

    // Past the ceiling the framing must follow the zoom that was actually
    // applied, not the one that was asked for.
    store().centerOn({ x: 500, y: 400 }, 80);
    expect(store().camera.z).toBe(8);
    const clamped = worldToScreen({ x: 500, y: 400 }, store().camera);
    expect(clamped.x).toBeCloseTo(500);
    expect(clamped.y).toBeCloseTo(300);
  });

  it('leaves zoom alone when centering without one', () => {
    store().setCamera({ x: 0, y: 0, z: 4 });
    store().centerOn({ x: 10, y: 20 });
    expect(store().camera.z).toBe(4);
    const screen = worldToScreen({ x: 10, y: 20 }, store().camera);
    expect(screen.x).toBeCloseTo(500);
    expect(screen.y).toBeCloseTo(300);
  });
});
