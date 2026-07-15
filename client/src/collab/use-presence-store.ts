import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import type { LaserPresence } from '@/canvas/use-laser-store';

export interface ViewportPresence {
  camera: Camera;
  size: {
    width: number;
    height: number;
  };
}

export interface TextSelectionPresence {
  shapeId: string;
  anchor: number;
  head: number;
}

export interface PeerPresence {
  clientId: number;
  name: string;
  color: string;
  isTutor: boolean;
  /** Seed for this peer's hand-drawn doodle avatar. */
  avatar: string;
  /** Cursor position in world coordinates, or null when off-canvas. */
  cursor: Point | null;
  /** Viewport camera and pixel size, or null until the peer publishes it. */
  viewport: ViewportPresence | null;
  /** Transient bring-to-view nonce, or null until the peer sends one. */
  summon: number | null;
  /** Id of the page the peer is currently viewing, or null until published. */
  page: string | null;
  /** Whether this peer is currently following the tutor's view. */
  following: boolean;
  /** This peer's measured collaboration round-trip latency, in milliseconds. */
  latencyMs: number | null;
  /** Ephemeral caret/selection inside an actively edited text shape. */
  textSelection: TextSelectionPresence | null;
  /** Ephemeral laser trail while this peer is presenting. */
  laser: LaserPresence | null;
}

interface PresenceStore {
  peers: PeerPresence[];
  setPeers: (peers: PeerPresence[]) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  peers: [],
  setPeers: (peers) => set({ peers }),
}));
