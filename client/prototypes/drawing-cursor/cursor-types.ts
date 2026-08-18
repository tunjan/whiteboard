import type { RefObject } from 'react';

export interface CursorVariantProps {
  brushSize: number;
  color: string;
  cursorRef: RefObject<HTMLDivElement | null>;
}
