import type { Shape } from '@whiteboard/shared';
import { cameraToTransform } from '@/canvas/camera';
import { useCameraFollow } from '@/canvas/use-camera-interaction';
import { getSelectionInfo } from '@/canvas/selection-geometry';
import { useDocumentStore } from '@/canvas/use-document-store';
import { useShapesById } from '@/canvas/use-shapes';
import { usePresenceStore } from '@/collab/use-presence-store';

/** Stable empty array: getSelectionInfo only reads it for group selections. */
const NO_SHAPES: Shape[] = [];

/**
 * Outlines of what each peer has selected, drawn in world space so the boxes
 * track their shapes while a peer drags them. Individual shapes get an oriented
 * dashed outline; a multi-shape selection adds the union box around them.
 */
export function PeerSelectionLayer() {
  const [camera, follow] = useCameraFollow<SVGGElement>();
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  // Only the shapes peers actually have selected — usually a handful.
  // Extracting them by id keeps this layer off the per-mutation path.
  const shapes = useShapesById(
    peers.flatMap((peer) =>
      peer.page && peer.page !== currentPageId ? [] : (peer.selection ?? []),
    ),
  );

  const getShape = (id: string) => shapes[id];
  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full">
      <g ref={follow}>
        <g transform={cameraToTransform(camera)}>
          {peers.map((peer) => {
            if (peer.page && peer.page !== currentPageId) return null;
            const ids = (peer.selection ?? []).filter((id) => shapes[id]);
            if (ids.length === 0) return null;
            const union =
              ids.length > 1
                ? getSelectionInfo(NO_SHAPES, ids, camera.z, getShape)
                : null;
            return (
              <g key={peer.clientId} stroke={peer.color} fill="none">
                {ids.map((id) => {
                  const info = getSelectionInfo(
                    NO_SHAPES,
                    [id],
                    camera.z,
                    getShape,
                  );
                  if (!info) return null;
                  const { nw, ne, se, sw } = info.corners;
                  return (
                    <polygon
                      key={id}
                      points={[nw, ne, se, sw]
                        .map((p) => `${p.x},${p.y}`)
                        .join(' ')}
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {union ? (
                  <rect
                    x={union.bounds.minX}
                    y={union.bounds.minY}
                    width={union.bounds.maxX - union.bounds.minX}
                    height={union.bounds.maxY - union.bounds.minY}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
