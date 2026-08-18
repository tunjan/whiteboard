import type { VideoKind } from '@whiteboard/shared';
import type { PeerPresence } from '@/collab/use-presence-store';
import type { SelfView } from '@/collab/voice/use-video-store';

export interface VideoTile {
  /** Stable across renders, and the value the spotlight is keyed on. */
  key: string;
  clientId: number;
  kind: VideoKind;
  name: string;
  color: string;
  isLocal: boolean;
}

export interface GridLayout {
  columns: number;
  rows: number;
}

export interface LocalPublisher {
  clientId: number;
  name: string;
  color: string;
  camera: boolean;
  screen: boolean;
}

export interface PanelPosition {
  x: number;
  y: number;
}

/**
 * Stands in for the local participant, who has no awareness entry of their own.
 * Yjs client ids are always non-negative, so this can never collide.
 */
export const LOCAL_CLIENT_ID = -1;

export function tileKey(clientId: number, kind: VideoKind): string {
  return `${clientId}:${kind}`;
}

/**
 * The grid tiles, in display order.
 *
 * Your own camera is deliberately absent — it is rendered as a thumbnail by
 * `selfCameraTile`, so a one-to-one call gives the whole grid to the other
 * person. Your own *screen* stays in the grid: you need to see what you are
 * sharing.
 *
 * Membership comes from awareness, never from whether a remote track exists:
 * every connection carries both video slots from the moment it is negotiated,
 * so a track is present long before anyone publishes into it.
 */
export function videoTiles(input: {
  local: LocalPublisher;
  peers: PeerPresence[];
}): VideoTile[] {
  const remote: VideoTile[] = [];
  for (const peer of input.peers) {
    if (!peer.voice?.inCall) continue;
    for (const kind of ['screen', 'camera'] as const) {
      if (!peer.voice[kind]) continue;
      remote.push({
        key: tileKey(peer.clientId, kind),
        clientId: peer.clientId,
        kind,
        name: peer.name,
        color: peer.color,
        isLocal: false,
      });
    }
  }

  // Shared screens lead — they are the content everyone is looking at.
  return [
    ...(input.local.screen ? [localTile(input.local, 'screen')] : []),
    ...remote.filter((tile) => tile.kind === 'screen'),
    ...remote.filter((tile) => tile.kind === 'camera'),
  ];
}

/** Your own camera, for the thumbnail. Null when it is off or hidden. */
export function selfCameraTile(
  local: LocalPublisher,
  selfView: SelfView,
): VideoTile | null {
  if (!local.camera || selfView === 'hidden') return null;
  return localTile(local, 'camera');
}

function localTile(local: LocalPublisher, kind: VideoKind): VideoTile {
  return {
    key: tileKey(local.clientId, kind),
    clientId: local.clientId,
    kind,
    name: local.name,
    color: local.color,
    isLocal: true,
  };
}

const TILE_ASPECT = 16 / 9;

/** Column/row split that keeps tiles closest to 16:9 in the given container. */
export function videoGridLayout(
  tileCount: number,
  containerAspect: number,
): GridLayout {
  if (tileCount <= 0) return { columns: 0, rows: 0 };
  const aspect =
    Number.isFinite(containerAspect) && containerAspect > 0
      ? containerAspect
      : TILE_ASPECT;
  const ideal = Math.sqrt((tileCount * aspect) / TILE_ASPECT);
  const columns = Math.min(tileCount, Math.max(1, Math.round(ideal)));
  return { columns, rows: Math.ceil(tileCount / columns) };
}

/** Keep a dragged panel fully inside the viewport. */
export function clampPanelPosition(
  position: PanelPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin: number,
): PanelPosition {
  const clampAxis = (value: number, extent: number, bound: number): number => {
    // A panel taller or wider than the viewport pins to the top/left edge
    // rather than jumping to a negative maximum.
    const max = Math.max(margin, bound - extent - margin);
    return Math.min(max, Math.max(margin, value));
  };
  return {
    x: clampAxis(position.x, size.width, viewport.width),
    y: clampAxis(position.y, size.height, viewport.height),
  };
}

/**
 * Split tiles into the spotlit one and the rest. A key that no longer matches a
 * live tile — the peer left, or stopped sharing — falls back to the plain grid
 * instead of blanking the panel.
 */
export function spotlightOrder(
  tiles: VideoTile[],
  spotlightKey: string | null,
): { hero: VideoTile | null; filmstrip: VideoTile[] } {
  const hero = spotlightKey
    ? (tiles.find((tile) => tile.key === spotlightKey) ?? null)
    : null;
  return {
    hero,
    filmstrip: hero ? tiles.filter((tile) => tile.key !== hero.key) : tiles,
  };
}
