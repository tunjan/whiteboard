import { describe, expect, it } from 'vitest';
import {
  SLIDE_FRICTION,
  SLIDE_MAX_STEP_MS,
  SLIDE_REFERENCE_FRAME_MS,
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
    const { dx, dy } = stepCameraSlide(slide, SLIDE_REFERENCE_FRAME_MS);
    // Just under the full 16.67px the opening speed would cover, because the
    // speed is already falling within the step.
    expect(dx).toBeGreaterThan(15.5);
    expect(dx).toBeLessThan(SLIDE_REFERENCE_FRAME_MS);
    expect(dy).toBe(0);
  });

  it('sheds the friction per reference frame of elapsed time, not per call', () => {
    const start = beginCameraSlide({ x: 1, y: 0 })!;
    expect(
      stepCameraSlide(start, SLIDE_REFERENCE_FRAME_MS).next!.speed,
    ).toBeCloseTo(start.speed * (1 - SLIDE_FRICTION));
    // Half the elapsed time sheds half the friction (in log terms), so two
    // 120Hz frames land exactly where one 60Hz frame does.
    expect(
      stepCameraSlide(start, SLIDE_REFERENCE_FRAME_MS / 2).next!.speed,
    ).toBeCloseTo(start.speed * Math.sqrt(1 - SLIDE_FRICTION));
  });

  it('splits a step without changing where it lands', () => {
    const slide = beginCameraSlide({ x: 1, y: 0 }, 0.004)!;
    const whole = stepCameraSlide(slide, 20);
    const first = stepCameraSlide(slide, 10);
    const second = stepCameraSlide(first.next!, 10);
    expect(first.dx + second.dx).toBeCloseTo(whole.dx);
    expect(first.zoomFactor * second.zoomFactor).toBeCloseTo(whole.zoomFactor);
    expect(second.next!.speed).toBeCloseTo(whole.next!.speed);
    expect(second.next!.zoomRate).toBeCloseTo(whole.next!.zoomRate);
  });

  it('covers the same ground in the same time at any refresh rate', () => {
    const coast = (hz: number) => {
      let slide = beginCameraSlide({ x: 1.5, y: 0 });
      let distance = 0;
      let elapsed = 0;
      while (slide && elapsed < 10_000) {
        const step = stepCameraSlide(slide, 1000 / hz);
        distance += step.dx;
        elapsed += 1000 / hz;
        slide = step.next;
      }
      return { distance, elapsed };
    };
    const baseline = coast(60);
    for (const hz of [90, 120, 144, 240]) {
      const run = coast(hz);
      expect(run.distance).toBeCloseTo(baseline.distance, 1);
      // Within a frame of the baseline: a coast can only come to rest on a
      // frame boundary, so the last step's width is the remaining slack.
      expect(Math.abs(run.elapsed - baseline.elapsed)).toBeLessThan(
        SLIDE_REFERENCE_FRAME_MS,
      );
    }
  });

  it('clamps a stalled frame so a hitch cannot teleport the camera', () => {
    const slide = beginCameraSlide({ x: 1, y: 0 })!;
    expect(stepCameraSlide(slide, 5_000).dx).toBe(
      stepCameraSlide(slide, SLIDE_MAX_STEP_MS).dx,
    );
  });

  it('scales the zoom exponentially over the elapsed time', () => {
    const slide = beginCameraSlide({ x: 0, y: 0 }, 0.004)!;
    expect(stepCameraSlide(slide, 16).zoomFactor).toBeGreaterThan(1);
    // Twice the elapsed time is more than twice the log-zoom would be if the
    // rate held, but less than it — the rate is decaying through the step.
    expect(stepCameraSlide(slide, 32).zoomFactor).toBeLessThan(
      stepCameraSlide(slide, 16).zoomFactor ** 2 * 1.001,
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
