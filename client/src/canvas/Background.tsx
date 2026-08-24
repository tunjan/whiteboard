import { memo } from 'react';
import type { Camera } from './camera';
import {
  type BackgroundType,
  formatAxisLabel,
  getDotGridLayers,
  getGridLevels,
  pmod,
  tickValues,
} from './grid';

interface BackgroundProps {
  type: BackgroundType;
  camera: Camera;
  width: number;
  height: number;
}

// Theme tokens (defined per light/dark in index.css) so the grid stays crisp
// and high-contrast in both modes.
const MINOR = 'var(--grid-minor)';
const MAJOR = 'var(--grid-major)';
const DOT = 'var(--grid-dot)';
const AXIS = 'var(--grid-axis)';
const LABEL = 'var(--color-fg-secondary)';

/**
 * Infinite background rendered in **screen space** (no camera transform) so
 * gridlines are always exactly 1px and perfectly crisp at any zoom. Grid phase
 * and spacing are derived from the camera.
 */
// Memoized: the canvas re-renders on every draw sample, selection change, and
// peer-cursor update, but the grid only depends on these props. `camera` is a
// stable reference except during an actual pan/zoom (where the grid genuinely
// must redraw), so a shallow prop check skips all the unrelated re-renders.
export const Background = memo(function Background({
  type,
  camera,
  width,
  height,
}: BackgroundProps) {
  if (type === 'blank' || width === 0 || height === 0) return null;

  const g = getGridLevels(camera);
  const dotLayers =
    type === 'dot'
      ? getDotGridLayers(camera).filter((layer) => layer.opacity > 0.01)
      : [];
  const minorPhase = `translate(${pmod(g.originX, g.minorScreen)} ${pmod(g.originY, g.minorScreen)})`;
  const majorPhase = `translate(${pmod(g.originX, g.majorScreen)} ${pmod(g.originY, g.majorScreen)})`;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-background)] h-full w-full [contain:strict]"
      aria-hidden="true"
      // Dots are round, so let them antialias; rules stay on crisp pixels.
      shapeRendering={type === 'dot' ? 'auto' : 'crispEdges'}
    >
      <defs>
        {type === 'dot' ? (
          dotLayers.map((layer) => (
            <pattern
              key={layer.id}
              id={`bg-${layer.id}`}
              width={layer.screenStep}
              height={layer.screenStep}
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx={layer.offsetX}
                cy={layer.offsetY}
                r={layer.radius}
                fill={DOT}
              />
            </pattern>
          ))
        ) : (
          <>
            <pattern
              id="bg-minor"
              width={g.minorScreen}
              height={g.minorScreen}
              patternUnits="userSpaceOnUse"
              patternTransform={minorPhase}
            >
              <path
                d={`M ${g.minorScreen} 0 L 0 0 L 0 ${g.minorScreen}`}
                fill="none"
                stroke={MINOR}
                strokeWidth={1}
              />
            </pattern>
            <pattern
              id="bg-major"
              width={g.majorScreen}
              height={g.majorScreen}
              patternUnits="userSpaceOnUse"
              patternTransform={majorPhase}
            >
              <path
                d={`M ${g.majorScreen} 0 L 0 0 L 0 ${g.majorScreen}`}
                fill="none"
                stroke={MAJOR}
                strokeWidth={1}
              />
            </pattern>
          </>
        )}
      </defs>

      {type === 'dot' ? (
        dotLayers.map((layer) => (
          <rect
            key={layer.id}
            width="100%"
            height="100%"
            fill={`url(#bg-${layer.id})`}
            opacity={layer.opacity}
          />
        ))
      ) : (
        <>
          <rect width="100%" height="100%" fill="url(#bg-minor)" />
          <rect width="100%" height="100%" fill="url(#bg-major)" />
        </>
      )}

      {type === 'coordinate' && (
        <CoordinateAxes camera={camera} width={width} height={height} />
      )}
    </svg>
  );
});

interface AxesProps {
  camera: Camera;
  width: number;
  height: number;
}

function CoordinateAxes({ camera, width, height }: AxesProps) {
  const g = getGridLevels(camera);
  const step = g.majorStep;

  // Keep labels visible by clamping them to the viewport edge when an axis
  // scrolls off-screen.
  const axisX = Math.max(2, Math.min(width - 2, g.originX));
  const axisY = Math.max(2, Math.min(height - 2, g.originY));

  const xs = tickValues(camera.x, camera.x + width / camera.z, step);
  const ys = tickValues(camera.y, camera.y + height / camera.z, step);

  const labelStyle = {
    fontSize: 11,
    fill: LABEL,
    stroke: 'var(--color-background)',
    strokeWidth: 3,
    paintOrder: 'stroke' as const,
  };

  return (
    <g>
      {/* Major axes through the world origin. */}
      <line
        x1={g.originX}
        y1={0}
        x2={g.originX}
        y2={height}
        stroke={AXIS}
        strokeWidth={1.25}
      />
      <line
        x1={0}
        y1={g.originY}
        x2={width}
        y2={g.originY}
        stroke={AXIS}
        strokeWidth={1.25}
      />

      {/* X tick labels along the horizontal axis. */}
      {xs.map((wx) => {
        if (wx === 0) return null;
        const sx = (wx - camera.x) * camera.z;
        return (
          <text
            key={`x${wx}`}
            x={sx}
            y={axisY + 14}
            textAnchor="middle"
            {...labelStyle}
          >
            {formatAxisLabel(wx)}
          </text>
        );
      })}

      {/* Y tick labels along the vertical axis. */}
      {ys.map((wy) => {
        if (wy === 0) return null;
        const sy = (wy - camera.y) * camera.z;
        return (
          <text
            key={`y${wy}`}
            x={axisX + 6}
            y={sy}
            textAnchor="start"
            dominantBaseline="middle"
            {...labelStyle}
          >
            {formatAxisLabel(wy)}
          </text>
        );
      })}

      {/* Single origin label. */}
      <text x={axisX + 6} y={axisY + 14} textAnchor="start" {...labelStyle}>
        0
      </text>
    </g>
  );
}
