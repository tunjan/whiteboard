import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { MousePointer2 } from 'lucide-react';
import { rotatePoint, type Point, type TextShape } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import { EraserGlyph } from '@/canvas/EraserCursor';
import {
  useCameraFollow,
  useCameraPlacement,
} from '@/canvas/use-camera-interaction';
import { useCameraStore } from '@/canvas/use-camera-store';
import {
  caretForTextIndex,
  layoutTextProps,
  textSelectionRects,
  type TextLayout,
} from '@/canvas/shapes/text-measure';
import { useDocumentStore } from '@/canvas/use-document-store';
import { useShapesById } from '@/canvas/use-shapes';
import { cursorEdgeIndicator } from '@/collab/cursor-edge';
import { CursorInterpolator } from '@/collab/cursor-interpolation';
import { outlineColor } from '@/collab/identity';
import { jumpToPeerViewport } from '@/collab/presence';
import {
  type PeerPresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { cn } from '@/lib/utils';

// Far enough from the edge that the whole marker clears the layer's clip: the
// 24px disc is centred here and its wedge reaches 18px beyond that centre.
const EDGE_INDICATOR_INSET = 22;

export function CursorIcon({ color }: { color: string }) {
  // The wide round-joined outer stroke doubles as the darker border and rounds
  // off the pointer's sharp corners. The slim inner stroke keeps roughly a
  // one-pixel outline visible after the fill is layered on top.
  return (
    <span
      aria-hidden="true"
      className="relative block size-5 -translate-x-1 -translate-y-1"
    >
      <MousePointer2
        className="absolute inset-0 size-5"
        fill={outlineColor(color)}
        stroke={outlineColor(color)}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <MousePointer2
        className="absolute inset-0 size-5"
        fill={color}
        stroke={color}
        strokeWidth={0.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </span>
  );
}

function OffscreenCursorIndicator({
  peer,
  wedgeRef,
}: {
  peer: PeerPresence;
  /** Turned toward the peer by `EdgeCursor`, which owns its transform. */
  wedgeRef: RefObject<HTMLSpanElement | null>;
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
      className="group pointer-events-auto relative size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full outline-none disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      title={name}
      aria-label={`Jump to ${name}'s view`}
      disabled={!peer.viewport}
      onClick={() => jumpToPeerViewport(peer)}
    >
      {/* The wedge sits flush against the disc so the two read as a single
          object rather than a floating arrow. */}
      <span ref={wedgeRef} className="absolute inset-0">
        <svg
          aria-hidden="true"
          viewBox="0 0 8 6"
          className="absolute -top-1.5 left-1/2 h-1.5 w-2 -translate-x-1/2 overflow-visible"
        >
          <path
            d="M4 0 8 6H0Z"
            fill={color}
            stroke={outlineColor(color)}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span
        // Same chrome as the on-canvas name tag below, so the two ways a peer
        // can appear belong to one system — except for the hairline, which
        // carries the identity colour at full strength so the marker stays
        // scannable from across the board without flooding the disc.
        className="absolute inset-0 flex items-center justify-center rounded-full border bg-surface/95 text-2xs font-medium leading-none text-fg shadow-e2 transition-colors duration-instant group-hover:bg-surface-hover"
        style={{ borderColor: color }}
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

/**
 * Where each on-page peer's cursor sits relative to the viewport — `edge` when
 * off-screen, else whether its name tag flips `above` it — as one comparable
 * string. These are the only parts of the layout a pan can change, so they are
 * the only camera read that re-renders the layer.
 */
function cursorLayoutKey(
  peers: PeerPresence[],
  camera: Camera,
  viewportSize: { width: number; height: number },
): string {
  return peers
    .map((p) => {
      if (!p.cursor) return `${p.clientId}:none`;
      const s = worldToScreen(p.cursor, camera);
      if (cursorEdgeIndicator(s, viewportSize, EDGE_INDICATOR_INSET))
        return `${p.clientId}:edge`;
      return `${p.clientId}:${s.y > viewportSize.height - 44 ? 'above' : 'below'}`;
    })
    .join('|');
}

/** An off-screen peer's marker, slid along the viewport edge against the live
 *  camera without re-rendering. */
function EdgeCursor({
  peer,
  viewportSize,
}: {
  peer: PeerPresence;
  viewportSize: { width: number; height: number };
}) {
  const wedge = useRef<HTMLSpanElement>(null);
  const place = useCameraPlacement<HTMLDivElement>((element, camera) => {
    if (!peer.cursor) return;
    const edge = cursorEdgeIndicator(
      worldToScreen(peer.cursor, camera),
      viewportSize,
      EDGE_INDICATOR_INSET,
    );
    // Back in view: the layer re-renders this marker away on the same change.
    if (!edge) return;
    element.style.transform = `translate3d(${Math.round(edge.position.x)}px, ${Math.round(edge.position.y)}px, 0)`;
    if (wedge.current)
      wedge.current.style.transform = `rotate(${edge.rotation}deg)`;
  });
  return (
    <div
      ref={place}
      className="absolute top-0 left-0 z-10 transition-transform duration-75 ease-linear will-change-transform motion-reduce:transition-none"
    >
      <OffscreenCursorIndicator peer={peer} wedgeRef={wedge} />
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * One on-screen peer cursor. Peers publish at 5 Hz, so it is not placed at
 * each position as it arrives: a `CursorInterpolator` plays the positions back
 * as a curve, written to the transform from rAF while there is motion left.
 * The transform is never part of the rendered style, so a re-render cannot
 * snap the cursor to its target mid-glide.
 *
 * Placed against the live camera, outside the layer's camera follower: that
 * wrapper is stretched by live/rendered zoom until React catches up, which
 * made the pointer and name tag pulse and drift mid-zoom.
 */
function PeerCursor({
  peer,
  cursor,
  above,
}: {
  peer: PeerPresence;
  cursor: Point;
  above: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const player = useRef<CursorInterpolator | null>(null);
  const frame = useRef<number | null>(null);

  const place = useCallback((point: Point) => {
    const s = worldToScreen(point, useCameraStore.getState().camera);
    if (element.current)
      element.current.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
  }, []);

  const tick = useCallback(
    (now: number) => {
      const current = player.current;
      if (!current) return;
      place(current.sample(now));
      frame.current = current.animating ? requestAnimationFrame(tick) : null;
    },
    [place],
  );

  useLayoutEffect(() => {
    if (!player.current) {
      player.current = new CursorInterpolator(cursor);
      place(cursor);
      return;
    }
    if (prefersReducedMotion()) {
      player.current.snap(cursor);
      place(cursor);
      return;
    }
    player.current.push(cursor);
    if (frame.current === null) tick(performance.now());
  }, [cursor, place, tick]);

  // Follow pans and zooms in the same tick as the shapes, without a render.
  useLayoutEffect(
    () =>
      useCameraStore.subscribe((next, prev) => {
        if (next.camera !== prev.camera && player.current)
          place(player.current.sample(performance.now()));
      }),
    [place],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div
      ref={element}
      aria-hidden="true"
      className="absolute top-0 left-0 will-change-transform"
    >
      {/* 'cross' is the wire name for the eraser, kept for older peers. */}
      {peer.cursorType === 'cross' ? (
        <EraserGlyph rubber={peer.color} />
      ) : (
        <CursorIcon color={peer.color} />
      )}
      <span
        className={cn(
          'absolute left-3 flex h-6 max-w-40 items-center gap-1.5 rounded-lg border border-border bg-surface/95 px-2 text-2xs font-medium leading-none text-fg shadow-e2',
          above ? 'bottom-3' : 'top-3',
        )}
      >
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: peer.color }}
        />
        <span className="truncate">{peer.name}</span>
      </span>
    </div>
  );
}

/** Live peer cursors, positioned from world-coordinate awareness state. */
export function CursorsLayer({
  viewportSize,
}: {
  viewportSize: { width: number; height: number };
}) {
  const peers = usePresenceStore((s) => s.peers);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  // Only the shapes peers have a text selection in — usually none. Extracting
  // them by id keeps this off the per-mutation path: depending on a whole-page
  // object re-rendered every peer cursor once per frame of every stroke.
  const shapes = useShapesById(
    peers.flatMap((p) => p.textSelection?.shapeId ?? []),
  );
  // Cursors and text selections are drawn against the zoom inside a camera
  // follower, so a pan moves them without a render. Only peers on this page.
  const [camera, follow] = useCameraFollow<HTMLDivElement>();
  const onPage = peers.filter((p) => !p.page || p.page === currentPageId);
  const layout = useCameraStore((s) =>
    cursorLayoutKey(onPage, s.camera, viewportSize),
  );
  const modes = new Map(
    layout
      .split('|')
      .filter(Boolean)
      .map((entry) => {
        const at = entry.lastIndexOf(':');
        return [entry.slice(0, at), entry.slice(at + 1)] as const;
      }),
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-[var(--z-canvas-collaborator)] overflow-hidden">
      <div ref={follow} className="absolute top-0 left-0">
        {onPage.map((p) => {
          const selection = p.textSelection;
          const textShape = selection ? shapes?.[selection.shapeId] : undefined;
          const textOverlay =
            textShape?.type === 'text' && selection
              ? (() => {
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
                            points={corners
                              .map((point) => `${point.x},${point.y}`)
                              .join(' ')}
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
                })()
              : null;

          return <Fragment key={p.clientId}>{textOverlay}</Fragment>;
        })}
      </div>
      {onPage.map((p) => {
        const mode = modes.get(String(p.clientId));
        return p.cursor && (mode === 'above' || mode === 'below') ? (
          <PeerCursor
            key={p.clientId}
            peer={p}
            cursor={p.cursor}
            above={mode === 'above'}
          />
        ) : null;
      })}
      {onPage.map((p) =>
        modes.get(String(p.clientId)) === 'edge' ? (
          <EdgeCursor key={p.clientId} peer={p} viewportSize={viewportSize} />
        ) : null,
      )}
    </div>
  );
}
