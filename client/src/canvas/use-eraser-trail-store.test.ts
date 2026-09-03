import { beforeEach, describe, expect, it } from 'vitest';
import {
  ERASER_TRAIL_MAX,
  ERASER_TRAIL_SIZE,
  useEraserTrailStore,
} from './use-eraser-trail-store';

describe('eraser trail', () => {
  beforeEach(() => {
    useEraserTrailStore.getState().clear();
    useEraserTrailStore.setState({ scribbles: [], activeId: null, seq: 0 });
  });

  it('never grows past the ring buffer, dropping the oldest point', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    for (let x = 1; x <= ERASER_TRAIL_MAX + 4; x++) trail.extend({ x, y: 0 });

    const [scribble] = useEraserTrailStore.getState().scribbles;
    expect(scribble?.points).toHaveLength(ERASER_TRAIL_MAX);
    expect(scribble?.points[scribble.points.length - 1]).toMatchObject({
      x: ERASER_TRAIL_MAX + 4,
      y: 0,
    });
    expect(scribble?.points[0]!.x).toBe(5);
  });

  it('treats a repeated sample as no movement', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 3, y: 0 });
    const { seq, scribbles } = useEraserTrailStore.getState();

    trail.extend({ x: 3, y: 0 });

    expect(useEraserTrailStore.getState().seq).toBe(seq);
    expect(useEraserTrailStore.getState().scribbles).toBe(scribbles);
  });

  it('eats an idle active tail down to one point without removing its tip', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 1, y: 0 });
    trail.extend({ x: 2, y: 0 });

    trail.tick(true);
    trail.tick(true);
    trail.tick(true);

    const state = useEraserTrailStore.getState();
    expect(state.scribbles[0]?.points).toEqual([
      { x: 2, y: 0, pressure: 0.5 },
    ]);
    expect(state.activeId).toBe(state.scribbles[0]?.id);
  });

  it('shrinks and removes a stopping trail', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 1, y: 0 });
    trail.extend({ x: 2, y: 0 });
    trail.extend({ x: 3, y: 0 });
    trail.end();

    expect(useEraserTrailStore.getState().activeId).toBeNull();
    expect(useEraserTrailStore.getState().scribbles[0]?.state).toBe('stopping');
    trail.tick(false);
    expect(useEraserTrailStore.getState().scribbles[0]?.size).toBeLessThan(
      ERASER_TRAIL_SIZE,
    );
    trail.tick(false);
    trail.tick(false);

    expect(useEraserTrailStore.getState().scribbles).toEqual([]);
  });
});
