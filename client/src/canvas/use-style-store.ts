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

/*
 * Every palette below is generated from one rule so its twelve swatches read as
 * a set rather than twelve separate picks:
 *
 *   - Hues are evenly spaced — 25° to 355° in 30° steps of OKLCH hue — so no
 *     region of the wheel is crowded while another goes unrepresented. Slot N
 *     carries the same name in both themes of a palette, which is what lets the
 *     theme switch remap the pen by slot index without the color changing hue.
 *     Classic and Grayscale are themed sets and define their own slots; see the
 *     note on each.
 *   - Within one palette+theme, OKLCH lightness is constant. Uniform lightness
 *     is what makes a set look congruent: no swatch reads heavier or fainter
 *     than its neighbours, and every swatch holds roughly the same contrast
 *     against its canvas.
 *   - Chroma is constant too, except where sRGB cannot reach it at that
 *     lightness (cyan and blue run out first), in which case it sits on the
 *     gamut edge. Neon asks for more chroma than sRGB has at any hue, so all
 *     twelve of its swatches sit on that edge by design.
 *
 * The palettes are separated from each other by chroma more than lightness:
 * Classic L.55/C.10 (muted naturals), Vibrant L.56/C.20, Neon L.62/max,
 * Pastel L.72/C.08 — and the dark variants keep the same ordering, shifted up.
 * Grayscale is the same idea with no chroma: an even lightness ramp.
 *
 * Values are written as sRGB hex — one format across every swatch — because a
 * color here also has to survive `color-mix` in the swatch borders and the
 * standalone SVG the PNG export rasterizes.
 */
export const PALETTES: Palette[] = [
  {
    id: 'classic',
    name: 'Classic',
    // The one palette that keeps its own hue set rather than the even wheel:
    // Classic is the forest/earth palette, so its hues are weighted toward the
    // canopy greens (the whole first row of the grid) and the warm earths, with
    // only four cool accents for the range a drawing palette still needs. The
    // sweep runs 120° → 320° → 25° → 105°, i.e. continuous around the wheel but
    // entered at the greens so the default pen lands on Moss.
    // L 0.55 / C 0.10 on light, L 0.72 / C 0.10 on dark.
    light: [
      { name: 'Moss', value: '#6a7a31' },
      { name: 'Fern', value: '#49814c' },
      { name: 'Pine', value: '#228466' },
      { name: 'Spruce', value: '#008380' },
      { name: 'Stream', value: '#127d9d' },
      { name: 'Dusk', value: '#5b6eac' },
      { name: 'Heather', value: '#8b5d96' },
      { name: 'Rust', value: '#a45953' },
      { name: 'Terracotta', value: '#a15d3e' },
      { name: 'Amber', value: '#986528' },
      { name: 'Wheat', value: '#8a6e1f' },
      { name: 'Olive', value: '#7a7424' },
    ],
    dark: [
      { name: 'Moss', value: '#9cae65' },
      { name: 'Fern', value: '#7cb57d' },
      { name: 'Pine', value: '#5eb999' },
      { name: 'Spruce', value: '#4ab8b5' },
      { name: 'Stream', value: '#56b2d4' },
      { name: 'Dusk', value: '#8ca2e4' },
      { name: 'Heather', value: '#c190cc' },
      { name: 'Rust', value: '#dc8c85' },
      { name: 'Terracotta', value: '#d9906f' },
      { name: 'Amber', value: '#ce995d' },
      { name: 'Wheat', value: '#bfa157' },
      { name: 'Olive', value: '#aea85b' },
    ],
  },
  {
    id: 'vibrant',
    name: 'Vibrant',
    // L 0.56 / C 0.20 on light, L 0.70 / C 0.15 on dark.
    light: [
      { name: 'Red', value: '#d02b31' },
      { name: 'Orange', value: '#b05a00' },
      { name: 'Amber', value: '#936e00' },
      { name: 'Lime', value: '#737c00' },
      { name: 'Green', value: '#008d24' },
      { name: 'Teal', value: '#008871' },
      { name: 'Cyan', value: '#00848f' },
      { name: 'Blue', value: '#007eb0' },
      { name: 'Indigo', value: '#3968e8' },
      { name: 'Violet', value: '#8151db' },
      { name: 'Magenta', value: '#ab3db3' },
      { name: 'Rose', value: '#c62b7a' },
    ],
    dark: [
      { name: 'Red', value: '#ed756e' },
      { name: 'Orange', value: '#e48233' },
      { name: 'Amber', value: '#c79600' },
      { name: 'Lime', value: '#9ca81f' },
      { name: 'Green', value: '#5bb661' },
      { name: 'Teal', value: '#00b89a' },
      { name: 'Cyan', value: '#00b3c2' },
      { name: 'Blue', value: '#00abed' },
      { name: 'Indigo', value: '#709afb' },
      { name: 'Violet', value: '#a689f1' },
      { name: 'Magenta', value: '#cc7bd1' },
      { name: 'Rose', value: '#e573a3' },
    ],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    // L 0.72 / C 0.08 on light, L 0.88 / C 0.06 on dark.
    light: [
      { name: 'Red', value: '#d2918b' },
      { name: 'Orange', value: '#cc9874' },
      { name: 'Amber', value: '#bca169' },
      { name: 'Lime', value: '#a3ab70' },
      { name: 'Green', value: '#85b286' },
      { name: 'Teal', value: '#6bb5a2' },
      { name: 'Cyan', value: '#63b3bc' },
      { name: 'Blue', value: '#71add0' },
      { name: 'Indigo', value: '#8ca4d8' },
      { name: 'Violet', value: '#a89bd2' },
      { name: 'Magenta', value: '#bf94c0' },
      { name: 'Rose', value: '#cd90a7' },
    ],
    dark: [
      { name: 'Red', value: '#fdc9c4' },
      { name: 'Orange', value: '#f8ceb2' },
      { name: 'Amber', value: '#ead5ab' },
      { name: 'Lime', value: '#d6ddb0' },
      { name: 'Green', value: '#c0e3c0' },
      { name: 'Teal', value: '#afe5d5' },
      { name: 'Cyan', value: '#a9e4ea' },
      { name: 'Blue', value: '#b2dffa' },
      { name: 'Indigo', value: '#c5d8ff' },
      { name: 'Violet', value: '#dad0fc' },
      { name: 'Magenta', value: '#eccbee' },
      { name: 'Rose', value: '#f9c8d9' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon',
    // L 0.62 on light, L 0.78 on dark, both at the sRGB chroma ceiling.
    light: [
      { name: 'Red', value: '#fa002a' },
      { name: 'Orange', value: '#ca6800' },
      { name: 'Amber', value: '#a97f00' },
      { name: 'Lime', value: '#848f00' },
      { name: 'Green', value: '#00a22b' },
      { name: 'Teal', value: '#009d82' },
      { name: 'Cyan', value: '#0098a4' },
      { name: 'Blue', value: '#0091c9' },
      { name: 'Indigo', value: '#487bff' },
      { name: 'Violet', value: '#955bff' },
      { name: 'Magenta', value: '#d500e2' },
      { name: 'Rose', value: '#ee008e' },
    ],
    dark: [
      { name: 'Red', value: '#ff958d' },
      { name: 'Orange', value: '#ff9b51' },
      { name: 'Amber', value: '#e6ad00' },
      { name: 'Lime', value: '#b5c300' },
      { name: 'Green', value: '#00dd3e' },
      { name: 'Teal', value: '#00d5b2' },
      { name: 'Cyan', value: '#00cfe0' },
      { name: 'Blue', value: '#54c4ff' },
      { name: 'Indigo', value: '#95b6ff' },
      { name: 'Violet', value: '#bda7ff' },
      { name: 'Magenta', value: '#f782ff' },
      { name: 'Rose', value: '#ff8dbc' },
    ],
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    // Even lightness ramp, darkest first in both themes: L 0.16→0.68 on light,
    // lifted to L 0.50→0.97 on dark so the low end still clears the canvas.
    light: [
      { name: 'Ink', value: '#0d0d0d' },
      { name: 'Graphite', value: '#181818' },
      { name: 'Charcoal', value: '#232323' },
      { name: 'Iron', value: '#2e2e2e' },
      { name: 'Slate', value: '#3a3a3a' },
      { name: 'Steel', value: '#474747' },
      { name: 'Stone', value: '#535353' },
      { name: 'Ash', value: '#616161' },
      { name: 'Pewter', value: '#6e6e6e' },
      { name: 'Silver', value: '#7c7c7c' },
      { name: 'Mist', value: '#8a8a8a' },
      { name: 'Whisper', value: '#989898' },
    ],
    dark: [
      { name: 'Ink', value: '#636363' },
      { name: 'Graphite', value: '#6f6f6f' },
      { name: 'Charcoal', value: '#7c7c7c' },
      { name: 'Iron', value: '#888888' },
      { name: 'Slate', value: '#959595' },
      { name: 'Steel', value: '#a2a2a2' },
      { name: 'Stone', value: '#b0b0b0' },
      { name: 'Ash', value: '#bdbdbd' },
      { name: 'Pewter', value: '#cbcbcb' },
      { name: 'Silver', value: '#d9d9d9' },
      { name: 'Mist', value: '#e7e7e7' },
      { name: 'Whisper', value: '#f5f5f5' },
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
  /** Catalog id of the sticker the sticker tool stamps. */
  stickerId: string;
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
  setStickerId: (id: string) => void;
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
      color: '#6a7a31',
      size: 4,
      fill: 'none',
      dash: 'solid',
      opacity: 1,
      arrowStart: false,
      arrowEnd: true,
      arrowTopology: 'straight',
      lineSpline: 'linear',
      polygonKind: 'triangle',
      stickerId: 'thumbs-up',
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
      setStickerId: (stickerId) => set({ stickerId }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontWeight: (fontWeight) => set({ fontWeight }),
      setAlign: (align) => set({ align }),
      setPaletteId: (paletteId) => set({ paletteId }),
    }),
    { name: 'whiteboard:style' },
  ),
);
