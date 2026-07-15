import { Wand2 } from 'lucide-react';
import type { Point } from '@whiteboard/shared';
import { setLocalLaser } from '@/collab/presence';
import type { Tool, ToolPointerInfo } from './types';

export const LASER_FADE_MS = 700;

const MAX_POINTS = 48;
const MIN_SAMPLE_DISTANCE_PX = 2;

/**
 * Press-and-drag presentation pointer. Its short trail is awareness-only, so it
 * is visible to collaborators without creating shapes or touching undo history.
 */
export function createLaserTool(): Tool {
  let active = false;
  let points: Point[] = [];
  let lastScreenPoint: Point | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const cancelClear = () => {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
  };

  const append = (info: ToolPointerInfo) => {
    if (lastScreenPoint) {
      const distance = Math.hypot(
        info.screenPoint.x - lastScreenPoint.x,
        info.screenPoint.y - lastScreenPoint.y,
      );
      if (distance < MIN_SAMPLE_DISTANCE_PX) return;
    }
    lastScreenPoint = info.screenPoint;
    points.push(info.point);
    if (points.length > MAX_POINTS) points = points.slice(-MAX_POINTS);
  };

  const publish = (isActive: boolean) => {
    setLocalLaser({
      points: points.slice(),
      active: isActive,
      expiresAt: isActive ? null : Date.now() + LASER_FADE_MS,
    });
  };

  const finish = (info?: ToolPointerInfo) => {
    if (!active) return;
    if (info) append(info);
    active = false;
    publish(false);

    const finishedGeneration = generation;
    cancelClear();
    clearTimer = setTimeout(() => {
      if (active || generation !== finishedGeneration) return;
      points = [];
      lastScreenPoint = null;
      clearTimer = null;
      setLocalLaser(null);
    }, LASER_FADE_MS);
  };

  return {
    id: 'laser',
    label: 'Laser pointer',
    hotkey: 'k',
    cursor: 'crosshair',
    icon: Wand2,

    onPointerDown(info: ToolPointerInfo) {
      if (info.button !== 0) return;
      generation += 1;
      cancelClear();
      active = true;
      points = [info.point];
      lastScreenPoint = info.screenPoint;
      publish(true);
    },

    onPointerMove(info: ToolPointerInfo) {
      if (!active) return;
      const previousLength = points.length;
      append(info);
      if (points.length !== previousLength || points.length === MAX_POINTS) {
        publish(true);
      }
    },

    onPointerUp(info: ToolPointerInfo) {
      finish(info);
    },

    onCommit() {
      finish();
    },

    onCancel() {
      finish();
    },

    onExit() {
      finish();
    },
  };
}
