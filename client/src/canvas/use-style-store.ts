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
import { useThemeStore, type Theme } from '@/use-theme-store';
import { BASE_STROKE_WIDTH, STROKE_SIZES } from './shapes/style';
import { useToolStore } from './use-tool-store';

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
    { name: 'Yellow', value: '#f2c12e' },
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

/** Ink, the six strong hues in wheel order, grey. */
const QUICK_SLOTS = [0, 11, 7, 6, 8, 4, 3, 1];
/** The light variants, in the same wheel order as their strong partners. */
const LIGHT_SLOTS = [10, 9, 5, 2];

/**
 * The eight colours on the style bar's ramp, and on keys 1–8: ink, then the
 * strong hues in wheel order, then grey.
 */
export function quickSwatches(colors: PaletteColor[]): PaletteColor[] {
  return QUICK_SLOTS.flatMap((slot) => colors[slot] ?? []);
}

/**
 * The whole palette in the one order every colour surface uses: the quick
 * ramp, then the light variants following the same hue order.
 */
export function allSwatches(colors: PaletteColor[]): PaletteColor[] {
  return [...quickSwatches(colors), ...LIGHT_SLOTS.flatMap((slot) => colors[slot] ?? [])];
}

/** Palette values since changed, so a saved style or ramp keeps its slot. */
const RETIRED: Record<string, string> = { '#f1ac4b': '#f2c12e' };

/** A palette colour from either theme, as `theme` draws it; anything else as is. */
export function inCurrentTheme(
  color: string,
  theme: Theme = useThemeStore.getState().theme,
): string {
  const current = paletteColors(theme);
  const known = RETIRED[color] ?? color;
  if (current.some((c) => c.value === known)) return known;
  const slot = [...PALETTE.light, ...PALETTE.dark].findIndex(
    (c) => c.value === known,
  );
  return slot >= 0 ? current[slot % current.length]!.value : color;
}

/** The toolbar's colours before the user has changed them, as stored values. */
const DEFAULT_RAMP = allSwatches(PALETTE.light).map((c) => c.value);

/**
 * The colours on the toolbar, in the user's order and drawn for `theme`.
 * Palette colours follow the theme; a colour the user picked stays as picked.
 */
export function rampColors(
  ramp: string[] | null,
  theme: Theme,
): PaletteColor[] {
  const palette = paletteColors(theme);
  return (ramp ?? DEFAULT_RAMP).map((stored) => {
    const value = inCurrentTheme(stored, theme);
    return {
      value,
      name: palette.find((c) => c.value === value)?.name ?? value.toUpperCase(),
    };
  });
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
 * The style new shapes inherit.
 *
 * Kept per group of tools (see `StyleSlot`). Only a control the user actually
 * moved writes here — selecting a shape shows that shape's style on the bar
 * without changing what the next one will be drawn with.
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

/**
 * The groups of tools that keep a style of their own. A setting is shared
 * inside a group and never between two: tools that go together in one drawing
 * should match, and tools swapped between mid-lesson should not disturb each
 * other. A tutor writes in black and highlights in yellow, a dashed rectangle
 * must not dash the next pen stroke, and labels stay black on a coloured
 * diagram. Equations read as text; shapes, lines and arrows are the diagram.
 */
export type StyleSlot = 'pen' | 'highlighter' | 'diagram' | 'text' | 'frame';

/** Tools with no style to keep leave the live one where it is. */
const UNSTYLED_TOOLS = new Set(['select', 'hand', 'laser', 'eraser', 'sticker']);

export function styleSlot(toolId: string): StyleSlot | null {
  if (toolId === 'draw') return 'pen';
  if (toolId === 'highlighter') return 'highlighter';
  if (toolId === 'text' || toolId === 'equation') return 'text';
  if (toolId === 'frame') return 'frame';
  return UNSTYLED_TOOLS.has(toolId) ? null : 'diagram';
}

/** The style `slot` lays down: live, put away, or as it opens on first use. */
function resolveSlot(
  state: Pick<StyleStore, keyof NextShapeStyle | 'slot' | 'slots'>,
  slot: StyleSlot,
): NextShapeStyle {
  if (slot === state.slot) return pickStyle(state);
  const saved = state.slots[slot];
  if (saved) return { ...saved, color: inCurrentTheme(saved.color) };
  const base = { ...defaultStyle(), color: inCurrentTheme(DEFAULT_COLOR) };
  switch (slot) {
    case 'highlighter':
      return {
        ...base,
        color: inCurrentTheme(PALETTE.light[6]!.value),
        size: SIZE_OPTIONS[1]!.value,
      };
    case 'frame':
      return { ...base, color: inCurrentTheme(PALETTE.light[1]!.value) };
    case 'diagram': {
      // Takes after the pen, not whatever happens to be live: a first
      // rectangle drawn after highlighting should not come out yellow.
      const { color, size } = resolveSlot(state, 'pen');
      return { ...base, color, size };
    }
    default:
      return base;
  }
}

/** The colour a tool will draw in, whether or not it is the active one. */
export function slotColor(
  state: Pick<StyleStore, keyof NextShapeStyle | 'slot' | 'slots'>,
  slot: StyleSlot,
): string {
  return resolveSlot(state, slot).color;
}

interface StyleStore extends NextShapeStyle {
  /** The slot the live style belongs to. */
  slot: StyleSlot;
  /** The other slots' styles, put away while they are not live. */
  slots: Partial<Record<StyleSlot, NextShapeStyle>>;
  /** Put the live style away and take out `slot`'s. */
  enterSlot: (slot: StyleSlot) => void;
  /** The toolbar's colours, as the user arranged them; null for the default. */
  ramp: string[] | null;
  /** Put a colour on the toolbar, at the end; a colour already there stays put. */
  addRampColor: (color: string) => void;
  removeRampColor: (index: number) => void;
  /** Move the colour at `from` to `to`, shifting the ones between. */
  moveRampColor: (from: number, to: number) => void;
  resetRamp: () => void;
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
      slot: 'pen',
      slots: {},
      enterSlot: (slot) =>
        set((state) => {
          if (slot === state.slot) return state;
          return {
            slot,
            slots: { ...state.slots, [state.slot]: pickStyle(state) },
            ...resolveSlot(state, slot),
          };
        }),
      ramp: null,
      addRampColor: (color) =>
        set((state) => {
          const ramp = state.ramp ?? DEFAULT_RAMP;
          const value = inCurrentTheme(color.toLowerCase());
          if (ramp.some((stored) => inCurrentTheme(stored) === value)) return state;
          return { ramp: [...ramp, value] };
        }),
      removeRampColor: (index) =>
        set((state) => {
          const ramp = state.ramp ?? DEFAULT_RAMP;
          // The bar always keeps one colour to draw with.
          if (ramp.length <= 1) return state;
          return { ramp: ramp.filter((_, i) => i !== index) };
        }),
      moveRampColor: (from, to) =>
        set((state) => {
          const ramp = [...(state.ramp ?? DEFAULT_RAMP)];
          if (from === to || !(from in ramp) || !(to in ramp)) return state;
          const [moved] = ramp.splice(from, 1);
          ramp.splice(to, 0, moved!);
          return { ramp };
        }),
      resetRamp: () => set({ ramp: null }),
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
      version: 3,
      migrate: migrateStyle,
    },
  ),
);

// Switching tools swaps in that group's style, by click, key or spring-hold
// alike.
useToolStore.subscribe((state) => {
  const slot = styleSlot(state.activeToolId);
  if (slot) useStyleStore.getState().enterSlot(slot);
});

function pickStyle(source: NextShapeStyle): NextShapeStyle {
  const { color, size, fill, dash, opacity } = source;
  return { color, size, fill, dash, opacity };
}

/** Read the style new shapes inherit outside React. */
export function nextShapeStyle(): NextShapeStyle {
  return pickStyle(useStyleStore.getState());
}

/** The same for a group that may not be the live one. */
export function slotStyle(slot: StyleSlot): NextShapeStyle {
  return resolveSlot(useStyleStore.getState(), slot);
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
 * That split was undone, so a v1 store collapses back onto the pen's values —
 * of the four groups that is the one carrying what someone was last actually
 * drawing with. v0 already stored the flat set under these names.
 *
 * v2 kept colour and size per slot and shared the rest. Each slot takes a copy
 * of the shared values, so nothing someone has set changes under them; `other`
 * becomes the diagram, and text and frames open on their own defaults.
 */
export function migrateStyle(persisted: unknown, version: number): StyleStore {
  if (version >= 3) return persisted as StyleStore;
  if (version === 2) {
    const v2 = persisted as NextShapeStyle & {
      slot?: string;
      slots?: Record<string, Partial<NextShapeStyle>>;
    };
    const renamed = (slot: string) => (slot === 'other' ? 'diagram' : slot);
    const { fill, dash, opacity } = v2;
    return {
      ...v2,
      slot: renamed(v2.slot ?? 'pen'),
      slots: Object.fromEntries(
        Object.entries(v2.slots ?? {}).map(([slot, style]) => [
          renamed(slot),
          carry({ ...style, fill, dash, opacity }),
        ]),
      ),
    } as StyleStore;
  }
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
