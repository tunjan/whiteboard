import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Camera } from './camera';
import { useCameraInteraction } from './use-camera-interaction';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { rasterZoom } from './raster-grid';
import {
  backgroundLevel,
  backgroundRasterTransform,
  paintBackgroundRaster,
  type BackgroundRaster,
} from './background-raster';
import {
  type BackgroundType,
  formatAxisLabel,
  getDotGridLayers,
  GROUND_FADE_MASK,
  getGridLevels,
  isTriangleGrid,
  pmod,
  tickValues,
  triangleTile,
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
const DOT = 'var(--grid-dot-ink)';
const DOT_ALPHA = 'var(--grid-dot-alpha)';
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
export const Background = memo(function Background(props: BackgroundProps) {
  if (props.type === 'blank' || props.width <= 0 || props.height <= 0)
    return null;
  return <CachedBackground {...props} />;
});

function CachedBackground({ type, camera, width, height }: BackgroundProps) {
  const moving = useCameraInteraction((s) => s.isMoving);
  const groundFade = useCanvasUiStore((s) => s.groundFade);
  const canvas = useRef<HTMLCanvasElement>(null);
  const vector = useRef<HTMLDivElement>(null);
  const cached = useRef<BackgroundRaster | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(0);
  const previous = useRef({ width, height, type, theme, moving });
  // Keep React out of the SVG pattern tree during movement. Coordinate labels
  // below remain live because they are screen-sized and clamp to the viewport.
  const frozen = moving && ready;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const gridCamera = useMemo(() => camera, [frozen, frozen ? null : camera]);

  useLayoutEffect(() => {
    const observer = new MutationObserver(() => setTheme((n) => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const before = previous.current;
    let raster = cached.current;
    if (
      !raster ||
      before.width !== width ||
      before.height !== height ||
      before.type !== type ||
      before.theme !== theme ||
      raster.band !== rasterZoom(camera.z) ||
      raster.level !== backgroundLevel(type, camera) ||
      raster.ratio !== Math.min(window.devicePixelRatio || 1, 2) ||
      (!moving && (before.moving || raster.zoom !== camera.z))
    ) {
      try {
        raster = paintBackgroundRaster(
          canvas.current!,
          type,
          camera,
          width,
          height,
        );
      } catch {
        raster = null;
      }
      cached.current = raster;
      setReady(raster !== null);
    }
    previous.current = { width, height, type, theme, moving };
    if (raster)
      canvas.current!.style.transform = backgroundRasterTransform(
        raster,
        camera,
      );
    canvas.current!.style.display = moving && raster ? 'block' : 'none';
    vector.current!.style.display = moving && raster ? 'none' : '';
  }, [camera, width, height, type, theme, moving]);

  return (
    <>
      {/* One box for both grid paths so the fade masks them identically. The
          axes stay outside it: their labels clamp to the edges to stay
          readable, which is exactly where the fade would hide them. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[var(--z-canvas-background)]"
        style={
          groundFade
            ? { maskImage: GROUND_FADE_MASK, WebkitMaskImage: GROUND_FADE_MASK }
            : undefined
        }
      >
        <div
          data-background-cache
          className="pointer-events-none absolute inset-0 z-[var(--z-canvas-background)] overflow-hidden [contain:strict]"
        >
          <canvas
            ref={canvas}
            style={{
              position: 'absolute',
              transformOrigin: '0 0',
              display: 'none',
            }}
          />
        </div>
        <div ref={vector}>
          <VectorBackground
            type={type}
            camera={gridCamera}
            width={width}
            height={height}
          />
        </div>
      </div>
      {type === 'coordinate' && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[var(--z-canvas-background)] h-full w-full"
        >
          <CoordinateAxes camera={camera} width={width} height={height} />
        </svg>
      )}
    </>
  );
}

const VectorBackground = memo(function VectorBackground({
  type,
  camera,
  width,
  height,
}: BackgroundProps) {
  if (type === 'blank' || width === 0 || height === 0) return null;

  const g = getGridLevels(camera);
  const dotLayers =
    type === 'dot'
      ? getDotGridLayers(camera, window.devicePixelRatio || 1).filter(
          (layer) => layer.opacity > 0.01,
        )
      : [];
  const rules = (['minor', 'major'] as const).map((level) => {
    const step = level === 'minor' ? g.minorScreen : g.majorScreen;
    const tile = isTriangleGrid(type)
      ? triangleTile(type, step)
      : { w: step, h: step, lines: [] };
    return {
      level,
      ...tile,
      d: isTriangleGrid(type)
        ? tile.lines
            .map(([x1, y1, x2, y2]) => `M ${x1} ${y1} L ${x2} ${y2}`)
            .join(' ')
        : `M ${step} 0 L 0 0 L 0 ${step}`,
      phase: `translate(${pmod(g.originX, tile.w)} ${pmod(g.originY, tile.h)})`,
    };
  });

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-background)] h-full w-full [contain:strict]"
      aria-hidden="true"
      // Dots and diagonals antialias; square rules stay on crisp pixels.
      shapeRendering={
        type === 'dot' || isTriangleGrid(type) ? 'auto' : 'crispEdges'
      }
    >
      <defs>
        {type === 'dot'
          ? dotLayers.map((layer) => (
              <pattern
                key={layer.id}
                id={`bg-${layer.id}`}
                width={layer.screenStep}
                height={layer.screenStep}
                patternUnits="userSpaceOnUse"
                // The dot sits mid-tile and the tile moves, so the tile edge
                // never clips it the way a phased circle would be.
                patternTransform={`translate(${layer.offsetX - layer.screenStep / 2} ${layer.offsetY - layer.screenStep / 2})`}
              >
                <circle
                  cx={layer.screenStep / 2}
                  cy={layer.screenStep / 2}
                  r={layer.radius}
                  fill={DOT}
                />
              </pattern>
            ))
          : rules.map((r) => (
              <pattern
                key={r.level}
                id={`bg-${r.level}`}
                width={r.w}
                height={r.h}
                patternUnits="userSpaceOnUse"
                patternTransform={r.phase}
              >
                <path
                  d={r.d}
                  fill="none"
                  stroke={r.level === 'minor' ? MINOR : MAJOR}
                  strokeWidth={1}
                />
              </pattern>
            ))}
      </defs>

      {type === 'dot' ? (
        // Opaque ink inside, alpha once outside: a dot shared by two lattices
        // is no darker than any other.
        <g style={{ opacity: DOT_ALPHA }}>
          {dotLayers.map((layer) => (
            <rect
              key={layer.id}
              width="100%"
              height="100%"
              fill={`url(#bg-${layer.id})`}
              opacity={layer.opacity}
            />
          ))}
        </g>
      ) : (
        <>
          <rect width="100%" height="100%" fill="url(#bg-minor)" />
          <rect width="100%" height="100%" fill="url(#bg-major)" />
        </>
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
