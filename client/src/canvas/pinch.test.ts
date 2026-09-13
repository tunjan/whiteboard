import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from './camera';
import {
  PINCH_PAN_THRESHOLD,
  PINCH_ZOOM_RATE_STALE_MS,
  PINCH_ZOOM_THRESHOLD,
  PINCH_ZOOM_UPGRADE_THRESHOLD,
  nextPinchMode,
  pinchGesture,
  pinchReleaseZoomRate,
  pruneStaleTouches,
  trackPinchZoom,
  zoomFromDistance,
  type PinchMode,
  type PinchState,
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

describe('pinch zoom velocity', () => {
  const pinchAt = (mode: PinchMode, zoom = 1, now = 1000): PinchState => ({
    startDistance: 100,
    startZoom: zoom,
    startMidpoint: { x: 0, y: 0 },
    lastMidpoint: { x: 0, y: 0 },
    mode,
    zoomRate: 0,
    lastZoom: zoom,
    lastZoomTime: now,
  });

  it('measures a spread as a positive rate and a close as a negative one', () => {
    const spreading = pinchAt('zooming');
    trackPinchZoom(spreading, 1.1, 1016);
    expect(spreading.zoomRate).toBeGreaterThan(0);

    const closing = pinchAt('zooming');
    trackPinchZoom(closing, 0.9, 1016);
    expect(closing.zoomRate).toBeLessThan(0);
  });

  it('converges on a steady rate and decays back toward zero when the fingers stop', () => {
    const pinch = pinchAt('zooming');
    let zoom = 1;
    let now = 1000;
    for (let i = 0; i < 20; i++) {
      zoom *= Math.exp(0.004 * 16);
      now += 16;
      trackPinchZoom(pinch, zoom, now);
    }
    expect(pinch.zoomRate).toBeCloseTo(0.004, 4);

    const moving = pinch.zoomRate;
    for (let i = 0; i < 10; i++) {
      now += 16;
      trackPinchZoom(pinch, zoom, now);
    }
    expect(Math.abs(pinch.zoomRate)).toBeLessThan(moving / 10);
  });

  it('ignores samples that carry no time or no scale', () => {
    const pinch = pinchAt('zooming');
    trackPinchZoom(pinch, 2, 1000);
    trackPinchZoom(pinch, 0, 1016);
    expect(pinch.zoomRate).toBe(0);
    expect(pinch.lastZoom).toBe(1);
  });

  it('releases the rate a zoom lifted at', () => {
    const pinch = pinchAt('zooming');
    trackPinchZoom(pinch, 1.1, 1016);
    expect(pinchReleaseZoomRate(pinch, 1016)).toBe(pinch.zoomRate);
  });

  it('releases nothing from a pan, whatever the scale did', () => {
    const pinch = pinchAt('panning');
    trackPinchZoom(pinch, 1.1, 1016);
    expect(pinchReleaseZoomRate(pinch, 1016)).toBe(0);
  });

  it('releases nothing from a scale that was set and then held', () => {
    const pinch = pinchAt('zooming');
    trackPinchZoom(pinch, 1.1, 1016);
    expect(
      pinchReleaseZoomRate(pinch, 1016 + PINCH_ZOOM_RATE_STALE_MS + 1),
    ).toBe(0);
  });
});
