import { useEffect, useRef, useState } from 'react';
import type { Point } from '@whiteboard/shared';
import { usePresenceStore } from '@/collab/use-presence-store';
import { cameraToTransform, type Camera } from './camera';
import { useDocumentStore } from './use-document-store';
import {
  LASER_FADE_MS,
  useLaserStore,
  type LaserStroke,
} from './use-laser-store';

const LASER_COLOR = '#ff2d55';

function pathFor(points: Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) {
    // A zero-length segment with round linecaps renders as a dot.
    return `M ${first.x} ${first.y} L ${first.x} ${first.y}`;
  }
  // Midpoint-quadratic smoothing: each sample becomes a control point and the
  // curve passes through segment midpoints, rounding off raw pointer jitter.
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
 * Ephemeral laser-pointer strokes: the local user's from the laser store plus
 * peers' from awareness. Each side times the fade from when it first sees a
 * stroke marked done, so sender and peers animate it without a shared clock.
 */
export function LaserLayer({ camera }: { camera: Camera }) {
  const localStrokes = useLaserStore((s) => s.strokes);
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  const strokes: LaserStroke[] = [
    ...localStrokes,
    ...peers.flatMap((p) =>
      p.laser && (!p.page || p.page === currentPageId) ? p.laser : [],
    ),
  ];

  // Re-render each frame while any stroke is fading so opacity animates.
  const hasFading = strokes.some((s) => s.done);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasFading) return;
    let raf = requestAnimationFrame(function loop() {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasFading]);

  // First-seen "done" timestamps, pruned once strokes disappear.
  const fadeStart = useRef(new Map<string, number>());
  const liveIds = new Set(strokes.map((s) => s.id));
  for (const strokeId of fadeStart.current.keys()) {
    if (!liveIds.has(strokeId)) fadeStart.current.delete(strokeId);
  }

  if (strokes.length === 0) return null;

  const now = performance.now();
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      <g transform={cameraToTransform(camera)}>
        {strokes.map((stroke) => {
          let opacity = 1;
          if (stroke.done) {
            let start = fadeStart.current.get(stroke.id);
            if (start === undefined) {
              start = now;
              fadeStart.current.set(stroke.id, start);
            }
            opacity = 1 - (now - start) / LASER_FADE_MS;
            if (opacity <= 0) return null;
          }
          const d = pathFor(stroke.points);
          return (
            <g key={stroke.id} opacity={opacity}>
              <path
                d={d}
                fill="none"
                stroke={LASER_COLOR}
                strokeWidth={9}
                strokeOpacity={0.35}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={d}
                fill="none"
                stroke={LASER_COLOR}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
