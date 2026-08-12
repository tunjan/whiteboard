import type { RotationHandleId } from './selection-geometry';

const ROTATION_CURSOR_ANGLE: Record<RotationHandleId, number> = {
  'rotate-nw': 0,
  'rotate-ne': 90,
  'rotate-se': 180,
  'rotate-sw': 270,
};

const rotationCursorCache = new Map<number, string>();

/** A corner-oriented curved arrow, outlined so it stays legible on any canvas. */
export function rotationCursor(
  id: RotationHandleId,
  selectionRotation: number,
): string {
  const rawAngle =
    ROTATION_CURSOR_ANGLE[id] + (selectionRotation * 180) / Math.PI;
  const angle = ((Math.round(rawAngle / 15) * 15) % 360 + 360) % 360;
  const cached = rotationCursorCache.get(angle);
  if (cached) return cached;
  const arrow = 'M21 21C21 12.72 14.28 6 6 6M11 1 6 6l5 5';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <g transform="rotate(${angle} 14 14)">
        <path d="${arrow}" fill="none" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${arrow}" fill="none" stroke="#202124" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>
  `;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, default`;
  rotationCursorCache.set(angle, cursor);
  return cursor;
}
