import { describe, expect, it } from 'vitest';
import {
  SLIDE_FRICTION,
  SLIDE_MAX_SPEED,
  SLIDE_MAX_ZOOM_RATE,
  SLIDE_MIN_RELEASE_SPEED,
  SLIDE_MIN_RELEASE_ZOOM_RATE,
  beginCameraSlide,
  stepCameraSlide,
} from './camera-slide';

describe('beginCameraSlide', () => {
  it('ignores a release too slow to be a throw', () => {
    expect(beginCameraSlide({ x: SLIDE_MIN_RELEASE_SPEED * 0.9, y: 0 })).toBe(
      null,
    );
    expect(beginCameraSlide({ x: 0, y: 0 })).toBe(null);
  });

  it('keeps the direction and caps the speed', () => {
    const slide = beginCameraSlide({ x: 6, y: 8 })!;
    expect(slide.ux).toBeCloseTo(0.6);
    expect(slide.uy).toBeCloseTo(0.8);
    expect(slide.speed).toBe(SLIDE_MAX_SPEED);
    expect(slide.zoomRate).toBe(0);
  });

  it('coasts a pinch released mid-scale, with no translation of its own', () => {
    const slide = beginCameraSlide({ x: 0, y: 0 }, 0.004)!;
    expect(slide.speed).toBe(0);
    expect(slide.zoomRate).toBe(0.004);
  });

  it('ignores a scale that was set rather than thrown', () => {
    expect(
      beginCameraSlide({ x: 0, y: 0 }, SLIDE_MIN_RELEASE_ZOOM_RATE * 0.9),
    ).toBe(null);
  });

  it('caps the zoom rate in both directions', () => {
    expect(beginCameraSlide({ x: 0, y: 0 }, 5)!.zoomRate).toBe(
      SLIDE_MAX_ZOOM_RATE,
    );
    expect(beginCameraSlide({ x: 0, y: 0 }, -5)!.zoomRate).toBe(
      -SLIDE_MAX_ZOOM_RATE,
    );
  });
});

describe('stepCameraSlide', () => {
  it('travels along the release direction', () => {
    const slide = beginCameraSlide({ x: 1, y: 0 })!;
    const { dx, dy } = stepCameraSlide(slide, 16);
    expect(dx).toBeCloseTo(16);
    expect(dy).toBe(0);
  });

  it('sheds a fixed fraction of the speed per frame, whatever the frame took', () => {
    const start = beginCameraSlide({ x: 1, y: 0 })!;
    expect(stepCameraSlide(start, 16).next!.speed).toBeCloseTo(
      start.speed * (1 - SLIDE_FRICTION),
    );
    expect(stepCameraSlide(start, 8).next!.speed).toBeCloseTo(
      start.speed * (1 - SLIDE_FRICTION),
    );
  });

  it('scales the zoom exponentially over the elapsed time', () => {
    const slide = beginCameraSlide({ x: 0, y: 0 }, 0.004)!;
    expect(stepCameraSlide(slide, 16).zoomFactor).toBeCloseTo(
      Math.exp(0.004 * 16),
    );
    // Twice the frame, twice the log-zoom: half the frame rate lands the same
    // scale change per frame regardless of when the frame is delivered.
    expect(stepCameraSlide(slide, 32).zoomFactor).toBeCloseTo(
      stepCameraSlide(slide, 16).zoomFactor ** 2,
    );
  });

  it('never drives the zoom to or through zero', () => {
    let slide = beginCameraSlide({ x: 0, y: 0 }, -SLIDE_MAX_ZOOM_RATE);
    let zoom = 1;
    while (slide) {
      const step = stepCameraSlide(slide, 16);
      zoom *= step.zoomFactor;
      slide = step.next;
    }
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThan(1);
  });

  it('comes to rest', () => {
    let slide = beginCameraSlide({ x: 2, y: 0 }, SLIDE_MAX_ZOOM_RATE);
    let frames = 0;
    while (slide && frames < 10_000) {
      slide = stepCameraSlide(slide, 16).next;
      frames++;
    }
    expect(slide).toBe(null);
    expect(frames).toBeLessThan(200);
  });
});
