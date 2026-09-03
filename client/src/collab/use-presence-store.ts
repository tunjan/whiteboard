import { create } from 'zustand';
import type { Point, VoicePresence } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import type { EraserScribble } from '@/canvas/use-eraser-trail-store';
import type { LaserStroke } from '@/canvas/use-laser-store';
import type { AttentionPresence } from './attention-state';

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

export type { VoicePresence } from '@whiteboard/shared';
export type { AttentionPresence } from './attention-state';

export interface PeerPresence {
  clientId: number;
  name: string;
  color: string;
  isTutor: boolean;
  /** Cursor position in world coordinates, or null when off-canvas. */
  cursor: Point | null;
  /** Cursor glyph requested by the peer's active tool. */
  cursorType: 'pointer' | 'cross';
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
  /** Ids of the shapes this peer has selected, or null when nothing is. */
  selection: string[] | null;
  /** Awareness-only eraser trails. Pending deletion ids stay local to the peer. */
  scribbles: EraserScribble[] | null;
  /** In-progress laser-pointer strokes, or null when the peer has none. */
  laser: LaserStroke[] | null;
  /** This peer's current in-board voice membership and mute state. */
  voice: VoicePresence | null;
  /**
   * Raw attention facts — an input counter and whether this peer's tab is
   * frontmost — or null from a peer that has not published any yet. Deliberately
   * carries no durations: the reader times the changes on its own clock (see
   * `attention-state.ts`).
   */
  attention: AttentionPresence | null;
}

interface PresenceStore {
  peers: PeerPresence[];
  setPeers: (peers: PeerPresence[]) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  peers: [],
  setPeers: (peers) => set({ peers }),
}));
