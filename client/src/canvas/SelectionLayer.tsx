import type { Camera } from './camera';
import { worldToScreen } from './camera';
import {
  getSelectionInfo,
  shapeRotatedBounds,
} from './selection-geometry';
import { useDocumentStore } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

const ACCENT = 'var(--color-accent-brand)';
const SNAP = '#e5484d';
const HANDLE = 7;

interface SelectionLayerProps {
  camera: Camera;
}

/**
 * Visual selection overlay (bounding box, resize/rotate handles, marquee),
 * drawn in screen space so handles stay a constant size. Purely visual —
 * pointer-events are off; the select tool handles all interaction.
 */
export function SelectionLayer({ camera }: SelectionLayerProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const marquee = useSelectionStore((s) => s.marquee);
  const snapGuides = useSelectionStore((s) => s.snapGuides);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  // Shared, pre-sorted array from the store — no per-render document re-sort.
  const shapes = useDocumentStore((s) => s.shapes);
  const info = getSelectionInfo(shapes, selectedIds, camera.z);
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
        const rotateHandle = info.handles.find((h) => h.id === 'rotate');
        const topMid = { x: (nw.x + ne.x) / 2, y: (nw.y + ne.y) / 2 };
        const rh = rotateHandle ? toScreen(rotateHandle.point) : null;
        return (
          <g>
            <polygon
              points={`${nw.x},${nw.y} ${ne.x},${ne.y} ${se.x},${se.y} ${sw.x},${sw.y}`}
              fill="none"
              stroke={locked ? 'var(--color-muted-foreground)' : ACCENT}
              strokeWidth={1.5}
              strokeDasharray={locked ? '4 3' : undefined}
            />
            {rh && (
              <>
                <line
                  x1={topMid.x}
                  y1={topMid.y}
                  x2={rh.x}
                  y2={rh.y}
                  stroke={ACCENT}
                  strokeWidth={1.5}
                />
                <circle
                  cx={rh.x}
                  cy={rh.y}
                  r={HANDLE / 2 + 1}
                  fill="var(--color-background)"
                  stroke={ACCENT}
                  strokeWidth={1.5}
                />
              </>
            )}
            {info.handles
              .filter((h) => h.id !== 'rotate')
              .map((h) => {
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

      {/* Connector handles: endpoints (square) and the curve bend (circle). */}
      {info?.customHandles?.map((h) => {
        const p = toScreen(h.point);
        return h.kind === 'bend' ? (
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
