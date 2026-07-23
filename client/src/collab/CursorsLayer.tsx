import { Fragment } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { MousePointer2, Navigation2 } from 'lucide-react';
import { rotatePoint, type Shape, type TextShape } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import {
  caretForTextIndex,
  layoutTextProps,
  textSelectionRects,
  type TextLayout,
} from '@/canvas/shapes/text-measure';
import { useDocumentStore } from '@/canvas/use-document-store';
import { cursorEdgeIndicator } from '@/collab/cursor-edge';
import { outlineColor, textOnColor } from '@/collab/identity';
import { jumpToPeerViewport } from '@/collab/presence';
import {
  type PeerPresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { cn } from '@/lib/utils';

// Far enough from the edge that the whole marker clears the layer's clip: the
// 32px bubble is centred here and its arrow reaches ~36px beyond that centre.
const EDGE_INDICATOR_INSET = 40;

function CursorIcon({ color }: { color: string }) {
  // The wide round-joined outer stroke doubles as the darker border and as the
  // thing that rounds off the pointer's sharp corners.
  return (
    <span
      aria-hidden="true"
      className="relative block size-5 -translate-x-1 -translate-y-1"
    >
      <MousePointer2
        className="absolute inset-0 size-5"
        fill={outlineColor(color)}
        stroke={outlineColor(color)}
        strokeWidth={1.75}
      />
      <MousePointer2
        className="absolute inset-0 size-5"
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
    </span>
  );
}

function OffscreenCursorIndicator({
  peer,
  rotation,
}: {
  peer: PeerPresence;
  rotation: number;
}) {
  const { color, name } = peer;
  return (
    <button
      type="button"
      // The layer itself is pointer-events-none; this marker opts back in so it
      // can be clicked to jump to the peer, like their avatar in the header.
      // `data-ui-layer` keeps the canvas from claiming the pointerdown as a
      // tool gesture — that captures the pointer, and the click never lands.
      data-ui-layer
      className="pointer-events-auto relative size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full outline-none transition-opacity hover:opacity-80 disabled:cursor-default"
      title={name}
      aria-label={`Jump to ${name}'s view`}
      disabled={!peer.viewport}
      onClick={() => jumpToPeerViewport(peer)}
    >
      <span
        className="absolute inset-0"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <Navigation2
          className="absolute -top-4 left-1/2 size-4 -translate-x-1/2"
          fill={outlineColor(color)}
          stroke={outlineColor(color)}
          strokeWidth={3}
        />
        <Navigation2
          className="absolute -top-4 left-1/2 size-4 -translate-x-1/2"
          fill={color}
          stroke={color}
          strokeWidth={1.5}
        />
      </span>
      <span
        className="absolute inset-0 flex items-center justify-center rounded-full border text-xs font-semibold shadow-hover"
        style={{
          backgroundColor: color,
          borderColor: outlineColor(color),
          color: textOnColor(color),
        }}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    </button>
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
export function CursorsLayer({
  camera,
  viewportSize,
}: {
  camera: Camera;
  viewportSize: { width: number; height: number };
}) {
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  // Only the shapes peers have a text selection in — usually none. Subscribing
  // to the whole page record instead re-rendered every peer cursor once per
  // frame of every stroke, since that record is rebuilt on each mutation.
  const shapes = useDocumentStore(
    useShallow((s) => {
      const record = s.doc.pages[s.currentPageId]?.shapes;
      const out: Record<string, Shape> = {};
      if (!record) return out;
      for (const p of peers) {
        const id = p.textSelection?.shapeId;
        const shape = id ? record[id] : undefined;
        if (id && shape) out[id] = shape;
      }
      return out;
    }),
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
        const edgeIndicator = s
          ? cursorEdgeIndicator(s, viewportSize, EDGE_INDICATOR_INSET)
          : null;
        const placeLabelAbove =
          s !== null && s.y > viewportSize.height - 44;
        return (
          <Fragment key={p.clientId}>
            {textOverlay}
            {s && edgeIndicator ? (
              <div
                className="absolute top-0 left-0 z-10 transition-transform duration-75 ease-linear will-change-transform motion-reduce:transition-none"
                style={{
                  transform: `translate3d(${Math.round(edgeIndicator.position.x)}px, ${Math.round(edgeIndicator.position.y)}px, 0)`,
                }}
              >
                <OffscreenCursorIndicator
                  peer={p}
                  rotation={edgeIndicator.rotation}
                />
              </div>
            ) : s ? (
              <div
                aria-hidden="true"
                className="absolute top-0 left-0 transition-transform duration-75 ease-linear will-change-transform motion-reduce:transition-none"
                style={{
                  transform: `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`,
                }}
              >
                <CursorIcon color={p.color} />
                <span
                  className={cn(
                    'absolute left-3 flex h-6 max-w-40 items-center rounded-md border px-2 text-[11px] font-medium leading-none shadow-hover',
                    placeLabelAbove ? 'bottom-3' : 'top-3',
                  )}
                  style={{
                    backgroundColor: p.color,
                    borderColor: outlineColor(p.color),
                    color: textOnColor(p.color),
                  }}
                >
                  <span className="truncate">{p.name}</span>
                </span>
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
