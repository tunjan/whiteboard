import type { Shape } from '@whiteboard/shared';
import type { Camera } from './camera';
import { cameraToTransform, worldToScreen } from './camera';
import { isCoarsePointer } from './platform';
import { shapeOutlineCorners } from './selection-geometry';
import { shapeRegistry } from './shapes/shape-registry';
import { useDocumentStore } from './use-document-store';
import { useHoverStore } from './use-hover-store';
import { useSelectionStore } from './use-selection-store';

/** Stable empty array for the non-group path (see `isGroup`). */
const NO_SHAPES: Shape[] = [];

const ACCENT = 'var(--action-solid, #3b82f6)';
/** Faint enough to read as "this is what you would get", not as a selection. */
const OPACITY = 0.45;

/**
 * The outline of the shape the pointer is over — what a click would select.
 *
 * Its own layer rather than a branch of {@link SelectionLayer}: hover changes on
 * pointer moves the selection knows nothing about, and the selection box and its
 * handles have no business re-rendering for them.
 *
 * The canvas mounts it for the select tool alone. Every other tool acts where
 * the pointer is rather than on what is under it, so an outline would be
 * promising something that is not about to happen. Coarse pointers, which have
 * no hover at all, are turned away here.
 */
export function HoverLayer({ camera }: { camera: Camera }) {
  const hoveredId = useHoverStore((s) => s.hoveredId);
  const selected = useSelectionStore((s) => s.selectedIds);
  const shape = useDocumentStore((s) =>
    hoveredId ? s.shapesById.get(hoveredId) : undefined,
  );
  // A group's box is derived from its descendants, so it is the one case that
  // has to watch the whole page; everything else depends on its own shape only.
  const isGroup = shape?.type === 'group';
  const shapes = useDocumentStore((s) => (isGroup ? s.shapes : NO_SHAPES));

  // The selected shape already has a box around it, and drawing a second one
  // inside it just thickens the line.
  if (!shape || selected.includes(shape.id) || isCoarsePointer()) return null;

  const traced = shapeRegistry
    .getFor(shape)
    ?.getIndicatorPath?.(shape as never);
  if (traced) {
    return (
      <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full">
        {/* World space, so a curve is traced exactly; the stroke stays a
            constant screen width via non-scaling-stroke. */}
        <g transform={cameraToTransform(camera)} fill="none">
          <path
            d={traced.d}
            transform={traced.transform}
            stroke={ACCENT}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={OPACITY}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    );
  }

  const outline = shapeOutlineCorners(shape, shapes);
  if (!outline) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full">
      <polygon
        points={outline
          .map((corner) => {
            const p = worldToScreen(corner, camera);
            return `${p.x},${p.y}`;
          })
          .join(' ')}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.5}
        // Dashed for a group, for the same reason its selection box is: the box
        // bounds shapes rather than being one.
        strokeDasharray={isGroup ? '4 3' : undefined}
        opacity={OPACITY}
      />
    </svg>
  );
}
