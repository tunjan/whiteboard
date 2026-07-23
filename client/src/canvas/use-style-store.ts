import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  PolygonKind,
  StrokeDash,
  TextAlign,
  LineSpline,
} from '@whiteboard/shared';
import type { Theme } from '@/use-theme-store';

export interface PaletteColor {
  name: string;
  value: string;
}

// A drawing palette carries a fixed 4×3 set of swatches for each theme, so the
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
      { name: 'Moss', value: 'oklch(0.48 0.1 120)' },
      { name: 'Terracotta', value: 'oklch(0.55 0.14 45)' },
      { name: 'Plum', value: 'oklch(0.46 0.12 330)' },
      { name: 'Navy', value: 'oklch(0.38 0.09 250)' },
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
      { name: 'Moss', value: 'oklch(0.72 0.11 120)' },
      { name: 'Terracotta', value: 'oklch(0.72 0.13 45)' },
      { name: 'Plum', value: 'oklch(0.72 0.12 330)' },
      { name: 'Navy', value: 'oklch(0.7 0.1 250)' },
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
      { name: 'Lime', value: 'oklch(0.68 0.18 125)' },
      { name: 'Turquoise', value: 'oklch(0.6 0.15 175)' },
      { name: 'Indigo', value: 'oklch(0.48 0.21 275)' },
      { name: 'Purple', value: 'oklch(0.52 0.22 310)' },
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
      { name: 'Lime', value: 'oklch(0.82 0.17 125)' },
      { name: 'Turquoise', value: 'oklch(0.8 0.14 175)' },
      { name: 'Indigo', value: 'oklch(0.72 0.18 275)' },
      { name: 'Purple', value: 'oklch(0.74 0.18 310)' },
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
      { name: 'Mint', value: 'oklch(0.78 0.09 145)' },
      { name: 'Seafoam', value: 'oklch(0.76 0.08 185)' },
      { name: 'Periwinkle', value: 'oklch(0.72 0.1 270)' },
      { name: 'Lilac', value: 'oklch(0.74 0.09 315)' },
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
      { name: 'Mint', value: 'oklch(0.86 0.08 145)' },
      { name: 'Seafoam', value: 'oklch(0.85 0.07 185)' },
      { name: 'Periwinkle', value: 'oklch(0.82 0.09 270)' },
      { name: 'Lilac', value: 'oklch(0.84 0.08 315)' },
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
      { name: 'Scarlet', value: 'oklch(0.58 0.25 25)' },
      { name: 'Yellow', value: 'oklch(0.78 0.18 95)' },
      { name: 'Electric Indigo', value: 'oklch(0.5 0.27 285)' },
      { name: 'Hot Purple', value: 'oklch(0.58 0.25 325)' },
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
      { name: 'Scarlet', value: 'oklch(0.72 0.23 25)' },
      { name: 'Yellow', value: 'oklch(0.9 0.18 95)' },
      { name: 'Electric Indigo', value: 'oklch(0.7 0.23 285)' },
      { name: 'Hot Purple', value: 'oklch(0.74 0.22 325)' },
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
      { name: 'Graphite', value: 'oklch(0.22 0 0)' },
      { name: 'Iron', value: 'oklch(0.32 0 0)' },
      { name: 'Ash', value: 'oklch(0.52 0 0)' },
      { name: 'Pearl', value: 'oklch(0.82 0 0)' },
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
      { name: 'Cloud', value: 'oklch(0.94 0 0)' },
      { name: 'Mist', value: 'oklch(0.88 0 0)' },
      { name: 'Pewter', value: 'oklch(0.72 0 0)' },
      { name: 'Graphite', value: 'oklch(0.42 0 0)' },
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
  /** Geometry inherited by newly created arrows. */
  arrowTopology: ArrowTopology;
  /** Interpolation inherited by newly created lines. */
  lineSpline: LineSpline;
  /** Current polygon kind for the polygon tool. */
  polygonKind: PolygonKind;
  /** Current font family for new/edited text. */
  fontFamily: FontFamily;
  /** Current font weight for new/edited text. */
  fontWeight: FontWeight;
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
  setArrowTopology: (arrowTopology: ArrowTopology) => void;
  setLineSpline: (lineSpline: LineSpline) => void;
  setPolygonKind: (kind: PolygonKind) => void;
  setFontFamily: (family: FontFamily) => void;
  setFontWeight: (weight: FontWeight) => void;
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
      arrowTopology: 'straight',
      lineSpline: 'linear',
      polygonKind: 'triangle',
      fontFamily: 'sans',
      fontWeight: 400,
      align: 'start',
      paletteId: 'classic',
      setColor: (color) => set({ color }),
      setSize: (size) => set({ size }),
      setFill: (fill) => set({ fill }),
      setDash: (dash) => set({ dash }),
      setOpacity: (opacity) => set({ opacity }),
      setArrowStart: (arrowStart) => set({ arrowStart }),
      setArrowEnd: (arrowEnd) => set({ arrowEnd }),
      setArrowTopology: (arrowTopology) => set({ arrowTopology }),
      setLineSpline: (lineSpline) => set({ lineSpline }),
      setPolygonKind: (polygonKind) => set({ polygonKind }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontWeight: (fontWeight) => set({ fontWeight }),
      setAlign: (align) => set({ align }),
      setPaletteId: (paletteId) => set({ paletteId }),
    }),
    { name: 'whiteboard:style' },
  ),
);
