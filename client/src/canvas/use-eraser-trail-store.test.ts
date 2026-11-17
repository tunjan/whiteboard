import { beforeEach, describe, expect, it } from 'vitest';
import {
  ERASER_TRAIL_LIFE_MS,
  ERASER_TRAIL_MAX_LENGTH,
  ERASER_TRAIL_SIZE,
  useEraserTrailStore,
} from './use-eraser-trail-store';

const scribble = () => useEraserTrailStore.getState().scribbles[0];

describe('eraser trail', () => {
  beforeEach(() => {
    useEraserTrailStore.getState().clear();
    useEraserTrailStore.setState({ scribbles: [], activeId: null });
  });

  it('keeps a time window of travel, gliding the tail between samples', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 }, 0.5, 0);
    for (let t = 20; t <= 200; t += 20) trail.extend({ x: t, y: 0 }, 0.5, t);

    trail.tick(210, 1);

    expect(scribble()?.points[0]!.x).toBeCloseTo(210 - ERASER_TRAIL_LIFE_MS);
    expect(scribble()?.points.at(-1)).toMatchObject({ x: 200, y: 0 });
  });

  it('measures the same ribbon at any pointer rate', () => {
    const ribbonAt = (hz: number) => {
      const trail = useEraserTrailStore.getState();
      trail.clear();
      trail.begin({ x: 0, y: 0 }, 0.5, 0);
      const step = 1000 / hz;
      for (let t = step; t <= 300; t += step) {
        trail.extend({ x: t * 2, y: 0 }, 0.5, t);
      }
      trail.tick(300, 1);
      const points = scribble()!.points;
      return points.at(-1)!.x - points[0]!.x;
    };

    expect(ribbonAt(1000)).toBeCloseTo(ribbonAt(60), 0);
  });

  it('caps the ribbon at a fixed screen length whatever the speed', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 }, 0.5, 0);
    for (let t = 10; t <= 100; t += 10) trail.extend({ x: t * 20, y: 0 }, 0.5, t);

    trail.tick(100, 2);

    const points = scribble()!.points;
    expect(points.at(-1)!.x - points[0]!.x).toBeCloseTo(
      ERASER_TRAIL_MAX_LENGTH / 2,
    );
  });

  it('slides the tip through samples too close to keep', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 }, 0.5, 0);
    trail.extend({ x: 5, y: 0 }, 0.5, 1);
    trail.extend({ x: 5.5, y: 0 }, 0.5, 2);
    trail.extend({ x: 6, y: 0 }, 0.5, 3);

    expect(scribble()?.points.map((p) => p.x)).toEqual([0, 5, 6]);
  });

  it('treats a repeated sample as no movement', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 3, y: 0 });
    const { scribbles } = useEraserTrailStore.getState();

    trail.extend({ x: 3, y: 0 });

    expect(useEraserTrailStore.getState().scribbles).toBe(scribbles);
  });

  it('eats an idle active tail down to one point without removing its tip', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 }, 0.5, 0);
    trail.extend({ x: 4, y: 0 }, 0.5, 10);
    trail.extend({ x: 8, y: 0 }, 0.5, 20);

    trail.tick(20 + ERASER_TRAIL_LIFE_MS, 1);

    const state = useEraserTrailStore.getState();
    expect(state.scribbles[0]?.points).toEqual([
      { x: 8, y: 0, pressure: 0.5, t: 20 },
    ]);
    expect(state.activeId).toBe(state.scribbles[0]?.id);
  });

  it('narrows a released trail by the clock, at any frame rate', () => {
    const sizeAfterRelease = (frameMs: number) => {
      const trail = useEraserTrailStore.getState();
      trail.clear();
      trail.begin({ x: 0, y: 0 });
      trail.extend({ x: 10, y: 0 });
      trail.end();
      const stopped = scribble()!.stoppedAt!;
      for (let t = frameMs; t <= 96; t += frameMs) trail.tick(stopped + t, 1);
      return scribble()!.size;
    };

    const at60Hz = sizeAfterRelease(16);
    expect(at60Hz).toBeLessThan(ERASER_TRAIL_SIZE);
    expect(sizeAfterRelease(8)).toBeCloseTo(at60Hz);
  });

  it('removes a released trail, even a dot that never moved', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.end();

    expect(useEraserTrailStore.getState().activeId).toBeNull();
    expect(scribble()?.state).toBe('stopping');

    trail.tick(scribble()!.stoppedAt! + ERASER_TRAIL_LIFE_MS, 1);
    expect(useEraserTrailStore.getState().scribbles).toEqual([]);
  });

  it('retires a still-draining ribbon when a new press lands', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 }, 0.5, 100);
    trail.begin({ x: 50, y: 0 }, 0.5, 120);

    const [old, current] = useEraserTrailStore.getState().scribbles;
    expect(old).toMatchObject({ state: 'stopping', stoppedAt: 120 });
    expect(current?.state).toBe('active');
  });
});
