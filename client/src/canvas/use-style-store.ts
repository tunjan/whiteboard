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
import { BASE_STROKE_WIDTH, STROKE_SIZES } from './shapes/style';

export interface PaletteColor {
  name: string;
  value: string;
}

// The drawing palette carries one swatch set per theme, so the pen always has
// colors that read against the current canvas. Light variants are tuned for the
// light canvas; dark variants are brightened to read on the dark one.
export interface Palette {
  light: PaletteColor[];
  dark: PaletteColor[];
}

/*
 * Slot N carries the same color in both themes, which is what lets the theme
 * switch remap the pen by slot index without the color changing hue: several
 * hues (violet, green, red) are already legible on both canvases and repeat
 * their value, while the rest are lifted for the dark canvas.
 *
 * Slot 0 is the exception and the only slot named differently per theme: it is
 * the ink swatch, so it holds black on the light canvas and white on the dark
 * one. The counterpart — white on light, black on dark — would be invisible
 * against its own canvas, so it is not offered at all; that leaves twelve
 * swatches in either theme, which is also what the 4-column grid expects.
 * These two values are also the `--ink` token in index.css, which is what
 * repaints a stored stroke for a viewer on the other theme (`ink-color.ts`);
 * change one and the other has to follow.
 *
 * Values are written as sRGB hex — one format across every swatch — because a
 * color here also has to survive `color-mix` in the swatch borders and the
 * standalone SVG the PNG export rasterizes.
 */
export const PALETTE: Palette = {
  light: [
    { name: 'Black', value: '#1d1d1d' },
    { name: 'Grey', value: '#9fa8b2' },
    { name: 'Light violet', value: '#e085f4' },
    { name: 'Violet', value: '#ae3ec9' },
    { name: 'Blue', value: '#4465e9' },
    { name: 'Light blue', value: '#4ba1f1' },
    { name: 'Yellow', value: '#f1ac4b' },
    { name: 'Orange', value: '#e16919' },
    { name: 'Green', value: '#099268' },
    { name: 'Light green', value: '#4cb05e' },
    { name: 'Light red', value: '#f87777' },
    { name: 'Red', value: '#e03131' },
  ],
  dark: [
    { name: 'White', value: '#f3f3f3' },
    { name: 'Grey', value: '#9398b0' },
    { name: 'Light violet', value: '#e599f7' },
    { name: 'Violet', value: '#ae3ec9' },
    { name: 'Blue', value: '#4f72fc' },
    { name: 'Light blue', value: '#4dabf7' },
    { name: 'Yellow', value: '#ffc034' },
    { name: 'Orange', value: '#f76707' },
    { name: 'Green', value: '#099268' },
    { name: 'Light green', value: '#40c057' },
    { name: 'Light red', value: '#ff8787' },
    { name: 'Red', value: '#e03131' },
  ],
};

/** The swatches shown under the active theme. */
export function paletteColors(theme: Theme): PaletteColor[] {
  return theme === 'dark' ? PALETTE.dark : PALETTE.light;
}

export interface SizeOption {
  name: string;
  value: number;
}

export const SIZE_OPTIONS: SizeOption[] = [
  { name: 'S', value: BASE_STROKE_WIDTH * STROKE_SIZES.s },
  { name: 'M', value: BASE_STROKE_WIDTH * STROKE_SIZES.m },
  { name: 'L', value: BASE_STROKE_WIDTH * STROKE_SIZES.l },
  { name: 'XL', value: BASE_STROKE_WIDTH * STROKE_SIZES.xl },
];

/**
 * The style new shapes inherit, shared by every tool that draws one.
 *
 * One set rather than one per instrument: choosing a colour chooses *the*
 * colour, so the rectangle tool lays down whatever the pen was last set to and
 * the highlighter washes in it too. Only a control the user actually moved
 * writes here — selecting a shape shows that shape's style on the bar without
 * changing what the next one will be drawn with.
 */
export interface NextShapeStyle {
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
}

interface StyleStore extends NextShapeStyle {
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
}

/** Palette slot every tool opens on: the ink swatch. */
const DEFAULT_COLOR = PALETTE.light[0]!.value;

/** The style a board opens on, before anyone has touched a control. */
export function defaultStyle(): NextShapeStyle {
  return {
    color: DEFAULT_COLOR,
    size: BASE_STROKE_WIDTH,
    fill: 'none',
    dash: 'solid',
    opacity: 1,
  };
}

// Current drawing style — used as defaults for new shapes and reflected by the
// style panel. Persisted locally.
export const useStyleStore = create<StyleStore>()(
  persist(
    (set) => ({
      ...defaultStyle(),
      arrowStart: false,
      arrowEnd: true,
      arrowTopology: 'straight',
      lineSpline: 'linear',
      polygonKind: 'triangle',
      stickerId: 'thumbs-up',
      fontFamily: 'sans',
      fontWeight: 400,
      align: 'start',
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
    }),
    {
      name: 'whiteboard:style',
      version: 2,
      migrate: migrateStyle,
    },
  ),
);

/** Read the style new shapes inherit outside React. */
export function nextShapeStyle(): NextShapeStyle {
  const { color, size, fill, dash, opacity } = useStyleStore.getState();
  return { color, size, fill, dash, opacity };
}

/** Whatever of a stored style is usable, over the defaults for the rest. */
function carry(source: Partial<NextShapeStyle> | undefined): NextShapeStyle {
  return {
    ...defaultStyle(),
    ...(typeof source?.color === 'string' ? { color: source.color } : null),
    ...(typeof source?.size === 'number' ? { size: source.size } : null),
    ...(source?.fill ? { fill: source.fill } : null),
    ...(source?.dash ? { dash: source.dash } : null),
    ...(typeof source?.opacity === 'number'
      ? { opacity: source.opacity }
      : null),
  };
}

/**
 * v0 kept one flat set of values for every tool; v1 split them per instrument.
 *
 * The split is gone again, so a v1 store collapses back onto the pen's values —
 * of the four groups that is the one carrying what someone was last actually
 * drawing with. v0 already stored the flat set under these names.
 */
export function migrateStyle(persisted: unknown, version: number): StyleStore {
  if (version >= 2) return persisted as StyleStore;
  if (version === 1) {
    const { groups, ...rest } = (persisted ?? {}) as {
      groups?: Record<string, Partial<NextShapeStyle>>;
    };
    return { ...rest, ...carry(groups?.pen) } as StyleStore;
  }
  const { color, size, fill, dash, opacity, ...rest } = (persisted ??
    {}) as Partial<NextShapeStyle> & Record<string, unknown>;
  return {
    ...rest,
    ...carry({ color, size, fill, dash, opacity }),
  } as StyleStore;
}
