import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';

export interface ViewportPresence {
  camera: Camera;
  size: {
    width: number;
    height: number;
  };
}

export interface PeerPresence {
  clientId: number;
  name: string;
  color: string;
  isTutor: boolean;
  /** Cursor position in world coordinates, or null when off-canvas. */
  cursor: Point | null;
  /** Viewport camera and pixel size, or null until the peer publishes it. */
  viewport: ViewportPresence | null;
  /** Transient bring-to-view nonce, or null until the peer sends one. */
  summon: number | null;
  /** Id of the page the peer is currently viewing, or null until published. */
  page: string | null;
}

interface PresenceStore {
  peers: PeerPresence[];
  setPeers: (peers: PeerPresence[]) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  peers: [],
  setPeers: (peers) => set({ peers }),
}));
