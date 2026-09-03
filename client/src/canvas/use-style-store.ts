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
 * Which pool of style a tool draws from and writes back to.
 *
 * One global slot meant picking up the highlighter after writing in black gave
 * a black wash, and setting the pen to red set the text tool to red too. These
 * are groups rather than one slot per tool because the boundary people actually
 * notice is the instrument, not the shape: nobody wants the rectangle tool to
 * forget the colour they just gave the ellipse tool.
 */
export type StyleGroup = 'pen' | 'marker' | 'shape' | 'text';

/** The style values a group remembers. Everything else in the store is global. */
export interface GroupStyle {
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

const TOOL_GROUPS: Record<string, StyleGroup> = {
  draw: 'pen',
  highlighter: 'marker',
  text: 'text',
  equation: 'text',
  rectangle: 'shape',
  ellipse: 'shape',
  polygon: 'shape',
  line: 'shape',
  arrow: 'shape',
  frame: 'shape',
  sticker: 'shape',
};

/**
 * Shape types, for the reverse direction: what the style panel reads while a
 * shape is selected, and what an eyedropped style is remembered as.
 *
 * `draw` resolves to the pen even though the highlighter writes draw shapes
 * too — nothing in the schema tells a marker stroke from a pen one (see
 * `draw-tool.ts`), so selecting a highlight remembers its colour as the pen's.
 */
const SHAPE_GROUPS: Record<string, StyleGroup> = {
  draw: 'pen',
  text: 'text',
  equation: 'text',
};

/** The group a tool creates shapes in. Unlisted tools style like a shape. */
export function styleGroupForTool(toolId: string): StyleGroup {
  return TOOL_GROUPS[toolId] ?? 'shape';
}

/** The group a selected shape's style belongs to. */
export function styleGroupForShape(type: string): StyleGroup {
  return SHAPE_GROUPS[type] ?? 'shape';
}

interface StyleStore {
  /** Remembered style per instrument. See {@link StyleGroup}. */
  groups: Record<StyleGroup, GroupStyle>;
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
  setColor: (group: StyleGroup, color: string) => void;
  setSize: (group: StyleGroup, size: number) => void;
  setFill: (group: StyleGroup, fill: FillStyle) => void;
  setDash: (group: StyleGroup, dash: StrokeDash) => void;
  setOpacity: (group: StyleGroup, opacity: number) => void;
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

/** Palette slot every group but the marker opens on: the ink swatch. */
const DEFAULT_COLOR = PALETTE.light[0]!.value;
/**
 * The marker's own slot. A highlighter is yellow until told otherwise — the
 * one group whose useful default is not the ink colour, since a 35% black wash
 * is a smudge rather than a highlight.
 */
const DEFAULT_MARKER_COLOR = PALETTE.light[6]!.value;

function defaultGroup(color = DEFAULT_COLOR): GroupStyle {
  return {
    color,
    size: BASE_STROKE_WIDTH,
    fill: 'none',
    dash: 'solid',
    opacity: 1,
  };
}

/** A fresh set of groups, as a board opens for the first time. */
export function defaultGroups(): Record<StyleGroup, GroupStyle> {
  return {
    pen: defaultGroup(),
    marker: defaultGroup(DEFAULT_MARKER_COLOR),
    shape: defaultGroup(),
    text: defaultGroup(),
  };
}

// Current drawing style — used as defaults for new shapes and reflected by the
// style panel. Persisted locally.
export const useStyleStore = create<StyleStore>()(
  persist(
    (set) => ({
      groups: defaultGroups(),
      arrowStart: false,
      arrowEnd: true,
      arrowTopology: 'straight',
      lineSpline: 'linear',
      polygonKind: 'triangle',
      stickerId: 'thumbs-up',
      fontFamily: 'sans',
      fontWeight: 400,
      align: 'start',
      setColor: (group, color) => set(patchGroup(group, { color })),
      setSize: (group, size) => set(patchGroup(group, { size })),
      setFill: (group, fill) => set(patchGroup(group, { fill })),
      setDash: (group, dash) => set(patchGroup(group, { dash })),
      setOpacity: (group, opacity) => set(patchGroup(group, { opacity })),
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
      version: 1,
      migrate: migrateStyle,
    },
  ),
);

/** Merge `patch` into one group, leaving the others alone. */
function patchGroup(
  group: StyleGroup,
  patch: Partial<GroupStyle>,
): (state: StyleStore) => Partial<StyleStore> {
  return (state) => ({
    groups: { ...state.groups, [group]: { ...state.groups[group], ...patch } },
  });
}

/** Read one group's current style outside React. */
export function groupStyle(group: StyleGroup): GroupStyle {
  return useStyleStore.getState().groups[group];
}

/**
 * v0 kept one flat set of values for every tool.
 *
 * Every group inherits them, so the style someone was last drawing with
 * survives the split — except the marker's colour, which takes its yellow
 * rather than whatever the pen happened to be set to.
 */
export function migrateStyle(persisted: unknown, version: number): StyleStore {
  if (version >= 1) return persisted as StyleStore;
  const { color, size, fill, dash, opacity, ...rest } =
    (persisted ?? {}) as Partial<GroupStyle> & Record<string, unknown>;
  const carried: GroupStyle = {
    ...defaultGroup(),
    ...(typeof color === 'string' ? { color } : null),
    ...(typeof size === 'number' ? { size } : null),
    ...(fill ? { fill } : null),
    ...(dash ? { dash } : null),
    ...(typeof opacity === 'number' ? { opacity } : null),
  };
  return {
    ...rest,
    groups: {
      pen: carried,
      marker: { ...carried, color: DEFAULT_MARKER_COLOR },
      shape: { ...carried },
      text: { ...carried },
    },
  } as StyleStore;
}
