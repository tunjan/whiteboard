import { useEffect, useRef } from 'react';
import type { Point } from '@whiteboard/shared';
import { cameraToTransform, type Camera } from './camera';
import { ERASER_SCREEN_RADIUS } from './tools/eraser-tool';
import { useEraserTrailStore } from './use-eraser-trail-store';

/** Midpoint-quadratic smoothing, so a sparse trail still reads as a curve. */
function pathFor(points: readonly Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first.x} ${first.y} L ${first.x} ${first.y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const next = points[i + 1]!;
    d += ` Q ${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * The eraser's swipe trail (see {@link useEraserTrailStore}).
 *
 * The tail is eaten here rather than in the tool because it is time that drives
 * it, not input: a stroke held still still shortens. One point per frame is
 * consumed whenever the pointer did not move since the last frame, and
 * unconditionally once the pointer has lifted, which drains the ribbon in about
 * eight frames.
 */
export function EraserTrail({ camera }: { camera: Camera }) {
  const points = useEraserTrailStore((s) => s.points);
  const active = useEraserTrailStore((s) => s.active);
  const seq = useEraserTrailStore((s) => s.seq);
  const lastSeq = useRef(seq);

  const running = points.length > 0;
  useEffect(() => {
    if (!running) return;
    let raf = requestAnimationFrame(function loop() {
      const store = useEraserTrailStore.getState();
      if (!store.active || store.seq === lastSeq.current) store.consume();
      lastSeq.current = store.seq;
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [running]);

  if (!running) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full"
    >
      <g transform={cameraToTransform(camera)}>
        <path
          d={pathFor(points)}
          fill="none"
          stroke="currentColor"
          // Matches the collision ring's diameter, so the trail covers the
          // ground the eraser actually swept rather than a line through it.
          strokeWidth={ERASER_SCREEN_RADIUS * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground"
          // Faint: it marks what was just erased, and must not be mistaken for
          // ink that survived. Fades out as the ribbon drains after a lift.
          opacity={active ? 0.22 : 0.22 * (points.length / 8)}
        />
      </g>
    </svg>
  );
}
