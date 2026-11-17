import { memo, useEffect, useMemo } from 'react';
import type { DrawPoint } from '@whiteboard/shared';
import { usePresenceStore } from '@/collab/use-presence-store';
import { cameraToTransform } from './camera';
import { useCameraFollow } from './use-camera-interaction';
import { getInkPathData } from './shapes/ink';
import { useCameraStore } from './use-camera-store';
import { useDocumentStore } from './use-document-store';
import {
  type EraserScribble,
  useEraserTrailStore,
} from './use-eraser-trail-store';

/** Ribbon length, in screen pixels, at which it reaches full width. */
const FULL_WIDTH_LENGTH = 72;
/** Width of the resting contact patch, as a fraction of full. */
const REST_WIDTH = 0.5;

function circlePath(x: number, y: number, radius: number): string {
  return [
    `M ${x - radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x + radius} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${x - radius} ${y}`,
    'Z',
  ].join(' ');
}

/**
 * Round the polyline's corners so sparse input stays a curve. Corner cutting
 * rather than a spline: it cannot overshoot, which a back-and-forth rub would
 * otherwise throw past the end of every stroke.
 */
function smoothed(points: DrawPoint[]): DrawPoint[] {
  const mix = (a: DrawPoint, b: DrawPoint, t: number): DrawPoint => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: (a.pressure ?? 0.5) * (1 - t) + (b.pressure ?? 0.5) * t,
  });
  let out = points;
  for (let round = 0; round < 2; round++) {
    const next = [out[0]!];
    for (let i = 0; i + 1 < out.length; i++) {
      next.push(mix(out[i]!, out[i + 1]!, 0.25), mix(out[i]!, out[i + 1]!, 0.75));
    }
    next.push(out[out.length - 1]!);
    out = next;
  }
  return out;
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
    const { points } = scribble;
    const last = points[points.length - 1];
    if (!last) return '';
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.hypot(
        points[i]!.x - points[i - 1]!.x,
        points[i]!.y - points[i - 1]!.y,
      );
    }
    const scale = Math.max(zoom, 0.05);
    // Width follows length, so the ribbon swells out of the contact patch as
    // the hand picks up speed and settles back into it, with nothing to pop.
    const reach = Math.min(1, (length * scale) / FULL_WIDTH_LENGTH);
    const size =
      (scribble.size * (REST_WIDTH + (1 - REST_WIDTH) * reach * (2 - reach))) /
      scale;
    if (points.length < 2) return circlePath(last.x, last.y, size / 2);
    return getInkPathData(smoothed(points), size, true, {
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
      // No lag filter: the head stays under the eraser, not chasing it.
      streamline: 0,
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
 * Local eraser feedback plus collaborators' relayed scribbles.
 *
 * The local trail is a muted ribbon thin enough to see the ink through it, since
 * that ink is what the hand is aiming at. Peers use the same geometry in their
 * identity color at low alpha, making intent visible without pretending
 * the remote client's local pending-delete set is shared document state.
 */
export function EraserTrail() {
  // One follower per `<svg>`: the two sit at different z-indices.
  const [camera, followLocal] = useCameraFollow<SVGGElement>();
  const [, followRemote] = useCameraFollow<SVGGElement>();
  const transform = cameraToTransform(camera);
  const localScribbles = useEraserTrailStore((s) => s.scribbles);
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  const running = localScribbles.length > 0;
  useEffect(() => {
    if (!running) return;
    let raf = requestAnimationFrame(function loop(now) {
      useEraserTrailStore
        .getState()
        .tick(now, useCameraStore.getState().camera.z);
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
          <g ref={followLocal}>
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
          </g>
        </svg>
      )}
      {remote.length > 0 && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[var(--z-canvas-collaborator)] h-full w-full"
        >
          <g ref={followRemote}>
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
          </g>
        </svg>
      )}
    </>
  );
}
