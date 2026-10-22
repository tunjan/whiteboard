import type { Point } from '@whiteboard/shared';
import { worldToScreen } from './camera';
import { useCameraFollow } from './use-camera-interaction';
import { useMeasureStore } from './use-measure-store';

const INK = 'var(--link, #2563eb)';
/** Half-length of the end ticks, in screen px. */
const TICK = 6;
/** How far the label sits off the line, in screen px. */
const LABEL_OFFSET = 14;

/**
 * "243 · 32°": length in board units (the units the cartesian background's
 * axes are labelled in) and the angle counter-clockwise from +x, as on paper —
 * world y points down, so it is flipped.
 */
export function measureLabel(a: Point, b: Point): string {
  const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  const degrees = Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI);
  return `${length} · ${(degrees + 360) % 360}°`;
}

/** The measure tool's dimension line, drawn at a constant screen size. */
export function MeasureLayer() {
  const [camera, follow] = useCameraFollow<SVGGElement>();
  const span = useMeasureStore((s) => s.span);
  if (!span) return null;

  const a = worldToScreen(span.a, camera);
  const b = worldToScreen(span.b, camera);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  // Unit normal to the line; any direction will do for a zero-length span.
  const n = len > 0 ? { x: (a.y - b.y) / len, y: (b.x - a.x) / len } : { x: 0, y: -1 };
  // Keep the label above the line, whichever way it was dragged.
  const side = n.y > 0 ? -1 : 1;
  const tick = (p: Point) =>
    `M ${p.x - n.x * TICK} ${p.y - n.y * TICK} L ${p.x + n.x * TICK} ${p.y + n.y * TICK}`;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full"
    >
      <g ref={follow}>
        <path
          d={`M ${a.x} ${a.y} L ${b.x} ${b.y} ${tick(a)} ${tick(b)}`}
          fill="none"
          stroke={INK}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <text
          x={(a.x + b.x) / 2 + side * n.x * LABEL_OFFSET}
          y={(a.y + b.y) / 2 + side * n.y * LABEL_OFFSET}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={INK}
          stroke="var(--background, #fff)"
          strokeWidth={4}
          paintOrder="stroke"
          fontSize={12}
          fontWeight={600}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {measureLabel(span.a, span.b)}
        </text>
      </g>
    </svg>
  );
}
