import { useEffect, useState } from 'react';
import type { Point } from '@whiteboard/shared';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { LASER_FADE_MS } from './tools/laser-tool';
import { useDocumentStore } from './use-document-store';
import { type LaserPresence, useLaserStore } from './use-laser-store';
import { usePresenceStore } from '@/collab/use-presence-store';

/** Convert pointer samples into a Catmull-Rom-style cubic path. */
function smoothPath(points: Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let path = `M ${first.x} ${first.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const following = points[index + 2] ?? next;
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6,
    };
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function LaserTrail({ laser, camera }: { laser: LaserPresence; camera: Camera }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (laser.active || laser.expiresAt === null) return;
    let frame = 0;
    const tick = () => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow < laser.expiresAt!) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [laser.active, laser.expiresAt]);

  const fade = laser.active
    ? 1
    : laser.expiresAt === null
      ? 0
      : Math.max(0, Math.min(1, (laser.expiresAt - now) / LASER_FADE_MS));
  if (fade <= 0 || laser.points.length === 0) return null;

  const points = laser.points.map((point) => worldToScreen(point, camera));
  const tip = points[points.length - 1]!;
  const trace = smoothPath(points);

  return (
    <g aria-hidden="true">
      <path
        d={trace}
        fill="none"
        stroke="var(--laser)"
        strokeWidth={10}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.14 * fade}
      />
      <path
        d={trace}
        fill="none"
        stroke="var(--laser)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.88 * fade}
      />
      <circle cx={tip.x} cy={tip.y} r={9} fill="var(--laser)" opacity={0.16 * fade} />
      <circle cx={tip.x} cy={tip.y} r={4} fill="var(--laser)" opacity={fade} />
      <circle cx={tip.x} cy={tip.y} r={1.5} fill="white" opacity={0.9 * fade} />
    </g>
  );
}

/** Local and collaborative laser trails, rendered above board content. */
export function LaserLayer({ camera }: { camera: Camera }) {
  const localLaser = useLaserStore((s) => s.laser);
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 size-full overflow-hidden">
      {localLaser && <LaserTrail laser={localLaser} camera={camera} />}
      {peers.map((peer) =>
        peer.laser && (!peer.page || peer.page === currentPageId) ? (
          <LaserTrail key={peer.clientId} laser={peer.laser} camera={camera} />
        ) : null,
      )}
    </svg>
  );
}
