import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from './camera';
import {
  PINCH_PAN_THRESHOLD,
  PINCH_ZOOM_THRESHOLD,
  PINCH_ZOOM_UPGRADE_THRESHOLD,
  nextPinchMode,
  pinchGesture,
  pruneStaleTouches,
  zoomFromDistance,
} from './pinch';

describe('pinchGesture', () => {
  it('returns the midpoint and finger separation', () => {
    const g = pinchGesture({ x: 0, y: 0 }, { x: 4, y: 3 });
    expect(g.midpoint).toEqual({ x: 2, y: 1.5 });
    expect(g.distance).toBe(5);
  });
});

describe('zoomFromDistance', () => {
  it('keeps the zoom when fingers do not move', () => {
    expect(zoomFromDistance(1, 100, 100)).toBeCloseTo(1);
  });

  it('zooms in as the fingers spread', () => {
    expect(zoomFromDistance(1, 100, 200)).toBeCloseTo(2);
  });

  it('zooms out as the fingers pinch together', () => {
    expect(zoomFromDistance(2, 200, 100)).toBeCloseTo(1);
  });

  it('clamps within the allowed zoom range', () => {
    expect(zoomFromDistance(1, 1, 10_000)).toBeLessThanOrEqual(MAX_ZOOM);
    expect(zoomFromDistance(1, 10_000, 1)).toBeGreaterThanOrEqual(MIN_ZOOM);
  });

  it('returns the start zoom for a degenerate start distance', () => {
    expect(zoomFromDistance(1.5, 0, 100)).toBe(1.5);
  });
});

describe('pruneStaleTouches', () => {
  it('removes only entries older than the window', () => {
    const touches = new Map([
      [1, { x: 0, y: 0, t: 900 }],
      [2, { x: 0, y: 0, t: 2500 }],
    ]);
    pruneStaleTouches(touches, 3000, 2000);
    expect([...touches.keys()]).toEqual([2]);
  });

  it('keeps fresh entries untouched', () => {
    const touches = new Map([[1, { x: 0, y: 0, t: 2900 }]]);
    pruneStaleTouches(touches, 3000, 2000);
    expect(touches.size).toBe(1);
  });

  it('drains the map once every entry is stale (recovery from dropped releases)', () => {
    const touches = new Map([
      [1, { x: 0, y: 0, t: 0 }],
      [2, { x: 0, y: 0, t: 100 }],
    ]);
    pruneStaleTouches(touches, 5000, 2000);
    expect(touches.size).toBe(0);
  });
});

describe('nextPinchMode', () => {
  const start = { distance: 100, midpoint: { x: 0, y: 0 } };
  const at = (distance: number, x = 0, y = 0) => ({
    distance,
    midpoint: { x, y },
  });

  it('stays undecided inside both deadbands', () => {
    expect(
      nextPinchMode(
        'unsure',
        start,
        at(100 + PINCH_ZOOM_THRESHOLD, PINCH_PAN_THRESHOLD, 0),
      ),
    ).toBe('unsure');
  });

  it('classifies a spread as a zoom', () => {
    expect(
      nextPinchMode('unsure', start, at(100 + PINCH_ZOOM_THRESHOLD + 1)),
    ).toBe('zooming');
  });

  it('classifies a pinch together as a zoom', () => {
    expect(
      nextPinchMode('unsure', start, at(100 - PINCH_ZOOM_THRESHOLD - 1)),
    ).toBe('zooming');
  });

  it('classifies midpoint travel with steady fingers as a pan', () => {
    expect(nextPinchMode('unsure', start, at(100, 0, PINCH_PAN_THRESHOLD + 1))).toBe(
      'panning',
    );
  });

  it('prefers zoom when both thresholds are crossed', () => {
    expect(
      nextPinchMode(
        'unsure',
        start,
        at(100 + PINCH_ZOOM_THRESHOLD + 1, 500, 500),
      ),
    ).toBe('zooming');
  });

  it('holds a pan through a spread below the wider upgrade threshold', () => {
    expect(
      nextPinchMode(
        'panning',
        start,
        at(100 + PINCH_ZOOM_UPGRADE_THRESHOLD, 300, 0),
      ),
    ).toBe('panning');
  });

  it('upgrades a pan to a zoom past the wider threshold', () => {
    expect(
      nextPinchMode(
        'panning',
        start,
        at(100 + PINCH_ZOOM_UPGRADE_THRESHOLD + 1),
      ),
    ).toBe('zooming');
  });

  it('never leaves zooming', () => {
    expect(nextPinchMode('zooming', start, at(100, 0, 0))).toBe('zooming');
  });
});
