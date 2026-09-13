import { memo, useEffect, useMemo, useRef } from 'react';
import { usePresenceStore } from '@/collab/use-presence-store';
import { type Camera } from './camera';
import { useCameraTransform } from './use-camera-interaction';
import { getInkPathData } from './shapes/ink';
import { useDocumentStore } from './use-document-store';
import {
  type EraserScribble,
  useEraserTrailStore,
} from './use-eraser-trail-store';

function circlePath(x: number, y: number, radius: number): string {
  return [
    `M ${x - radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x + radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x - radius} ${y}`,
    'Z',
  ].join(' ');
}

/** One cached procedural ribbon, shared by local and collaborator overlays. */
export const EraserScribblePath = memo(function EraserScribblePath({
  scribble,
  zoom,
  color,
  opacity,
}: {
  scribble: EraserScribble;
  zoom: number;
  color: string;
  opacity: number;
}) {
  const d = useMemo(() => {
    const last = scribble.points[scribble.points.length - 1];
    if (!last) return '';
    const size = scribble.size / Math.max(zoom, 0.05);
    // The full outline needs a few samples to infer tangents. Until then, the
    // visible tip is a circle with the same physical diameter.
    if (scribble.points.length < 4) {
      return circlePath(last.x, last.y, size / 2);
    }
    return getInkPathData(scribble.points, size, scribble.state !== 'active', {
      // The trail is a wedge, not a leaf: it tapers from a point at the tail to
      // full width at the pointer, where a round cap closes it. Tapering the
      // end too pinched the head back to a point, so the ribbon read as a
      // symmetric sliver instead of a stroke being dragged. The reference
      // outline is what supplies that cap: it carries the turn around the
      // endpoint far enough to stay covered when the ribbon curls back.
      inkAlgorithm: 'reference',
      simulatePressure: false,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.32,
      startTaper: scribble.taper,
      linearStartTaper: true,
      endTaper: false,
      pressureEasing: 'linear',
    });
  }, [scribble, zoom]);

  if (!d) return null;
  return <path d={d} fill={color} opacity={opacity} />;
});

/**
 * Local eraser feedback plus collaborators' awareness-only scribbles.
 *
 * The local trail is the stronger muted ribbon. Peers use the same geometry in
 * their identity color at low alpha, making intent visible without pretending
 * the remote client's local pending-delete set is shared document state.
 */
export function EraserTrail({ camera }: { camera: Camera }) {
  const transform = useCameraTransform(camera);
  const localScribbles = useEraserTrailStore((s) => s.scribbles);
  const seq = useEraserTrailStore((s) => s.seq);
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const lastSeq = useRef(seq);

  const running = localScribbles.length > 0;
  useEffect(() => {
    if (!running) return;
    let raf = requestAnimationFrame(function loop() {
      const store = useEraserTrailStore.getState();
      const pointerIdle = store.seq === lastSeq.current;
      store.tick(pointerIdle);
      lastSeq.current = store.seq;
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const remote = peers.flatMap((peer) =>
    peer.scribbles && (!peer.page || peer.page === currentPageId)
      ? peer.scribbles.map((scribble) => ({
          key: `${peer.clientId}:${scribble.id}`,
          color: peer.color,
          scribble,
        }))
      : [],
  );

  if (!running && remote.length === 0) return null;

  return (
    <>
      {running && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full"
        >
          <g transform={transform}>
            {localScribbles.map((scribble) => (
              <EraserScribblePath
                key={scribble.id}
                scribble={scribble}
                zoom={camera.z}
                color="var(--color-muted-foreground)"
                opacity={scribble.opacity}
              />
            ))}
          </g>
        </svg>
      )}
      {remote.length > 0 && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[var(--z-canvas-collaborator)] h-full w-full"
        >
          <g transform={transform}>
            {remote.map(({ key, color, scribble }) => (
              <EraserScribblePath
                key={key}
                scribble={scribble}
                zoom={camera.z}
                color={color}
                opacity={0.1}
              />
            ))}
          </g>
        </svg>
      )}
    </>
  );
}
