import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

/**
 * Track an element's content-box size via ResizeObserver. Returns a ref to
 * attach and the current size.
 */
export function useElementSize<T extends HTMLElement>(): [
  RefObject<T | null>,
  Size,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Bail on no-op notifications. A modal dialog's scroll lock toggles
      // `body { overflow: hidden }`, which fires the observer with unchanged
      // dimensions; returning a fresh object there would re-render the whole
      // canvas for nothing.
      setSize((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}
