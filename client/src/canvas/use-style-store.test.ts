import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultGroups,
  migrateStyle,
  PALETTE,
  SIZE_OPTIONS,
  styleGroupForShape,
  styleGroupForTool,
  useStyleStore,
} from './use-style-store';

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

describe('per-instrument style memory', () => {
  beforeEach(() => {
    useStyleStore.setState({ groups: defaultGroups() });
  });

  it('opens the marker on yellow and everything else on ink', () => {
    const { groups } = useStyleStore.getState();
    expect(groups.marker.color).toBe(PALETTE.light[6]!.value);
    expect(groups.pen.color).toBe(PALETTE.light[0]!.value);
    expect(groups.shape.color).toBe(PALETTE.light[0]!.value);
    expect(groups.text.color).toBe(PALETTE.light[0]!.value);
  });

  it('keeps each group independent', () => {
    const { setColor, setSize } = useStyleStore.getState();
    setColor('pen', '#e03131');
    setSize('marker', 10);

    const { groups } = useStyleStore.getState();
    expect(groups.pen.color).toBe('#e03131');
    expect(groups.marker.color).toBe(PALETTE.light[6]!.value);
    expect(groups.shape.color).toBe(PALETTE.light[0]!.value);
    expect(groups.marker.size).toBe(10);
    expect(groups.pen.size).not.toBe(10);
  });

  it('routes each tool to its group', () => {
    expect(styleGroupForTool('draw')).toBe('pen');
    expect(styleGroupForTool('highlighter')).toBe('marker');
    expect(styleGroupForTool('text')).toBe('text');
    expect(styleGroupForTool('equation')).toBe('text');
    expect(styleGroupForTool('ellipse')).toBe('shape');
    // Anything that styles like a shape and is not listed falls there too.
    expect(styleGroupForTool('graph')).toBe('shape');
  });

  // A highlighter stroke is a draw shape like any other (see draw-tool.ts), so
  // the pen is the only group a selected stroke can resolve to.
  it('routes each shape type back to a group', () => {
    expect(styleGroupForShape('draw')).toBe('pen');
    expect(styleGroupForShape('text')).toBe('text');
    expect(styleGroupForShape('rectangle')).toBe('shape');
    expect(styleGroupForShape('mixed')).toBe('shape');
  });

  // v0 stored one flat style for every tool. Nobody should come back to a pen
  // they never chose, so the value they were last drawing with is carried into
  // every group — bar the marker, whose yellow is worth more than a colour it
  // inherited from whatever the pen happened to be.
  it('carries a v0 flat style into every group', () => {
    const migrated = migrateStyle(
      { color: '#e03131', size: 10, dash: 'dashed', stickerId: 'star' },
      0,
    );

    expect(migrated.groups.pen).toMatchObject({
      color: '#e03131',
      size: 10,
      dash: 'dashed',
    });
    expect(migrated.groups.shape.color).toBe('#e03131');
    expect(migrated.groups.text.size).toBe(10);
    expect(migrated.groups.marker.color).toBe(PALETTE.light[6]!.value);
    expect(migrated.groups.marker.size).toBe(10);
    // Fields that never moved are untouched by the split.
    expect(migrated.stickerId).toBe('star');
  });
});
