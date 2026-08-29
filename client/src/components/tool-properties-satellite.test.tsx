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
    expect(html).toContain('aria-label="Tool properties"');
    expect(html).toContain('aria-label="Color"');
    expect(html).toContain('aria-label="Stroke weight"');
    expect(html).not.toContain('inert=""');
  });

  it('carries the same controls for the highlighter and the wand', () => {
    for (const tool of ['highlighter', 'wand']) {
      expect(render(tool)).toContain('aria-label="Stroke weight"');
    }
  });

  // Text has no stroke width to set — `fontSize` lives on the shape, not in the
  // style store — so the row is absent rather than present and inert.
  it('drops the stroke row for text but keeps the swatches', () => {
    const html = render('text');
    expect(html).toContain('aria-label="Color"');
    expect(html).not.toContain('aria-label="Stroke weight"');
  });

  it('hides itself, inertly, on a tool with no quick properties', () => {
    for (const tool of ['select', 'hand', 'eraser', 'laser', 'graph']) {
      const html = render(tool);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('inert=""');
      expect(html).toContain('pointer-events-none');
    }
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

  it('is cut from the same slab: same corner, same shadow', () => {
    expect(html).toContain('rounded-toolbar');
    expect(html).toContain('tb-shell');
    expect(html).toContain('data-mode="floating"');
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
