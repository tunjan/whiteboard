import { cameraToTransform, type Camera } from './camera';
import { ShapeView } from './ShapeView';
import { useVanishStore } from './use-vanish-store';

/**
 * Shapes that were just deleted, fading out where they stood.
 *
 * Its own `<svg>` rather than a group inside the shapes one, for the same
 * reason as `ActiveStrokeLayer`: the fade animates every frame it runs, and
 * doing that inside the element holding the whole page would make the browser
 * re-raster that layer for the length of the animation.
 *
 * Ghosts paint above the live page. A shape deleted from underneath others
 * therefore fades on top of them for a moment, which is the cheaper trade — the
 * common case is deleting what you just selected, and that shape is the one the
 * eye is following.
 */
export function VanishLayer({ camera }: { camera: Camera }) {
  const ghosts = useVanishStore((s) => s.ghosts);
  if (ghosts.length === 0) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)] h-full w-full">
      <g transform={cameraToTransform(camera)}>
        {ghosts.map((ghost) => (
          // The animated opacity rides on this wrapper; `ShapeView` composites
          // the shape's own resolved opacity inside it, so a half-transparent
          // or eraser-dimmed shape fades from where it actually was.
          <g key={ghost.key} className="shape-vanish">
            <ShapeView shape={ghost.shape} opacity={ghost.opacity} />
          </g>
        ))}
      </g>
    </svg>
  );
}
