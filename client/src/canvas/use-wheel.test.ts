import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA } from './camera';
import {
  cameraFromWheel,
  normalizeWheelDelta,
  wheelPointerProfile,
} from './use-wheel';

describe('normalizeWheelDelta', () => {
  it('passes pixel-mode deltas through unchanged', () => {
    expect(normalizeWheelDelta({ deltaX: -12, deltaY: 40, deltaMode: 0 })).toEqual({
      x: -12,
      y: 40,
    });
  });

  it('scales line-mode deltas to pixels', () => {
    expect(normalizeWheelDelta({ deltaX: 1, deltaY: -3, deltaMode: 1 })).toEqual({
      x: 16,
      y: -48,
    });
  });

  it('scales page-mode deltas to pixels', () => {
    expect(normalizeWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({
      x: 0,
      y: 800,
    });
  });

  it('treats non-finite deltas as no motion', () => {
    expect(
      normalizeWheelDelta({ deltaX: NaN, deltaY: Infinity, deltaMode: 0 }),
    ).toEqual({ x: 0, y: 0 });
  });

  describe('shift + wheel', () => {
    const event = { deltaX: 0, deltaY: 50, deltaMode: 0, shiftKey: true };

    it('scrolls horizontally off macOS, where the wheel has no x axis', () => {
      expect(normalizeWheelDelta(event, false)).toEqual({ x: 50, y: 0 });
    });

    it('leaves macOS alone, which already swapped the axes itself', () => {
      expect(normalizeWheelDelta(event, true)).toEqual({ x: 0, y: 50 });
    });

    it('does not swap when the device already reported horizontal motion', () => {
      expect(
        normalizeWheelDelta(
          { deltaX: -30, deltaY: 5, deltaMode: 0, shiftKey: true },
          false,
        ),
      ).toEqual({ x: -30, y: 5 });
    });
  });
});

describe('wheelPointerProfile', () => {
  it('reads line and page units as a wheel', () => {
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(
      'mouse',
    );
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toBe(
      'mouse',
    );
  });

  it('reads whole notches on one axis as a wheel', () => {
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(
      'mouse',
    );
    expect(wheelPointerProfile({ deltaX: 0, deltaY: -360, deltaMode: 0 })).toBe(
      'mouse',
    );
  });

  it('reads fractional, small, or two-axis deltas as a trackpad', () => {
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 1.5, deltaMode: 0 })).toBe(
      'trackpad',
    );
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 7, deltaMode: 0 })).toBe(
      'trackpad',
    );
    expect(wheelPointerProfile({ deltaX: 3, deltaY: 12, deltaMode: 0 })).toBe(
      'trackpad',
    );
  });

  it('refuses to guess at a large delta that is not a notch', () => {
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 73, deltaMode: 0 })).toBe(
      'unknown',
    );
    expect(wheelPointerProfile({ deltaX: 0, deltaY: 0, deltaMode: 0 })).toBe(
      'unknown',
    );
  });
});

describe('cameraFromWheel inversion', () => {
  const anchor = { x: 0, y: 0 };
  const wheel = { deltaX: 0, deltaY: 120, deltaMode: 0 };
  const trackpad = { deltaX: 0, deltaY: 12, deltaMode: 0 };
  const pan = (event: typeof wheel, invert: boolean) =>
    cameraFromWheel(
      DEFAULT_CAMERA,
      event,
      anchor,
      null,
      undefined,
      false,
      invert,
    ).y;

  it('scrolls the way the device sent it while the preference is off', () => {
    expect(pan(wheel, false)).toBe(120);
    expect(pan(trackpad, false)).toBe(12);
  });

  it('reverses a wheel when the preference is on', () => {
    expect(pan(wheel, true)).toBe(-120);
  });

  it('leaves a trackpad alone, whose inertia already follows the system', () => {
    expect(pan(trackpad, true)).toBe(12);
  });

  it('leaves zooming alone — the preference is about scrolling', () => {
    const zoomed = (invert: boolean) =>
      cameraFromWheel(
        DEFAULT_CAMERA,
        { ...wheel, deltaY: -120, ctrlKey: true },
        anchor,
        null,
        undefined,
        false,
        invert,
      ).z;
    expect(zoomed(true)).toBe(zoomed(false));
    expect(zoomed(true)).toBeGreaterThan(DEFAULT_CAMERA.z);
  });
});
