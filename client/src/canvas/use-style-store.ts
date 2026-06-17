import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  FillStyle,
  FontFamily,
  PolygonKind,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';

export interface PaletteColor {
  name: string;
  value: string;
}

// One restrained, readable palette laid out as a 4×2 grid. "Ink" is a theme
// token so it adapts to light/dark; the rest are concrete so they stay
// identical across themes. Kept muted/earthy on purpose — calm, not candy.
export const COLOR_PALETTE: PaletteColor[] = [
  { name: 'Ink', value: 'var(--color-foreground)' },
  { name: 'Charcoal', value: '#3f3f46' },
  { name: 'Slate', value: '#64748b' },
  { name: 'Soft Indigo', value: '#7382c6' },
  { name: 'Terracotta', value: '#c2593f' },
  { name: 'Amber', value: '#c2913f' },
  { name: 'Sage Green', value: '#829c87' },
  { name: 'Teal', value: '#4f8a8b' },
];

export interface SizeOption {
  name: string;
  value: number;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { name: 'S', value: 2 },
  { name: 'M', value: 4 },
  { name: 'L', value: 8 },
  { name: 'XL', value: 16 },
];

interface StyleStore {
  /** Current stroke color for new shapes (and the last applied). */
  color: string;
  /** Current stroke width for new shapes. */
  size: number;
  /** Current fill style for fillable shapes. */
  fill: FillStyle;
  /** Current stroke dash style. */
  dash: StrokeDash;
  /**
   * Current opacity (0–1) reflected by the style panel. Local-only for now —
   * the slider is wired to this value but shape rendering does not yet consume
   * it (opacity is not part of the shape model). TODO: thread through shape
   * props + render once the data model gains an `opacity` field.
   */
  opacity: number;
  /** Whether new arrows draw an arrowhead at the start point. */
  arrowStart: boolean;
  /** Whether new arrows draw an arrowhead at the end point. */
  arrowEnd: boolean;
  /** Current polygon kind for the polygon tool. */
  polygonKind: PolygonKind;
  /** Current font family for new/edited text. */
  fontFamily: FontFamily;
  /** Current horizontal alignment for new/edited text. */
  align: TextAlign;
  setColor: (color: string) => void;
  setSize: (size: number) => void;
  setFill: (fill: FillStyle) => void;
  setDash: (dash: StrokeDash) => void;
  setOpacity: (opacity: number) => void;
  setArrowStart: (arrowStart: boolean) => void;
  setArrowEnd: (arrowEnd: boolean) => void;
  setPolygonKind: (kind: PolygonKind) => void;
  setFontFamily: (family: FontFamily) => void;
  setAlign: (align: TextAlign) => void;
}

// Current drawing style — used as defaults for new shapes and reflected by the
// style panel. Persisted locally.
export const useStyleStore = create<StyleStore>()(
  persist(
    (set) => ({
      color: 'var(--color-foreground)',
      size: 4,
      fill: 'none',
      dash: 'solid',
      opacity: 1,
      arrowStart: false,
      arrowEnd: true,
      polygonKind: 'triangle',
      fontFamily: 'sans',
      align: 'start',
      setColor: (color) => set({ color }),
      setSize: (size) => set({ size }),
      setFill: (fill) => set({ fill }),
      setDash: (dash) => set({ dash }),
      setOpacity: (opacity) => set({ opacity }),
      setArrowStart: (arrowStart) => set({ arrowStart }),
      setArrowEnd: (arrowEnd) => set({ arrowEnd }),
      setPolygonKind: (polygonKind) => set({ polygonKind }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setAlign: (align) => set({ align }),
    }),
    { name: 'whiteboard:style' },
  ),
);
