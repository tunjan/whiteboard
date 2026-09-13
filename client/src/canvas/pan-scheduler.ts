// Coalesces a drag's screen-space pan deltas into one camera write per frame.

import { useCameraStore } from './use-camera-store';

/**
 * A pointer drag delivers moves at the hardware's report rate, not the
 * display's: a 120Hz trackpad lands about two per frame and a high-rate mouse
 * eight or more. Every `panByScreen` publishes a new camera, and the camera is
 * a prop on a dozen React overlays, so each of those moves paid a full render
 * to place the board somewhere it was never shown — only the last one of the
 * frame is ever presented.
 *
 * Measured at a p99 page (2,800 shapes) with React's commit included, the cost
 * is linear in *events*, not frames: 1.1ms median for one move per frame, 2.5
 * for two, 4.9 for four, 10.3 for eight (p95 21.2ms — a dropped frame). Which
 * is why the stutter only showed up on some hardware.
 *
 * So deltas accumulate here and apply once per animation frame. Pan is a
 * relative operation, so summing is exact — the camera lands in precisely the
 * same place, just once instead of eight times. This is the same shape as the
 * pending-camera coalescing `useWheel` already does for trackpad scroll.
 */
export class PanScheduler {
  private dx = 0;
  private dy = 0;
  private frame: number | null = null;

  private readonly run = () => {
    this.frame = null;
    this.commit();
  };

  /** Queue a screen-pixel delta, to be applied on the next frame. */
  push(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
    if (this.frame === null) this.frame = requestAnimationFrame(this.run);
  }

  /**
   * Apply whatever is queued now.
   *
   * A drag must flush before it reads its release velocity and hands it to
   * `slideCamera`: a coast that started from a camera still holding an
   * unapplied frame of motion would begin behind where the finger left it, and
   * `panByScreen` cancels running camera animations, so a flush landing *after*
   * the coast began would kill it on its first frame.
   */
  flush(): void {
    this.cancelFrame();
    this.commit();
  }

  /** Drop anything queued without applying it. */
  cancel(): void {
    this.cancelFrame();
    this.dx = 0;
    this.dy = 0;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private commit(): void {
    const { dx, dy } = this;
    if (dx === 0 && dy === 0) return;
    this.dx = 0;
    this.dy = 0;
    useCameraStore.getState().panByScreen(dx, dy);
  }
}
