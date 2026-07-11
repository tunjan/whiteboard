import { Fragment } from 'react';
import { rotatePoint, type TextShape } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import {
  caretForTextIndex,
  layoutTextProps,
  textSelectionRects,
  type TextLayout,
} from '@/canvas/shapes/text-measure';
import { useDocumentStore } from '@/canvas/use-document-store';
import { usePresenceStore } from '@/collab/use-presence-store';

function CursorIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="19"
      viewBox="0 0 20 22"
      className="block"
    >
      <path
        d="M3.25 2.5 17 10.05l-5.45 1.7-2.7 5.25L3.25 2.5Z"
        fill={color}
        stroke="var(--bg-default)"
        strokeWidth="2.25"
        strokeLinejoin="round"
        style={{ paintOrder: 'stroke fill' }}
      />
    </svg>
  );
}

function textLocalToScreen(
  shape: TextShape,
  layout: TextLayout,
  local: { x: number; y: number },
  camera: Camera,
) {
  const point = { x: shape.x + local.x, y: shape.y + local.y };
  const world = shape.rotation
    ? rotatePoint(
        point,
        {
          x: shape.x + layout.width / 2,
          y: shape.y + layout.height / 2,
        },
        shape.rotation,
      )
    : point;
  return worldToScreen(world, camera);
}

/** Live peer cursors, positioned from world-coordinate awareness state. */
export function CursorsLayer({ camera }: { camera: Camera }) {
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const shapes = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {peers.map((p) => {
        // Only show cursors of peers viewing the same page.
        if (p.page && p.page !== currentPageId) return null;
        const selection = p.textSelection;
        const textShape = selection ? shapes?.[selection.shapeId] : undefined;
        const textOverlay =
          textShape?.type === 'text' && selection ? (() => {
            const layout = layoutTextProps(textShape.props);
            const rects = textSelectionRects(
              layout,
              selection.anchor,
              selection.head,
            );
            const caret = caretForTextIndex(layout, selection.head);
            const caretStart = textLocalToScreen(
              textShape,
              layout,
              { x: caret.x, y: caret.y },
              camera,
            );
            const caretEnd = textLocalToScreen(
              textShape,
              layout,
              { x: caret.x, y: caret.y + caret.height },
              camera,
            );
            return (
              <svg className="absolute inset-0 size-full overflow-visible">
                {rects.map((rect, index) => {
                  const corners = [
                    { x: rect.x, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y },
                    { x: rect.x + rect.width, y: rect.y + rect.height },
                    { x: rect.x, y: rect.y + rect.height },
                  ].map((point) =>
                    textLocalToScreen(textShape, layout, point, camera),
                  );
                  return (
                    <polygon
                      // eslint-disable-next-line react/no-array-index-key -- line rectangles are positional
                      key={index}
                      points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill={p.color}
                      fillOpacity={0.14}
                    />
                  );
                })}
                <line
                  x1={caretStart.x}
                  y1={caretStart.y}
                  x2={caretEnd.x}
                  y2={caretEnd.y}
                  stroke={p.color}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              </svg>
            );
          })() : null;

        const s = p.cursor ? worldToScreen(p.cursor, camera) : null;
        return (
          <Fragment key={p.clientId}>
            {textOverlay}
            {s && (
              <div
                aria-hidden="true"
                className="absolute top-0 left-0 will-change-transform"
                style={{
                  transform: `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`,
                }}
              >
                <CursorIcon color={p.color} />
                <span
                  className="absolute top-3 left-3 flex max-w-36 items-center rounded-md border px-2 py-1 text-[11px] font-medium leading-none text-content-emphasis"
                  style={{
                    background: `color-mix(in srgb, ${p.color} 8%, var(--bg-default))`,
                    borderColor: `color-mix(in srgb, ${p.color} 22%, var(--border-subtle))`,
                  }}
                >
                  <span className="truncate">{p.name}</span>
                </span>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
