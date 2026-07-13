import { useEffect, useRef, type RefObject } from 'react';
import type { Camera } from './camera';
import { useStyleStore } from './use-style-store';

interface DrawingCursorProps {
  camera: Camera;
  containerRef: RefObject<HTMLDivElement | null>;
}

/** A quiet brush preview that follows mouse and pen hover without re-rendering. */
export function DrawingCursor({ camera, containerRef }: DrawingCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const color = useStyleStore((state) => state.color);
  const size = useStyleStore((state) => state.size);
  const brushSize = Math.max(3, Math.min(size * camera.z, 40));
  const previewSize = Math.max(18, brushSize + 8);

  useEffect(() => {
    const container = containerRef.current;
    const cursor = cursorRef.current;
    if (!container || !cursor) return;

    const hide = () => {
      cursor.style.opacity = '0';
    };
    const position = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        event.pointerType === 'touch' ||
        !target ||
        !container.contains(target) ||
        target.closest('[data-ui-layer]')
      ) {
        hide();
        return;
      }

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || x >= rect.width || y < 0 || y >= rect.height) {
        hide();
        return;
      }

      cursor.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      cursor.style.opacity = '1';
    };

    container.addEventListener('pointerenter', position, { passive: true });
    container.addEventListener('pointerleave', hide, { passive: true });
    window.addEventListener('pointermove', position, { passive: true });
    return () => {
      container.removeEventListener('pointerenter', position);
      container.removeEventListener('pointerleave', hide);
      window.removeEventListener('pointermove', position);
    };
  }, [containerRef]);

  return (
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 grid place-items-center rounded-full border border-background bg-background/80 opacity-0 ring-1 ring-foreground/25 will-change-transform"
      style={{ width: previewSize, height: previewSize }}
    >
      <span
        className="block rounded-full opacity-20"
        style={{ width: brushSize, height: brushSize, backgroundColor: color }}
      />
      <span
        className="absolute block size-1 rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
