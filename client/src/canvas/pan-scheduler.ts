// Coalesces a drag's pan deltas, and a pinch's moves, into one camera write
// per frame.

import type { Point } from './camera';
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

/**
 * The two-finger pinch's counterpart to {@link PanScheduler}. Each finger
 * reports on its own, so a 120Hz touchscreen lands up to four camera writes a
 * frame — each one a full camera publish for a board that is only presented
 * once.
 *
 * The zoom is absolute (derived from finger separation) and the pan relative
 * (the midpoint's travel since the previous move), so the frame keeps the
 * latest anchor and zoom and sums the pan. That one write lands exactly where
 * the sequence would have: in `zoomCameraAtScreenWithPan` each intermediate
 * anchor cancels against the next move's pan, provided the pan *is* the
 * midpoint's travel — which holds while `TOUCH_PAN_SPEED` is 1. Zoom limits
 * clamp the same final value either way.
 */
export class PinchScheduler {
  private pending: {
    anchor: Point;
    zoom: number;
    dx: number;
    dy: number;
    time: number;
  } | null = null;
  private frame: number | null = null;

  /** @param onCommit Called after each camera write with the timestamp of the
   *  newest move it applied — the pinch's release-rate tracking reads the
   *  camera the write produced, so it has to run here, not per event. */
  constructor(private readonly onCommit: (time: number) => void) {}

  private readonly run = () => {
    this.frame = null;
    this.commit();
  };

  /** Queue one move: where the midpoint is, the zoom it asks for, and how far
   *  the midpoint travelled since the last move (screen px). */
  push(anchor: Point, zoom: number, dx: number, dy: number, time: number): void {
    const pending = this.pending;
    this.pending = {
      anchor,
      zoom,
      dx: (pending?.dx ?? 0) + dx,
      dy: (pending?.dy ?? 0) + dy,
      time,
    };
    if (this.frame === null) this.frame = requestAnimationFrame(this.run);
  }

  /** Apply whatever is queued now — before anything reads the camera the
   *  pinch has produced, or starts a coast from it (see
   *  {@link PanScheduler.flush}). A no-op with nothing queued. */
  flush(): void {
    this.cancelFrame();
    this.commit();
  }

  /** Drop anything queued without applying it. */
  cancel(): void {
    this.cancelFrame();
    this.pending = null;
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private commit(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    useCameraStore
      .getState()
      .zoomAtScreenWithPan(pending.anchor, pending.zoom, pending.dx, pending.dy);
    this.onCommit(pending.time);
  }
}
