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

// A fixed, saturated red rather than the theme's destructive token: the laser
// should read as a bright physical pointer in both light and dark mode, not
// shift with the theme (light mode's destructive red is too muted/dark).
const LASER_COLOR = '#FF3B30';
const LASER_CORE_COLOR = '#FFFFFF';

// Neon bloom: stacked translucent strokes fake a gaussian falloff. A real
// feGaussianBlur would blur in user space — scaling with zoom, unlike the
// non-scaling strokes it wraps — and is skipped outright when a straight
// stroke gives the path a zero-height bounding box.
const GLOW_LAYERS = [
  { width: 28, opacity: 0.05 },
  { width: 21, opacity: 0.07 },
  { width: 15, opacity: 0.1 },
  { width: 11, opacity: 0.16 },
];
const LASER_BODY_WIDTH = 7;
const LASER_CORE_WIDTH = 2.5;

// The tip of the laser stroke shines as a concentrated laser spot.
const TIP_BLOOM_LAYERS = [
  { r: 12, opacity: 0.12 },
  { r: 6, opacity: 0.25 },
];
const TIP_BODY_RADIUS = 3.5;
const TIP_CORE_RADIUS = 1.25;

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

  // First-seen "done" timestamps, pruned once strokes disappear.
  const fadeStart = useRef(new Map<string, number>());
  // The clock the fade is measured against, advanced by the rAF loop below.
  const [now, setNow] = useState(() => performance.now());

  // Stamp newly-finished strokes and drop vanished ones. This has to happen in
  // an effect rather than the render body: React can start a render and discard
  // it, and a discarded render must not be able to set a fade's origin (which
  // would make the stroke fade from a moment that never displayed) or clear one
  // the committed tree still needs (restarting a fade that was underway).
  useEffect(() => {
    const seen = performance.now();
    const live = new Set<string>();
    for (const stroke of strokes) {
      live.add(stroke.id);
      if (stroke.done && !fadeStart.current.has(stroke.id)) {
        fadeStart.current.set(stroke.id, seen);
      }
    }
    for (const strokeId of fadeStart.current.keys()) {
      if (!live.has(strokeId)) fadeStart.current.delete(strokeId);
    }
  });

  // Re-render each frame while any stroke is fading so opacity animates.
  const hasFading = strokes.some((s) => s.done);
  useEffect(() => {
    if (!hasFading) return;
    let raf = requestAnimationFrame(function loop() {
      setNow(performance.now());
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasFading]);

  if (strokes.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full">
      <g transform={cameraToTransform(camera)}>
        {strokes.map((stroke) => {
          let opacity = 1;
          if (stroke.done) {
            // The hold happens upstream — the store only marks a stroke done
            // once drawing has been idle for LASER_HOLD_MS — so a done stroke
            // fades from the moment it is first seen here. Not yet stamped =
            // first render since it finished: full opacity, as if stamped now.
            const start = fadeStart.current.get(stroke.id);
            opacity = start === undefined ? 1 : 1 - (now - start) / LASER_FADE_MS;
            if (opacity <= 0) return null;
          }
          const d = pathFor(stroke.points);
          const tip = stroke.points[stroke.points.length - 1];
          return (
            <g
              key={stroke.id}
              opacity={opacity}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              stroke={LASER_COLOR}
            >
              {GLOW_LAYERS.map((layer) => (
                <path
                  key={layer.width}
                  d={d}
                  strokeWidth={layer.width}
                  strokeOpacity={layer.opacity}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path
                d={d}
                strokeWidth={LASER_BODY_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={d}
                stroke={LASER_CORE_COLOR}
                strokeWidth={LASER_CORE_WIDTH}
                vectorEffect="non-scaling-stroke"
              />
              {tip && (
                <g
                  transform={`translate(${tip.x}, ${tip.y}) scale(${1 / camera.z})`}
                  stroke="none"
                >
                  {TIP_BLOOM_LAYERS.map((layer) => (
                    <circle
                      key={layer.r}
                      r={layer.r}
                      fill={LASER_COLOR}
                      opacity={layer.opacity}
                    />
                  ))}
                  <circle
                    r={TIP_BODY_RADIUS}
                    fill={LASER_COLOR}
                    opacity={0.9}
                  />
                  <circle
                    r={TIP_CORE_RADIUS}
                    fill={LASER_CORE_COLOR}
                    opacity={1}
                  />
                </g>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
