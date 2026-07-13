import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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

export type SortableHandleProps = {
  'aria-label': string;
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
  getItemLabel,
  onReorder,
  children,
}: {
  items: T[];
  height: number;
  rowHeight: number;
  disabled?: boolean;
  label: string;
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

  itemCountRef.current = items.length;

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
    'aria-label': `Reorder ${getItemLabel(item)}`,
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
  }, [drag, items]);

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto overscroll-contain px-1"
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
  );
}
