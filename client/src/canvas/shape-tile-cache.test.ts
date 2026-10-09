// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShapeTileCache } from './shape-tile-cache';

let camera = { x: 0, y: 0, z: 1 };
let moving = false;
let eligible = true;
let live: HTMLDivElement, host: HTMLDivElement, cache: ShapeTileCache;
const draw = vi.fn(async () => document.createElement('canvas'));
const dispose = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  camera = { x: 0, y: 0, z: 1 };
  moving = false;
  eligible = true;
  live = document.createElement('div');
  host = document.createElement('div');
  draw
    .mockReset()
    .mockImplementation(async () => document.createElement('canvas'));
  dispose.mockReset();
  cache = new ShapeTileCache({
    live,
    host,
    width: 600,
    height: 400,
    camera: () => camera,
    moving: () => moving,
    eligible: () => eligible,
    source: () => ({ tile: draw, dispose }),
  });
});
afterEach(() => {
  cache.dispose();
  vi.useRealTimers();
});
const warm = () => vi.advanceTimersByTimeAsync(1000);

describe('shape tile lifecycle', () => {
  it('warms at rest, translates cached cells during a gesture, and restores live shapes on settle', async () => {
    cache.refresh();
    await warm();
    expect(draw).toHaveBeenCalled();
    expect(live.style.display).toBe('');
    const paints = draw.mock.calls.length;
    moving = true;
    camera = { x: 10, y: 10, z: 1.05 };
    cache.refresh();
    expect(live.style.display).toBe('none');
    expect(host.dataset.rasterState).toBe('cached');
    await warm();
    expect(draw).toHaveBeenCalledTimes(paints);
    moving = false;
    cache.refresh();
    expect(live.style.display).toBe('');
    expect(host.style.display).toBe('none');
    await warm();
    expect(draw.mock.calls.length).toBeGreaterThan(paints);
  });

  it('shows live content on an uncovered leading edge and resumes caching when ready', async () => {
    cache.refresh();
    await warm();
    moving = true;
    camera = { x: 600, y: 0, z: 1 };
    cache.refresh();
    expect(live.style.display).toBe('');
    await warm();
    expect(live.style.display).toBe('none');
    expect(host.querySelector('[data-raster-tile="2:0"]')).not.toBeNull();
  });

  it('rejects stale asynchronous results after a content change or unmount', async () => {
    let finish!: (canvas: HTMLCanvasElement) => void;
    draw.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    cache.refresh();
    await vi.advanceTimersByTimeAsync(20);
    cache.invalidate();
    const stale = document.createElement('canvas');
    finish(stale);
    await vi.advanceTimersByTimeAsync(0);
    expect(stale.width).toBe(0);
    expect(host.children.length).toBe(0);
    cache.dispose();
    await warm();
    expect(host.children.length).toBe(0);
    expect(live.style.display).toBe('');
  });

  it('keeps vectors on failure and stops scheduling when work is exhausted', async () => {
    draw.mockRejectedValue(new Error('Unsupported live content'));
    moving = true;
    cache.refresh();
    await warm();
    expect(live.style.display).toBe('');
    expect(host.dataset.rasterState).toBe('unsupported');
    const attempts = draw.mock.calls.length;
    await warm();
    expect(draw).toHaveBeenCalledTimes(attempts);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the previous level during a zoom-band rebuild and disables immediately for editing', async () => {
    cache.refresh();
    await warm();
    moving = true;
    camera = { x: 0, y: 0, z: Math.SQRT2 };
    cache.refresh();
    expect(live.style.display).toBe('none');
    expect(dispose).toHaveBeenCalled();
    await warm();
    expect(host.style.transform).toContain('scale(1)');
    expect(live.style.display).toBe('none');
    eligible = false;
    cache.refresh();
    expect(live.style.display).toBe('');
    expect(host.children.length).toBe(0);
  });
});
