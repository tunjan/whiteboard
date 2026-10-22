import { beforeEach, describe, expect, it } from 'vitest';
import {
  allSwatches,
  defaultStyle,
  migrateStyle,
  nextShapeStyle,
  PALETTE,
  rampColors,
  SIZE_OPTIONS,
  useStyleStore,
} from './use-style-store';
import { useToolStore } from './use-tool-store';

describe('drawing palette', () => {
  // The swatch grid is four columns wide and shows one theme at a time.
  it('provides 12 colors in both themes', () => {
    expect(PALETTE.light, 'light palette').toHaveLength(12);
    expect(PALETTE.dark, 'dark palette').toHaveLength(12);
  });

  // Flipping the theme remaps the pen by slot index, so slot N has to be the
  // same color in both themes or the pen silently changes hue. Slot 0 is the
  // ink swatch and inverts on purpose: black on the light canvas, white on the
  // dark one.
  it('names each slot identically in both themes apart from the ink slot', () => {
    expect(PALETTE.light[0]?.name).toBe('Black');
    expect(PALETTE.dark[0]?.name).toBe('White');
    expect(PALETTE.dark.slice(1).map((c) => c.name)).toEqual(
      PALETTE.light.slice(1).map((c) => c.name),
    );
  });

  // Mixed color formats made slot-to-slot comparison impossible and had to be
  // parsed by `color-mix` in the swatch borders and by the PNG export's SVG.
  it('writes every swatch as sRGB hex', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const { name, value } of PALETTE[theme]) {
        expect(value, `${theme} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('has no duplicate values within a theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const values = PALETTE[theme].map((c) => c.value);
      expect(new Set(values).size, theme).toBe(values.length);
    }
  });
});

describe('stroke size scale', () => {
  it('uses the 2 / 3.5 / 5 / 10 px system matrix', () => {
    expect(SIZE_OPTIONS).toEqual([
      { name: 'S', value: 2 },
      { name: 'M', value: 3.5 },
      { name: 'L', value: 5 },
      { name: 'XL', value: 10 },
    ]);
  });
});

describe('one style for every tool', () => {
  beforeEach(() => {
    useToolStore.setState({ activeToolId: 'select' });
    useStyleStore.setState({ ...defaultStyle(), slot: 'pen', slots: {} });
  });

  it('opens on the ink swatch', () => {
    expect(nextShapeStyle().color).toBe(PALETTE.light[0]!.value);
  });

  // Pen and highlighter each keep their own colour and size; a tool that
  // paints nothing (select, eraser) leaves the live one alone.
  it('keeps colour and size per instrument', () => {
    const { setTool } = useToolStore.getState();
    const { setColor, setSize } = useStyleStore.getState();
    setTool('draw');
    setColor('#1d1d1d');
    setSize(2);

    setTool('highlighter');
    expect(nextShapeStyle()).toMatchObject({
      color: PALETTE.light[6]!.value,
      size: SIZE_OPTIONS[1]!.value,
    });
    setColor('#e03131');

    setTool('rectangle');
    expect(nextShapeStyle().color, 'a new slot starts from the pen').toBe('#1d1d1d');

    setTool('eraser');
    setTool('draw');
    expect(nextShapeStyle()).toMatchObject({ color: '#1d1d1d', size: 2 });

    setTool('rectangle');
    expect(nextShapeStyle().color).toBe('#1d1d1d');
    setTool('highlighter');
    expect(nextShapeStyle().color).toBe('#e03131');
  });

  // v0 stored one flat style for every tool, under these same names.
  it('carries a v0 flat style through', () => {
    const migrated = migrateStyle(
      { color: '#e03131', size: 10, dash: 'dashed', stickerId: 'star' },
      0,
    );

    expect(migrated).toMatchObject({
      color: '#e03131',
      size: 10,
      dash: 'dashed',
    });
    // Fields that never moved are untouched by the migration.
    expect(migrated.stickerId).toBe('star');
  });

  // v1 split the style per instrument. Collapsing it back takes the pen's
  // values: of the four groups that is the one carrying what someone was last
  // actually drawing with.
  it('collapses a v1 per-instrument store onto the pen', () => {
    const migrated = migrateStyle(
      {
        groups: {
          pen: { color: '#e03131', size: 10, fill: 'none', dash: 'dotted' },
          marker: { color: '#f1ac4b', size: 5 },
          shape: { color: '#4465e9', size: 2 },
          text: { color: '#099268', size: 2 },
        },
        stickerId: 'star',
      },
      1,
    );

    expect(migrated).toMatchObject({
      color: '#e03131',
      size: 10,
      dash: 'dotted',
    });
    expect(migrated.stickerId).toBe('star');
  });
});

describe('toolbar colours', () => {
  beforeEach(() => {
    useStyleStore.setState({ ramp: null });
  });

  const names = (theme: 'light' | 'dark' = 'light') =>
    rampColors(useStyleStore.getState().ramp, theme).map((c) => c.name);

  it('opens on the twelve palette colours in ramp order', () => {
    expect(names()).toEqual(allSwatches(PALETTE.light).map((c) => c.name));
  });

  it('adds a custom colour at the end, once', () => {
    const { addRampColor } = useStyleStore.getState();
    addRampColor('#ABCDEF');
    addRampColor('#abcdef');
    expect(names().slice(-1)).toEqual(['#ABCDEF']);
    expect(names()).toHaveLength(13);
  });

  it('takes a colour off and keeps at least one', () => {
    const { removeRampColor } = useStyleStore.getState();
    removeRampColor(1);
    expect(names()).not.toContain('Red');
    for (let i = 0; i < 20; i++) useStyleStore.getState().removeRampColor(0);
    expect(names()).toHaveLength(1);
  });

  // A palette colour is stored once and drawn for the theme; a custom one is
  // drawn exactly as picked.
  it('follows the theme for palette colours only', () => {
    useStyleStore.getState().addRampColor('#abcdef');
    expect(names('dark')[0]).toBe('White');
    expect(names('dark').slice(-1)).toEqual(['#ABCDEF']);
  });

  it('resets to the default', () => {
    useStyleStore.getState().removeRampColor(0);
    useStyleStore.getState().resetRamp();
    expect(useStyleStore.getState().ramp).toBeNull();
  });
});

describe('reordering toolbar colours', () => {
  beforeEach(() => {
    useStyleStore.setState({ ramp: null });
  });

  it('moves a colour and shifts the ones between', () => {
    useStyleStore.getState().moveRampColor(0, 2);
    expect(
      rampColors(useStyleStore.getState().ramp, 'light')
        .slice(0, 3)
        .map((c) => c.name),
    ).toEqual(['Red', 'Orange', 'Black']);
  });

  it('ignores a move off either end', () => {
    useStyleStore.getState().moveRampColor(0, 99);
    expect(useStyleStore.getState().ramp).toBeNull();
  });
});
