import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { shiftedSortableIndex } from '@/components/sortable-list-geometry';
import { cn } from '@/lib/utils';

const DEFAULT_DRAG_THRESHOLD = 5;
const AUTO_SCROLL_ZONE = 16;
const AUTO_SCROLL_RAMP = 48;
const AUTO_SCROLL_MIN_SPEED = 1;
const AUTO_SCROLL_MAX_SPEED = 6;

/** Vertical breathing room inside the scroller, in px. Callers sizing the list
 *  to its content must add this to the row total, since `height` is border-box. */
export const LIST_VERTICAL_PADDING = 8;

export type SortableHandleProps = {
  'aria-label': string;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

type DragVisual = {
  id: string;
  offset: number;
  startIndex: number;
  targetIndex: number;
};

type PointerState = DragVisual & {
  dragging: boolean;
  lastY: number;
  pointerId: number;
  startScrollTop: number;
  startY: number;
};

export function SortableList<T extends { id: string }>({
  items,
  height,
  rowHeight,
  disabled = false,
  label,
  revealId,
  getItemLabel,
  onReorder,
  children,
}: {
  items: T[];
  height: number;
  rowHeight: number;
  disabled?: boolean;
  label: string;
  /** Item scrolled into view when the list mounts. */
  revealId?: string;
  getItemLabel: (item: T) => string;
  onReorder: (id: string, targetIndex: number) => void;
  children: (
    item: T,
    index: number,
    handleProps: SortableHandleProps,
    dragging: boolean,
  ) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const frameRef = useRef<number | null>(null);
  const itemCountRef = useRef(items.length);
  const [drag, setDrag] = useState<DragVisual | null>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });

  itemCountRef.current = items.length;

  const syncOverflow = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = scroller.scrollTop > 1;
    const bottom =
      scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 1;
    setOverflow((previous) =>
      previous.top === top && previous.bottom === bottom
        ? previous
        : { top, bottom },
    );
  };

  /** Scroll the smallest amount that brings a row fully inside the viewport. */
  const scrollRowIntoView = (index: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const pad = LIST_VERTICAL_PADDING / 2;
    const top = pad + index * rowHeight;
    if (top < scroller.scrollTop + pad) {
      scroller.scrollTop = top - pad;
    } else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight - pad) {
      scroller.scrollTop = top + rowHeight + pad - scroller.clientHeight;
    }
  };

  const stopAutoScroll = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  const updateDrag = (clientY: number) => {
    const pointer = pointerRef.current;
    const scroller = scrollRef.current;
    if (!pointer || !scroller || !pointer.dragging) return;

    const delta =
      clientY -
      pointer.startY +
      (scroller.scrollTop - pointer.startScrollTop);
    const startTop = pointer.startIndex * rowHeight;
    const maxTop = Math.max(0, (itemCountRef.current - 1) * rowHeight);
    const top = Math.max(0, Math.min(maxTop, startTop + delta));
    const targetIndex = Math.max(
      0,
      Math.min(itemCountRef.current - 1, Math.round(top / rowHeight)),
    );

    pointer.offset = top - startTop;
    pointer.targetIndex = targetIndex;
    setDrag({
      id: pointer.id,
      offset: pointer.offset,
      startIndex: pointer.startIndex,
      targetIndex,
    });
  };

  const autoScrollFrame = () => {
    const pointer = pointerRef.current;
    const scroller = scrollRef.current;
    if (!pointer || !pointer.dragging || !scroller) {
      frameRef.current = null;
      return;
    }

    const rect = scroller.getBoundingClientRect();
    const topOvershoot = AUTO_SCROLL_ZONE - (pointer.lastY - rect.top);
    const bottomOvershoot = AUTO_SCROLL_ZONE - (rect.bottom - pointer.lastY);
    let scrollDelta = 0;

    if (topOvershoot > 0 && scroller.scrollTop > 0) {
      const speed =
        AUTO_SCROLL_MIN_SPEED +
        (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) *
          Math.min(1, topOvershoot / AUTO_SCROLL_RAMP);
      scrollDelta = -Math.ceil(speed);
    } else if (
      bottomOvershoot > 0 &&
      scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight
    ) {
      const speed =
        AUTO_SCROLL_MIN_SPEED +
        (AUTO_SCROLL_MAX_SPEED - AUTO_SCROLL_MIN_SPEED) *
          Math.min(1, bottomOvershoot / AUTO_SCROLL_RAMP);
      scrollDelta = Math.ceil(speed);
    }

    if (scrollDelta !== 0) {
      const previous = scroller.scrollTop;
      scroller.scrollTop = Math.max(
        0,
        Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          scroller.scrollTop + scrollDelta,
        ),
      );
      if (scroller.scrollTop !== previous) updateDrag(pointer.lastY);
    }

    frameRef.current = requestAnimationFrame(autoScrollFrame);
  };

  const startAutoScroll = () => {
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(autoScrollFrame);
    }
  };

  const finishDrag = (commit: boolean) => {
    const pointer = pointerRef.current;
    pointerRef.current = null;
    stopAutoScroll();
    setDrag(null);
    if (
      commit &&
      pointer?.dragging &&
      pointer.targetIndex !== pointer.startIndex
    ) {
      onReorder(pointer.id, pointer.targetIndex);
    }
  };

  const handleProps = (item: T, index: number): SortableHandleProps => ({
    'aria-label': `Reorder ${getItemLabel(item)}, position ${index + 1} of ${items.length}`,
    // Keyboard equivalent of dragging. The row keeps its React key, so the
    // handle stays focused across the move and repeats without re-targeting.
    onKeyDown: (event) => {
      if (disabled) return;
      const delta =
        event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (delta === 0) return;
      const target = index + delta;
      if (target < 0 || target >= items.length) return;
      event.preventDefault();
      onReorder(item.id, target);
      scrollRowIntoView(target);
    },
    onPointerDown: (event) => {
      if (disabled || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerRef.current = {
        id: item.id,
        dragging: false,
        lastY: event.clientY,
        offset: 0,
        pointerId: event.pointerId,
        startIndex: index,
        startScrollTop: scrollRef.current?.scrollTop ?? 0,
        startY: event.clientY,
        targetIndex: index,
      };
    },
    onPointerMove: (event) => {
      const pointer = pointerRef.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      pointer.lastY = event.clientY;
      if (!pointer.dragging) {
        if (Math.abs(event.clientY - pointer.startY) <= DEFAULT_DRAG_THRESHOLD) {
          return;
        }
        pointer.dragging = true;
        startAutoScroll();
      }
      updateDrag(event.clientY);
    },
    onPointerUp: (event) => {
      if (pointerRef.current?.pointerId === event.pointerId) finishDrag(true);
    },
    onPointerCancel: (event) => {
      if (pointerRef.current?.pointerId === event.pointerId) finishDrag(false);
    },
    onLostPointerCapture: (event) => {
      if (pointerRef.current?.pointerId === event.pointerId) finishDrag(false);
    },
  });

  useEffect(() => {
    return () => stopAutoScroll();
  }, []);

  useEffect(() => {
    if (drag && !items.some((item) => item.id === drag.id)) finishDrag(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, items]);

  // Reveal the caller's item on mount, so reopening a scrolled list does not
  // strand the entry the user cares about above or below the fold.
  useEffect(() => {
    const index = items.findIndex((item) => item.id === revealId);
    if (index >= 0) scrollRowIntoView(index);
    syncOverflow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(syncOverflow, [height, items.length]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={syncOverflow}
        className="overflow-y-auto overscroll-contain px-1 py-1"
        style={{ height }}
      >
        <ul
          aria-label={label}
          className="relative"
          style={{ height: items.length * rowHeight }}
        >
          {items.map((item, index) => {
            const dragging = drag?.id === item.id;
            const visualIndex = drag
              ? shiftedSortableIndex(index, drag.startIndex, drag.targetIndex)
              : index;
            const top = dragging
              ? index * rowHeight + drag.offset
              : visualIndex * rowHeight;
            const style: CSSProperties = {
              height: rowHeight,
              transform: `translate3d(0, ${top}px, 0)`,
              zIndex: dragging ? items.length + 2 : index + 1,
            };

            return (
              <li
                key={item.id}
                className={cn(
                  'absolute inset-x-0 top-0 flex items-center',
                  dragging
                    ? 'will-change-transform'
                    : 'transition-transform duration-150 ease-out motion-reduce:transition-none',
                )}
                style={style}
              >
                {children(item, index, handleProps(item, index), dragging)}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Edge fades signal that rows continue past the clip, which a hard cut
          at the scroller boundary otherwise hides. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-4 bg-linear-to-b from-surface to-transparent transition-opacity duration-150 motion-reduce:transition-none',
          overflow.top ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-surface to-transparent transition-opacity duration-150 motion-reduce:transition-none',
          overflow.bottom ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
