import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  FillStyle,
  FontFamily,
  PolygonKind,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import type { Theme } from '@/use-theme-store';

export interface PaletteColor {
  name: string;
  value: string;
}

// A drawing palette carries a fixed 4×2 set of swatches for each theme, so the
// pen always has colors that read against the current canvas. Light variants are
// tuned for the light canvas; dark variants are brightened to read on the dark one.
export interface Palette {
  id: string;
  name: string;
  light: PaletteColor[];
  dark: PaletteColor[];
}

export const PALETTES: Palette[] = [
  {
    id: 'classic',
    name: 'Classic',
    light: [
      { name: 'Forest Green', value: '#274001' },
      { name: 'Olive', value: '#828a00' },
      { name: 'Golden Yellow', value: '#f29f05' },
      { name: 'Orange', value: '#f25c05' },
      { name: 'Rose', value: '#d6568c' },
      { name: 'Teal', value: '#4d8584' },
      { name: 'Rust', value: '#a62f03' },
      { name: 'Dark Brown', value: '#400d01' },
    ],
    dark: [
      { name: 'Forest Green', value: '#7cae3f' },
      { name: 'Olive', value: '#c2cb3f' },
      { name: 'Golden Yellow', value: '#ffc04d' },
      { name: 'Orange', value: '#ff7a3d' },
      { name: 'Rose', value: '#ec84ad' },
      { name: 'Teal', value: '#6fb3b1' },
      { name: 'Rust', value: '#e0613a' },
      { name: 'Tan', value: '#b07a5e' },
    ],
  },
  {
    id: 'vibrant',
    name: 'Vibrant',
    light: [
      { name: 'Red', value: '#e11d48' },
      { name: 'Orange', value: '#ea580c' },
      { name: 'Amber', value: '#f59e0b' },
      { name: 'Green', value: '#16a34a' },
      { name: 'Cyan', value: '#0891b2' },
      { name: 'Blue', value: '#2563eb' },
      { name: 'Violet', value: '#7c3aed' },
      { name: 'Pink', value: '#db2777' },
    ],
    dark: [
      { name: 'Red', value: '#fb7185' },
      { name: 'Orange', value: '#fb923c' },
      { name: 'Amber', value: '#fbbf24' },
      { name: 'Green', value: '#4ade80' },
      { name: 'Cyan', value: '#22d3ee' },
      { name: 'Blue', value: '#60a5fa' },
      { name: 'Violet', value: '#a78bfa' },
      { name: 'Pink', value: '#f472b6' },
    ],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    light: [
      { name: 'Coral', value: '#e57373' },
      { name: 'Peach', value: '#f0a868' },
      { name: 'Butter', value: '#e6c35c' },
      { name: 'Sage', value: '#81c784' },
      { name: 'Aqua', value: '#4db6ac' },
      { name: 'Sky', value: '#64b5f6' },
      { name: 'Lavender', value: '#9575cd' },
      { name: 'Blossom', value: '#f06ba8' },
    ],
    dark: [
      { name: 'Coral', value: '#f4a3a3' },
      { name: 'Peach', value: '#f8c89b' },
      { name: 'Butter', value: '#f0dd9a' },
      { name: 'Sage', value: '#aed9b0' },
      { name: 'Aqua', value: '#8fd3cb' },
      { name: 'Sky', value: '#a0d2fb' },
      { name: 'Lavender', value: '#c4b0e6' },
      { name: 'Blossom', value: '#f7a8cf' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    light: [
      { name: 'Pink', value: '#e6005c' },
      { name: 'Orange', value: '#e64a00' },
      { name: 'Lime', value: '#b8b800' },
      { name: 'Green', value: '#00b34d' },
      { name: 'Cyan', value: '#00b3b3' },
      { name: 'Blue', value: '#0066ff' },
      { name: 'Purple', value: '#7a00cc' },
      { name: 'Magenta', value: '#cc007a' },
    ],
    dark: [
      { name: 'Pink', value: '#ff1a75' },
      { name: 'Orange', value: '#ff7a1a' },
      { name: 'Lime', value: '#eaff00' },
      { name: 'Green', value: '#00ff85' },
      { name: 'Cyan', value: '#00f0ff' },
      { name: 'Blue', value: '#4d94ff' },
      { name: 'Purple', value: '#b366ff' },
      { name: 'Magenta', value: '#ff4dd2' },
    ],
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    light: [
      { name: 'Near Black', value: '#0a0a0a' },
      { name: 'Charcoal', value: '#262626' },
      { name: 'Dark Gray', value: '#404040' },
      { name: 'Gray', value: '#525252' },
      { name: 'Medium Gray', value: '#666666' },
      { name: 'Slate', value: '#808080' },
      { name: 'Light Gray', value: '#999999' },
      { name: 'Silver', value: '#b3b3b3' },
    ],
    dark: [
      { name: 'Near White', value: '#fafafa' },
      { name: 'Off White', value: '#e5e5e5' },
      { name: 'Light Gray', value: '#cccccc' },
      { name: 'Silver', value: '#b3b3b3' },
      { name: 'Gray', value: '#999999' },
      { name: 'Slate', value: '#808080' },
      { name: 'Dark Gray', value: '#666666' },
      { name: 'Charcoal', value: '#525252' },
    ],
  },
];

// The swatches shown for a palette under the active theme (falls back to the
// first palette for an unknown id).
export function paletteColors(paletteId: string, theme: Theme): PaletteColor[] {
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]!;
  return theme === 'dark' ? palette.dark : palette.light;
}

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
   * Current opacity (0–1) for new shapes, reflected by the style panel. Applied
   * to a shape's `opacity` field at creation and editable on the selection; the
   * canvas compounds it with ancestor opacities at render time.
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
  /** Selected drawing palette id (theme-aware swatch set). */
  paletteId: string;
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
  setPaletteId: (id: string) => void;
}

// Current drawing style — used as defaults for new shapes and reflected by the
// style panel. Persisted locally.
export const useStyleStore = create<StyleStore>()(
  persist(
    (set) => ({
      color: '#274001',
      size: 4,
      fill: 'none',
      dash: 'solid',
      opacity: 1,
      arrowStart: false,
      arrowEnd: true,
      polygonKind: 'triangle',
      fontFamily: 'sans',
      align: 'start',
      paletteId: 'classic',
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
      setPaletteId: (paletteId) => set({ paletteId }),
    }),
    { name: 'whiteboard:style' },
  ),
);
