import { beforeEach, describe, expect, it } from 'vitest';
import { ERASER_TRAIL_MAX, useEraserTrailStore } from './use-eraser-trail-store';

describe('eraser trail', () => {
  beforeEach(() => {
    useEraserTrailStore.setState({ points: [], active: false, seq: 0 });
  });

  it('never grows past the ring buffer, dropping the oldest point', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    for (let x = 1; x <= ERASER_TRAIL_MAX + 4; x++) trail.extend({ x, y: 0 });

    const { points } = useEraserTrailStore.getState();
    expect(points).toHaveLength(ERASER_TRAIL_MAX);
    // The head moved with the pointer; the tail was eaten from the front.
    expect(points[points.length - 1]).toEqual({ x: ERASER_TRAIL_MAX + 4, y: 0 });
    expect(points[0]!.x).toBe(5);
  });

  it('treats a repeated sample as no movement', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 3, y: 0 });
    const { seq, points } = useEraserTrailStore.getState();

    trail.extend({ x: 3, y: 0 });

    // Unchanged seq is what tells the layer to start eating the tail.
    expect(useEraserTrailStore.getState().seq).toBe(seq);
    expect(useEraserTrailStore.getState().points).toEqual(points);
  });

  it('drains to empty once the stroke has been lifted', () => {
    const trail = useEraserTrailStore.getState();
    trail.begin({ x: 0, y: 0 });
    trail.extend({ x: 1, y: 0 });
    trail.end();

    expect(useEraserTrailStore.getState().active).toBe(false);
    trail.consume();
    trail.consume();
    trail.consume();

    expect(useEraserTrailStore.getState().points).toEqual([]);
  });
});
