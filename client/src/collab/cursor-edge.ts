import type { Point } from '@whiteboard/shared';

export interface CursorEdgeIndicator {
  position: Point;
  /** Clockwise degrees; zero points toward the top of the viewport. */
  rotation: number;
}

/**
 * Place an off-screen cursor on the inset viewport edge along the ray from the
 * viewport center to the cursor. Returns null while the cursor is in view.
 */
export function cursorEdgeIndicator(
  cursor: Point,
  viewport: { width: number; height: number },
  inset: number,
): CursorEdgeIndicator | null {
  const { width, height } = viewport;
  if (width <= 0 || height <= 0) return null;
  if (
    cursor.x >= 0 &&
    cursor.x <= width &&
    cursor.y >= 0 &&
    cursor.y <= height
  ) {
    return null;
  }

  const center = { x: width / 2, y: height / 2 };
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const halfWidth = Math.max(0, center.x - Math.min(inset, center.x));
  const halfHeight = Math.max(0, center.y - Math.min(inset, center.y));
  const xScale = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const yScale = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(xScale, yScale);

  return {
    position: {
      x: center.x + dx * scale,
      y: center.y + dy * scale,
    },
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI + 90,
  };
}
