import { genId, type Point } from '@whiteboard/shared';
import { useLaserStore } from '../use-laser-store';
import { LaserGlyph } from '@/components/ui/glyphs';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Laser pointer for presenting: draws an ephemeral stroke that fades out
 * shortly after the pointer lifts. Strokes never touch the document — they
 * live in the laser store and reach collaborators via awareness presence.
 */
export function createLaserTool(): Tool {
  let id: string | null = null;
  let lastPoint: Point | null = null;

  return {
    id: 'laser',
    label: 'Laser',
    hotkey: 'k',
    cursor: 'crosshair',
    icon: LaserGlyph,
    // Accumulates a polyline; the distance gate below already bounds how many
    // of these samples become points.
    wantsCoalescedSamples: true,

    onPointerDown(info: ToolPointerInfo) {
      if (info.button !== 0) return;
      id = genId();
      lastPoint = info.point;
      useLaserStore.getState().begin(id, info.point);
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!id || !lastPoint) return;
      // Keep sample density at roughly one point per screen pixel, independent
      // of zoom, so awareness payloads stay small.
      const minDistance = 1 / Math.max(info.zoom, 0.05);
      if (
        Math.hypot(info.point.x - lastPoint.x, info.point.y - lastPoint.y) <
        minDistance
      ) {
        return;
      }
      lastPoint = info.point;
      useLaserStore.getState().extend(id, info.point);
    },

    onPointerUp() {
      if (!id) return;
      useLaserStore.getState().end();
      id = null;
      lastPoint = null;
      // Stay in the laser tool so the presenter can keep pointing.
    },

    // The OS reclaimed the pointer mid-stroke: keep what's drawn, let it fade.
    onCommit() {
      if (!id) return;
      useLaserStore.getState().end();
      id = null;
      lastPoint = null;
    },

    // A pinch (or tool switch) mid-stroke drops the partial stroke immediately.
    onCancel() {
      if (!id) return;
      useLaserStore.getState().discard(id);
      id = null;
      lastPoint = null;
      // The gesture is over either way, so arm the hold that pointer-up would
      // have: strokes drawn before this one are still held and need to fade.
      useLaserStore.getState().end();
    },
  };
}
