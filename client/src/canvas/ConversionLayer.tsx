import type { CSSProperties } from 'react';
import { cameraToTransform } from './camera';
import { useCameraFollow } from './use-camera-interaction';
import { ShapeView } from './ShapeView';
import { useConversionStore } from './use-conversion-store';

/** World units the reading frame stands off the ink, so it hugs without touching. */
const PAD = 8;

/** Opacity of the original ink drawn over the equation while comparing. */
const PEEK_OPACITY = 0.55;

/**
 * The two local-only things a handwriting → equation conversion draws.
 *
 * While the model reads, a pale band passes over the ink inside a hairline
 * frame, so the wait has somewhere to look and says what is being read. While
 * the compare key is held, the original strokes come back over the equation in
 * the place they were written, which is how a transcription is checked.
 *
 * Its own `<svg>` for the same reason as `VanishLayer`: the sweep animates every
 * frame, and doing that inside the page's SVG would re-raster the whole page.
 */
export function ConversionLayer() {
  const [camera, follow] = useCameraFollow<SVGGElement>();
  const reading = useConversionStore((s) => s.reading);
  const original = useConversionStore((s) => s.original);
  const peeking = useConversionStore((s) => s.peeking);
  if (!reading && !peeking) return null;

  let frame = null;
  if (reading) {
    const x = reading.minX - PAD;
    const y = reading.minY - PAD;
    const w = reading.maxX - reading.minX + PAD * 2;
    const h = reading.maxY - reading.minY + PAD * 2;
    // The band is a third of the frame, with a floor so a small scrawl still
    // gets a visible pass; it enters from beyond the left edge and leaves past
    // the right, so the loop restarts while it is out of sight.
    const band = Math.max(w / 3, 48);
    frame = (
      <g
        className="conversion-reading"
        style={
          {
            '--sweep-from': `${-band}px`,
            '--sweep-to': `${w}px`,
          } as CSSProperties
        }
      >
        <defs>
          <linearGradient id="conversion-band" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--link, #2563eb)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--link, #2563eb)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--link, #2563eb)" stopOpacity="0" />
          </linearGradient>
          <clipPath id="conversion-clip">
            <rect x={x} y={y} width={w} height={h} rx={8} />
          </clipPath>
        </defs>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={8}
          fill="var(--link, #2563eb)"
          fillOpacity={0.04}
          stroke="var(--link, #2563eb)"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <g clipPath="url(#conversion-clip)">
          <rect
            className="conversion-sweep"
            x={x}
            y={y}
            width={band}
            height={h}
            fill="url(#conversion-band)"
          />
        </g>
      </g>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)] h-full w-full"
    >
      <g ref={follow}>
        <g transform={cameraToTransform(camera)}>
          {frame}
          {peeking &&
            original?.shapes.map((shape) => (
              <ShapeView key={shape.id} shape={shape} opacity={PEEK_OPACITY} />
            ))}
        </g>
      </g>
    </svg>
  );
}
