import { useShallow } from 'zustand/react/shallow';
import type { Shape } from '@whiteboard/shared';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import {
  getSelectionInfo,
  ROTATION_HANDLE_HIT_SCREEN,
  shapeRotatedBounds,
} from './selection-geometry';
import { rotationCursor } from './rotation-cursor';
import { useDocumentStore } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

/** Stable empty array for the non-group selection path (see `hasGroup`). */
const NO_SHAPES: Shape[] = [];

const ACCENT = 'var(--color-focus)';
const SNAP = '#e5484d';
const HANDLE = 7;

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
  // Only the selected shapes. The page shapes record is a fresh object on every
  // mutation, so subscribing to it invalidated this layer once per stroke frame
  // even when the selection was untouched.
  const shapesRecord = useDocumentStore(
    useShallow((s) => {
      const record = s.doc.pages[s.currentPageId]?.shapes;
      const out: Record<string, Shape> = {};
      if (!record) return out;
      for (const id of selectedIds) {
        const shape = record[id];
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

  const toScreen = (p: { x: number; y: number }) => worldToScreen(p, camera);

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {/* Per-shape outlines for multi-selection (so membership is visible). */}
      {info && !info.isSingle &&
        selectedIds.map((id) => {
          const shape = shapesRecord?.[id];
          if (!shape) return null;
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
            <polygon
              points={`${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`}
              fill="none"
              stroke={locked ? 'var(--color-muted-foreground)' : ACCENT}
              strokeWidth={1.5}
              strokeDasharray={locked ? '4 3' : undefined}
            />
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
                    fill="var(--color-background)"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                  />
                );
              }
              return (
                <rect
                  key={h.id}
                  x={p.x - HANDLE / 2}
                  y={p.y - HANDLE / 2}
                  width={HANDLE}
                  height={HANDLE}
                  rx={1.5}
                  fill="var(--color-background)"
                  stroke={ACCENT}
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        );
      })()}

      {/* Connector handles: vertices, bend/route controls, and insert points. */}
      {info?.customHandles?.map((h) => {
        const p = toScreen(h.point);
        if (h.kind === 'create') {
          return (
            <g key={h.id} opacity={0.72}>
              <circle
                cx={p.x}
                cy={p.y}
                r={HANDLE / 2 - 0.5}
                fill="var(--color-background)"
                stroke={ACCENT}
                strokeWidth={1.25}
              />
              <path
                d={`M ${p.x - 2} ${p.y} H ${p.x + 2} M ${p.x} ${p.y - 2} V ${p.y + 2}`}
                stroke={ACCENT}
                strokeWidth={1}
              />
            </g>
          );
        }
        return h.kind === 'bend' || h.kind === 'route' ? (
          <circle
            key={h.id}
            cx={p.x}
            cy={p.y}
            r={HANDLE / 2}
            fill="var(--color-background)"
            stroke={ACCENT}
            strokeWidth={1.5}
          />
        ) : (
          <rect
            key={h.id}
            x={p.x - HANDLE / 2}
            y={p.y - HANDLE / 2}
            width={HANDLE}
            height={HANDLE}
            rx={1.5}
            fill="var(--color-background)"
            stroke={ACCENT}
            strokeWidth={1.5}
          />
        );
      })}

      {snapGuides.map((g, i) => {
        if (g.kind === 'point') {
          const point = toScreen({ x: g.at, y: g.from });
          return (
            <circle
              // eslint-disable-next-line react/no-array-index-key -- transient guides
              key={i}
              cx={point.x}
              cy={point.y}
              r={4}
              fill="var(--color-background)"
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
                  <line x1={a.x} y1={a.y - 3} x2={a.x} y2={a.y + 3} />
                  <line x1={b.x} y1={b.y - 3} x2={b.x} y2={b.y + 3} />
                </>
              ) : (
                <>
                  <line x1={a.x - 3} y1={a.y} x2={a.x + 3} y2={a.y} />
                  <line x1={b.x - 3} y1={b.y} x2={b.x + 3} y2={b.y} />
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
