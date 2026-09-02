import { useEffect, type RefObject } from 'react';
import { getContainerRect } from '@/canvas/container-rect';

/**
 * Drive an absolutely-positioned element as a custom cursor over `container`.
 *
 * The element follows the pointer by writing `transform` and `opacity` directly,
 * never through React state — a hover preview that re-rendered the canvas on
 * every pointermove would cost more than the tool it belongs to. It hides for
 * touch (no hover to preview), for the floating UI layers, and once the pointer
 * leaves the container.
 */
export function useHoverCursor(
  containerRef: RefObject<HTMLDivElement | null>,
  cursorRef: RefObject<HTMLDivElement | null>,
): void {
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

      const rect = getContainerRect(container);
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
  }, [containerRef, cursorRef]);
}
