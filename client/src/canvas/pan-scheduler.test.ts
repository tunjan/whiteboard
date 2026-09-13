import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanScheduler } from './pan-scheduler';
import { useCameraStore } from './use-camera-store';

describe('PanScheduler', () => {
  let frames: Array<() => void>;

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => {};
    });
    useCameraStore.setState({
      camera: { x: 0, y: 0, z: 1 },
      constraints: null,
      viewport: { width: 1000, height: 800 },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const runFrame = () => {
    const due = frames;
    frames = [];
    for (const cb of due) cb();
  };
  const camera = () => useCameraStore.getState().camera;

  it('applies nothing until the frame runs', () => {
    const pan = new PanScheduler();
    pan.push(10, 5);
    expect(camera()).toMatchObject({ x: 0, y: 0 });
    runFrame();
    expect(camera()).toMatchObject({ x: 10, y: 5 });
  });

  it('lands eight moves in one place, exactly where eight writes would', () => {
    const eager = new PanScheduler();
    for (let i = 0; i < 8; i++) {
      eager.push(3, -2);
      runFrame();
    }
    const oneAtATime = camera();

    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
    const pan = new PanScheduler();
    for (let i = 0; i < 8; i++) pan.push(3, -2);
    // Eight moves inside one frame schedule exactly one camera write.
    expect(frames.length).toBe(1);
    runFrame();
    expect(camera()).toEqual(oneAtATime);
  });

  it('flushes synchronously and leaves no frame behind', () => {
    const pan = new PanScheduler();
    pan.push(10, 5);
    pan.flush();
    expect(camera()).toMatchObject({ x: 10, y: 5 });
    // A queued frame surviving the flush would re-apply the same delta — and,
    // landing after `slideCamera`, would cancel the coast it started.
    runFrame();
    expect(camera()).toMatchObject({ x: 10, y: 5 });
  });

  it('drops queued motion on cancel', () => {
    const pan = new PanScheduler();
    pan.push(10, 5);
    pan.cancel();
    runFrame();
    expect(camera()).toMatchObject({ x: 0, y: 0 });
  });

  it('is inert when nothing is queued', () => {
    const pan = new PanScheduler();
    pan.flush();
    expect(camera()).toMatchObject({ x: 0, y: 0 });
    expect(frames.length).toBe(0);
  });
});
