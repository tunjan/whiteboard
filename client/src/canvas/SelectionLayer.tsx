import { useShallow } from 'zustand/react/shallow';
import type { Shape } from '@whiteboard/shared';
import type { Camera } from './camera';
import { cameraToTransform, worldToScreen } from './camera';
import {
  getSelectionInfo,
  HANDLE_HIT_SCREEN,
  HANDLE_SCREEN,
  ROTATION_HANDLE_HIT_SCREEN,
  shapeRotatedBounds,
} from './selection-geometry';
import { rotationCursor } from './rotation-cursor';
import { shapeRegistry } from './shapes/shape-registry';
import { useDocumentStore } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

/** Stable empty array for the non-group selection path (see `hasGroup`). */
const NO_SHAPES: Shape[] = [];

const ACCENT = 'var(--action-solid, #3b82f6)';
const MUTED = 'var(--muted-foreground, var(--fg-muted, #78716c))';
const SNAP = '#e5484d';
/** Half-length of a snap indicator's tick marks, in screen px. */
const SNAP_TICK = 3;
/** Screen-px radius of a connector handle's solid grip dot. */
const GRIP = 4;

interface SelectionLayerProps {
  camera: Camera;
}

/**
 * Selection overlay (bounding box, resize handles, rotation zones, marquee),
 * drawn in screen space so controls stay a constant size. The select tool owns
 * interaction; only the invisible corner rotation zones accept pointer hover so
 * they can advertise the rotation cursor.
 */
export function SelectionLayer({ camera }: SelectionLayerProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const marquee = useSelectionStore((s) => s.marquee);
  const snapGuides = useSelectionStore((s) => s.snapGuides);
  // Only the selected shapes, pulled out of the live cache by id. Depending on
  // a whole-page object invalidated this layer once per stroke frame even when
  // the selection was untouched.
  const shapesRecord = useDocumentStore(
    useShallow((s) => {
      const out: Record<string, Shape> = {};
      for (const id of selectedIds) {
        const shape = s.shapesById.get(id);
        if (shape) out[id] = shape;
      }
      return out;
    }),
  );
  // A group's box is derived from its descendants, so a group selection has to
  // re-render when any of them moves — which means depending on the whole
  // document array. Every other selection depends only on `shapesRecord`, so
  // return a constant then and keep this layer off the per-mutation path.
  const hasGroup = Object.values(shapesRecord).some((s) => s.type === 'group');
  const shapes = useDocumentStore((s) => (hasGroup ? s.shapes : NO_SHAPES));
  const info = getSelectionInfo(
    shapes,
    selectedIds,
    camera.z,
    (id) => shapesRecord[id],
  );
  const single = info?.isSingle ? shapesRecord?.[info.ids[0]!] : undefined;
  const locked = !!single?.locked;
  // A group's box bounds shapes rather than being one, so it is dashed to tell
  // the two apart. This layer draws in screen space, so the dash keeps its size
  // at any zoom without rescaling the array.
  const isGroup = single?.type === 'group';

  const toScreen = (p: { x: number; y: number }) => worldToScreen(p, camera);

  // Shapes that describe their own outline (connectors) are traced instead of
  // boxed: a rectangle around an open curve covers mostly empty canvas, says
  // nothing about where the stroke runs, and hides what is underneath it.
  const traced = selectedIds.flatMap((id) => {
    const shape = shapesRecord?.[id];
    if (!shape) return [];
    const util = shapeRegistry.getFor(shape);
    const path = util?.getIndicatorPath?.(shape as never);
    return path ? [{ id, locked: !!shape.locked, path }] : [];
  });
  const tracedIds = new Set(traced.map((t) => t.id));
  // Only the box itself is dropped for a traced shape — any handles the
  // selection still has keep their places on it.
  const boxed = !(info?.isSingle && tracedIds.has(info.ids[0]!));

  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-indicator)] h-full w-full">
      {/* Conformal outlines, drawn in world space so curves stay exact; the
          stroke itself is screen-constant via non-scaling-stroke. */}
      {traced.length > 0 && (
        <g transform={cameraToTransform(camera)} fill="none">
          {traced.map((t) => (
            <path
              key={t.id}
              d={t.path.d}
              transform={t.path.transform}
              stroke={t.locked ? MUTED : ACCENT}
              strokeWidth={1.5}
              strokeDasharray={t.locked ? '4 3' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={info?.isSingle ? 1 : 0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}

      {/* Per-shape outlines for multi-selection (so membership is visible). */}
      {info && !info.isSingle &&
        selectedIds.map((id) => {
          const shape = shapesRecord?.[id];
          if (!shape || tracedIds.has(id)) return null;
          const b = shapeRotatedBounds(shape);
          const tl = toScreen({ x: b.minX, y: b.minY });
          const br = toScreen({ x: b.maxX, y: b.maxY });
          return (
            <rect
              key={id}
              x={tl.x}
              y={tl.y}
              width={br.x - tl.x}
              height={br.y - tl.y}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}

      {info && (() => {
        const c = info.corners;
        const nw = toScreen(c.nw);
        const ne = toScreen(c.ne);
        const se = toScreen(c.se);
        const sw = toScreen(c.sw);
        return (
          <g>
            {boxed && (
              <polygon
                points={`${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`}
                fill="none"
                stroke={locked ? MUTED : ACCENT}
                strokeWidth={1.5}
                strokeDasharray={locked ? '4 3' : isGroup ? '6 4' : undefined}
              />
            )}
            {info.rotationHandles.map((handle) => {
              const p = toScreen(handle.point);
              return (
                <circle
                  key={handle.id}
                  data-rotation-handle={handle.id}
                  cx={p.x}
                  cy={p.y}
                  r={ROTATION_HANDLE_HIT_SCREEN}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: rotationCursor(handle.id, info.rotation) }}
                />
              );
            })}
            {info.handles.map((h) => {
              const p = toScreen(h.point);
              const isTextWidthHandle =
                single?.type === 'text' && (h.id === 'e' || h.id === 'w');
              if (isTextWidthHandle) {
                return (
                  <rect
                    key={h.id}
                    x={p.x - 3}
                    y={p.y - 8}
                    width={6}
                    height={16}
                    rx={3}
                    fill="var(--background, var(--bg-canvas, #ffffff))"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                  />
                );
              }
              return (
                <rect
                  key={h.id}
                  x={p.x - HANDLE_SCREEN / 2}
                  y={p.y - HANDLE_SCREEN / 2}
                  width={HANDLE_SCREEN}
                  height={HANDLE_SCREEN}
                  rx={1.5}
                  fill="var(--background, var(--bg-canvas, #ffffff))"
                  stroke={ACCENT}
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        );
      })()}

      {/* Connector handles: vertices, bend/route controls, and insert points.
          Insert points come first so a vertex paints over one that a short
          segment has collapsed onto it — the same order the select tool
          resolves them in. Each handle carries its own grab zone, which is
          also its hover halo: the circle you can see is the circle the tool
          tests against. Insert points stay invisible until hovered (touch has
          no hover, so `touch-reveal` keeps them out there). */}
      {info?.customHandles
        ?.slice()
        .sort(
          (a, b) => Number(b.kind === 'create') - Number(a.kind === 'create'),
        )
        .map((h) => {
          const p = toScreen(h.point);
          const isCreate = h.kind === 'create';
          return (
            <g
              key={h.id}
              className={
                isCreate
                  ? 'group touch-reveal opacity-0 hover:opacity-100'
                  : 'group'
              }
              style={{ cursor: 'grab' }}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={HANDLE_HIT_SCREEN}
                fill={ACCENT}
                fillOpacity={0.15}
                pointerEvents="all"
                className="opacity-0 group-hover:opacity-100"
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={isCreate ? GRIP - 1 : GRIP}
                fill="var(--background, var(--bg-canvas, #ffffff))"
                stroke={ACCENT}
                strokeWidth={1.5}
              />
              {isCreate && (
                <path
                  d={`M ${p.x - 2} ${p.y} H ${p.x + 2} M ${p.x} ${p.y - 2} V ${p.y + 2}`}
                  stroke={ACCENT}
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}

      {snapGuides.map((g, i) => {
        if (g.kind === 'point') {
          const p = toScreen({ x: g.at, y: g.from });
          const l = SNAP_TICK + 1;
          return (
            <path
              // eslint-disable-next-line react/no-array-index-key -- transient guides
              key={i}
              d={`M ${p.x - l} ${p.y - l} L ${p.x + l} ${p.y + l} M ${p.x - l} ${p.y + l} L ${p.x + l} ${p.y - l}`}
              fill="none"
              stroke={SNAP}
              strokeWidth={1.5}
            />
          );
        }
        if (g.kind === 'gap') {
          const a = g.axis === 'x'
            ? toScreen({ x: g.from, y: g.at })
            : toScreen({ x: g.at, y: g.from });
          const b = g.axis === 'x'
            ? toScreen({ x: g.to, y: g.at })
            : toScreen({ x: g.at, y: g.to });
          // End ticks bound the measured span; the midpoint tick marks the
          // spacing itself, so equal gaps read as a series at a glance.
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const t = SNAP_TICK;
          return (
            <g
              // eslint-disable-next-line react/no-array-index-key -- transient guides
              key={i}
              stroke={SNAP}
              strokeWidth={1}
            >
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {g.axis === 'x' ? (
                <>
                  <line x1={a.x} y1={a.y - t} x2={a.x} y2={a.y + t} />
                  <line x1={b.x} y1={b.y - t} x2={b.x} y2={b.y + t} />
                  <line x1={mid.x} y1={mid.y - t} x2={mid.x} y2={mid.y + t} />
                </>
              ) : (
                <>
                  <line x1={a.x - t} y1={a.y} x2={a.x + t} y2={a.y} />
                  <line x1={b.x - t} y1={b.y} x2={b.x + t} y2={b.y} />
                  <line x1={mid.x - t} y1={mid.y} x2={mid.x + t} y2={mid.y} />
                </>
              )}
            </g>
          );
        }
        const a =
          g.axis === 'x'
            ? toScreen({ x: g.at, y: g.from })
            : toScreen({ x: g.from, y: g.at });
        const b =
          g.axis === 'x'
            ? toScreen({ x: g.at, y: g.to })
            : toScreen({ x: g.to, y: g.at });
        return (
          <line
            // eslint-disable-next-line react/no-array-index-key -- transient guides
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={SNAP}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        );
      })}

      {marquee && (() => {
        const { bounds } = marquee;
        const tl = toScreen({ x: bounds.minX, y: bounds.minY });
        const br = toScreen({ x: bounds.maxX, y: bounds.maxY });
        return (
          <rect
            x={tl.x}
            y={tl.y}
            width={br.x - tl.x}
            height={br.y - tl.y}
            fill={ACCENT}
            fillOpacity={0.08}
            stroke={ACCENT}
            strokeWidth={1}
          />
        );
      })()}
    </svg>
  );
}
