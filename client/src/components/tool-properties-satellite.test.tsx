import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { paletteColors } from '@/canvas/use-style-store';
import {
  quickSwatches,
  ToolPropertiesSatellite,
} from './tool-properties-satellite';

const render = (activeToolId: string) =>
  renderToStaticMarkup(<ToolPropertiesSatellite activeToolId={activeToolId} />);

describe('quickSwatches', () => {
  // Ordered as a rainbow, not by frequency: a row this long is found by where
  // a colour falls in the ramp, so ink first and then hue order.
  it('offers ink and a hue ramp closed by grey', () => {
    expect(
      quickSwatches(paletteColors('light'), '#1d1d1d').map((c) => c.name),
    ).toEqual([
      'Black',
      'Red',
      'Orange',
      'Yellow',
      'Light green',
      'Light blue',
      'Violet',
      'Grey',
    ]);
  });

  // Held as palette slots, so slot 0 is whichever ink reads on this canvas.
  it('flips the ink swatch with the canvas rather than restating a hex', () => {
    const dark = quickSwatches(paletteColors('dark'), '#f3f3f3');
    expect(dark[0]!.name).toBe('White');
    expect(dark[0]!.value).toBe(paletteColors('dark')[0]!.value);
    expect(dark.map((c) => c.name).slice(1)).toEqual([
      'Red',
      'Orange',
      'Yellow',
      'Light green',
      'Light blue',
      'Violet',
      'Grey',
    ]);
  });

  // A row with nothing selected reads as "no color set", so a color picked in
  // the full panel joins the row instead of leaving it blank.
  it('appends a color chosen outside the quick set', () => {
    // Slot 8, 'Green' — in the palette, but not one of the eight quick hues.
    const swatches = quickSwatches(paletteColors('light'), '#099268');
    expect(swatches).toHaveLength(9);
    expect(swatches[8]).toEqual({ name: 'Current color', value: '#099268' });
  });

  it('never appends a duplicate of a slot it already holds', () => {
    for (const color of quickSwatches(paletteColors('light'), '#1d1d1d')) {
      expect(quickSwatches(paletteColors('light'), color.value)).toHaveLength(
        8,
      );
    }
  });
});

describe('ToolPropertiesSatellite', () => {
  it('offers the swatches and the stroke row to the pen', () => {
    const html = render('draw');
    expect(html).toContain('aria-label="Style controls"');
    expect(html).toContain('aria-label="Color"');
    expect(html).toContain('aria-label="Stroke weight"');
    expect(html).not.toContain('inert=""');
  });

  it('carries the same controls for the highlighter', () => {
    expect(render('highlighter')).toContain('aria-label="Stroke weight"');
  });

  // Text has no stroke width to set — `fontSize` lives on the shape, not in the
  // style store — so the row is absent rather than present and inert.
  it('drops the stroke row for text but keeps the swatches', () => {
    const html = render('text');
    expect(html).toContain('aria-label="Color"');
    expect(html).not.toContain('aria-label="Stroke weight"');
  });

  it('hides itself, inertly, on a tool with no properties to set', () => {
    for (const tool of ['select', 'hand', 'laser', 'graph']) {
      const html = render(tool);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('inert=""');
      expect(html).toContain('pointer-events-none');
    }
  });

  // The eraser's mode is a setting like any other, so it is found where every
  // other tool's settings are — and it is the whole of the bar, because the
  // eraser paints no colour and no weight.
  it('gives the eraser its mode, and only that', () => {
    const html = render('eraser');
    expect(html).toContain('aria-label="Eraser mode"');
    expect(html).not.toContain('inert=""');
    expect(html).not.toContain('aria-label="Color"');
    expect(html).not.toContain('aria-label="Stroke weight"');
    // One section, so no rule.
    expect(html).not.toContain('bg-tb-divider');
  });

  it('marks exactly one swatch and one weight as checked', () => {
    expect(render('draw').match(/aria-checked="true"/g)).toHaveLength(2);
  });

  // Four segments, so the sliding mark is a quarter wide — less the inset that
  // holds it clear of its groove — and steps by that whole quarter, which is
  // its own width plus the gap the inset leaves. Both stay percentages of the
  // track, because a coarse pointer grows every key to 44px and a mark sized
  // in fixed pixels would then sit half a key off.
  it('sizes the weight indicator in quarters, not pixels', () => {
    const html = render('draw');
    expect(html).toContain('w-[calc(25%-6px)]');
    expect(html).toMatch(/translateX\(calc\(\d+ \* \(100% \+ 6px\)\)\)/);
  });
});

// The pill has to read as a second bar stacked over the toolbar rather than as
// a flange growing out of it. Each of these is one of the things doing that
// work, so each is worth failing a build over.
describe('ToolPropertiesSatellite as a bar in its own right', () => {
  const html = render('draw');

  it('floats clear of the toolbar instead of sitting flush on it', () => {
    expect(html).toContain('bottom-full');
    // The gutter is what makes these two bars rather than one tall control.
    expect(html).toMatch(/\bmb-2\.5\b/);
  });

  it('is cut from the same nothing as the bar: no card under either', () => {
    // The bar is a transparent pill, so the pill riding above it is one too:
    // the controls are the chrome, and there is no slab behind them to match.
    expect(html).toContain('rounded-full');
    expect(html).toContain('bg-transparent');
    expect(html).not.toContain('tb-shell');
    // Its glyphs carry their own separation instead.
    expect(html).toContain('tb-glyph');
    // Both were how the old riser hid the seam it shared with the bar. A
    // detached pill has no such seam, and a squared-off edge on one would
    // read as a piece that had come loose.
    expect(html).not.toContain('rounded-b-none');
    expect(html).not.toContain('border-b-0');
  });

  // `left-1.5` is the toolbar's own padding, so the two left edges line up.
  it('left-aligns to the bar, but centres where the bar is narrower', () => {
    expect(html).toContain('sm:left-1.5');
    expect(html).toContain('sm:translate-x-0');
    expect(html).toContain('left-1/2');
    expect(html).toContain('-translate-x-1/2');
  });

  it('rises into place rather than unrolling out of the bar', () => {
    expect(html).toContain('translate-y-0');
    expect(render('select')).toContain('translate-y-1.5');
    // Animating grid-template-rows was the flush riser's trick, and it looked
    // like the bar extruding a flange. A separate pill has to arrive as one.
    expect(html).not.toMatch(/grid-rows-\[[01]fr\]/);
  });

  it('offers the rest of the palette where the quick row runs out', () => {
    expect(html).toContain('aria-label="More colors"');
  });
});

// The bar replaced the top-right style panel, so every control that panel
// carried has to be reachable here — inline where it is reached for constantly,
// and behind a key that previews its value where it is not.
describe('ToolPropertiesSatellite as the only style surface', () => {
  /** The `aria-label`s of the popover keys, in bar order. */
  const keys = (html: string) =>
    [...html.matchAll(/aria-label="([^"]+)"/g)]
      .map((match) => match[1]!)
      .filter((label) =>
        ['Fill', 'Stroke style', 'Opacity', 'Text', 'Arrow', 'Line'].includes(
          label,
        ),
      );

  it('offers the pen everything the panel gave it', () => {
    expect(keys(render('draw'))).toEqual(['Fill', 'Stroke style', 'Opacity']);
  });

  it('gives the arrow its route, heads and label behind one key', () => {
    expect(keys(render('arrow'))).toEqual(['Stroke style', 'Opacity', 'Arrow']);
    expect(keys(render('line'))).toEqual(['Stroke style', 'Opacity', 'Line']);
  });

  it('gives text its typeface, weight and alignment behind one key', () => {
    expect(keys(render('text'))).toEqual(['Opacity', 'Text']);
  });

  // The highlighter fixes its own translucency and takes no dash or fill, so
  // it is the one inking tool that ends up with nothing behind a key at all.
  it('shows no keys where no key would do anything', () => {
    expect(keys(render('highlighter'))).toEqual([]);
  });

  // A rule earns its place by having a section on both sides of it. Sections
  // drop out per subject, so the count has to follow rather than be fixed.
  it('rules between the sections it has, never against its own edge', () => {
    const rules = (html: string) =>
      (html.match(/bg-tb-divider/g) ?? []).length;
    // weight · colour · keys
    expect(rules(render('draw'))).toBe(2);
    // weight · colour
    expect(rules(render('highlighter'))).toBe(1);
    // colour · keys
    expect(rules(render('text'))).toBe(1);
  });

  // Wide subjects can outrun a phone, and the fix has to stay on one axis: a
  // vertical scroller would open for the 4px the rules bleed into the padding.
  it('scrolls sideways rather than reaching past a narrow screen', () => {
    const html = render('draw');
    expect(html).toContain('max-w-[calc(100vw-1rem)]');
    expect(html).toContain('max-sm:overflow-x-auto');
    expect(html).toContain('max-sm:overflow-y-hidden');
  });
});

// The bar states its nesting rule in `index.css`: bar 20 - 4 = track 16 - 4 =
// key 12, each box concentric with the one outside it. The keys stand in a
// recess that takes no padding, so at that corner the rule reads 16 - 3 = 13,
// and a key painting its own 12px corner there leaves a crescent of track
// showing. That is a hairline mistake to make and an obvious one to see.
describe('ToolPropertiesSatellite corner nesting', () => {
  const html = render('draw');

  it('insets the key fill instead of rounding the key itself into the track', () => {
    expect(html).toContain('inset-[3px] rounded-[13px]');
  });

  it('uses the same inset and corner as the weight chip beside it', () => {
    // The weight chip is the bar's other flush recess. Two constructions for
    // one corner on one bar is how the pair drifts apart.
    expect(html).toContain('inset-y-[3px] left-[3px] w-[calc(25%-6px)]');
    expect(html).toContain('rounded-[13px]');
  });
});
