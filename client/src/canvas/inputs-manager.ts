import type { Point } from '@whiteboard/shared';

const REFERENCE_FRAME_MS = 16;
const BASE_SMOOTHING = 0.5;
const STOP_SPEED = 0.01;

/** Pressure/pointer evidence that distinguishes a stylus from a plain pointer. */
export function isPenOrStylus(pointerType: string, pressure: number): boolean {
  return (
    (pointerType === 'pen' && Number.isFinite(pressure) && pressure > 0) ||
    (Number.isFinite(pressure) &&
      pressure > 0 &&
      pressure < 1 &&
      Math.abs(pressure - 0.5) > 1e-6)
  );
}

/**
 * Frame-rate-independent pointer velocity filter, in screen px/ms.
 *
 * The base weight is quoted at a 16 ms reference frame and re-expressed for
 * each actual sample interval, so identical motion converges by the same amount
 * over the same elapsed time at 60, 120, or 240 Hz.
 */
export class InputsManager {
  private previous: Point | null = null;
  private previousTime = 0;
  private readonly filtered = { x: 0, y: 0 };

  reset(point?: Point, timestamp = 0): void {
    this.previous = point ? { ...point } : null;
    this.previousTime = timestamp;
    this.filtered.x = 0;
    this.filtered.y = 0;
  }

  update(point: Point, timestamp: number): Point {
    const previous = this.previous;
    const elapsed = timestamp - this.previousTime;
    this.previous = { ...point };
    this.previousTime = timestamp;
    if (!previous || !(elapsed > 0)) return { ...this.filtered };

    const deltaX = point.x - previous.x;
    const deltaY = point.y - previous.y;
    const moved = deltaX !== 0 || deltaY !== 0;
    const targetX = moved ? deltaX / elapsed : 0;
    const targetY = moved ? deltaY / elapsed : 0;
    const alpha = 1 - (1 - BASE_SMOOTHING) ** (elapsed / REFERENCE_FRAME_MS);
    this.filtered.x += (targetX - this.filtered.x) * alpha;
    this.filtered.y += (targetY - this.filtered.y) * alpha;

    // Apply the deadband per axis. A small x drift should not survive merely
    // because the pointer is still moving meaningfully along y (and vice
    // versa); each channel is an independent velocity estimate.
    if (Math.abs(this.filtered.x) < STOP_SPEED) this.filtered.x = 0;
    if (Math.abs(this.filtered.y) < STOP_SPEED) this.filtered.y = 0;
    return { ...this.filtered };
  }

  get velocity(): Point {
    return { ...this.filtered };
  }
}
