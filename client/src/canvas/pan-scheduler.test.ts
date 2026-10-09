import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanScheduler, PinchScheduler } from './pan-scheduler';
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

describe('PinchScheduler', () => {
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

  // A spread whose midpoint wanders: each move reports where the midpoint is,
  // the zoom the separation asks for, and the midpoint's travel since the last.
  const moves = [
    { x: 400, y: 300, z: 1.1 },
    { x: 410, y: 296, z: 1.3 },
    { x: 425, y: 301, z: 1.2 },
    { x: 431, y: 318, z: 1.6 },
  ];
  const play = (pinch: PinchScheduler, flushEach: boolean) => {
    let last = { x: 400, y: 300 };
    moves.forEach((m, i) => {
      pinch.push({ x: m.x, y: m.y }, m.z, m.x - last.x, m.y - last.y, i);
      last = m;
      if (flushEach) runFrame();
    });
  };

  it('lands a frame of moves exactly where one write per move would', () => {
    play(new PinchScheduler(() => {}), true);
    const oneAtATime = camera();

    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
    play(new PinchScheduler(() => {}), false);
    expect(frames.length).toBe(1);
    runFrame();
    expect(camera().z).toBe(oneAtATime.z);
    expect(camera().x).toBeCloseTo(oneAtATime.x, 9);
    expect(camera().y).toBeCloseTo(oneAtATime.y, 9);
  });

  it('reports the newest move it applied, once per write', () => {
    const commits: number[] = [];
    const pinch = new PinchScheduler((time) => commits.push(time));
    play(pinch, false);
    runFrame();
    expect(commits).toEqual([moves.length - 1]);
  });

  it('flushes synchronously, then is inert', () => {
    const commits: number[] = [];
    const pinch = new PinchScheduler((time) => commits.push(time));
    pinch.push({ x: 0, y: 0 }, 2, 0, 0, 7);
    pinch.flush();
    expect(camera().z).toBe(2);
    pinch.flush();
    runFrame();
    expect(commits).toEqual([7]);
  });

  it('drops queued moves on cancel', () => {
    const pinch = new PinchScheduler(() => {});
    pinch.push({ x: 0, y: 0 }, 2, 5, 5, 0);
    pinch.cancel();
    runFrame();
    expect(camera()).toEqual({ x: 0, y: 0, z: 1 });
  });
});
