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
  it('offers ink, blue, green and red', () => {
    expect(
      quickSwatches(paletteColors('light'), '#1d1d1d').map((c) => c.name),
    ).toEqual(['Black', 'Blue', 'Green', 'Red']);
  });

  // Held as palette slots, so slot 0 is whichever ink reads on this canvas.
  it('flips the ink swatch with the canvas rather than restating a hex', () => {
    const dark = quickSwatches(paletteColors('dark'), '#f3f3f3');
    expect(dark.map((c) => c.name)).toEqual(['White', 'Blue', 'Green', 'Red']);
    expect(dark[0]!.value).toBe(paletteColors('dark')[0]!.value);
  });

  // A row with nothing selected reads as "no color set", so a color picked in
  // the full panel joins the row instead of leaving it blank.
  it('appends a color chosen outside the quick set', () => {
    const swatches = quickSwatches(paletteColors('light'), '#e16919');
    expect(swatches).toHaveLength(5);
    expect(swatches[4]).toEqual({ name: 'Current color', value: '#e16919' });
  });

  it('never appends a duplicate of a slot it already holds', () => {
    for (const color of quickSwatches(paletteColors('light'), '#1d1d1d')) {
      expect(quickSwatches(paletteColors('light'), color.value)).toHaveLength(
        4,
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

  // Four segments, so the sliding mark is a quarter wide and steps by its own
  // width. Percentages, because a coarse pointer grows every key to 44px.
  it('sizes the weight indicator in quarters, not pixels', () => {
    const html = render('draw');
    expect(html).toContain('w-1/4');
    expect(html).toMatch(/translateX\(\d+%\)/);
  });
});

// The riser has to read as part of the toolbar rather than as a pill hovering
// over it. Each of these is one of the things doing that work, so each is worth
// failing a build over.
describe('ToolPropertiesSatellite attachment to the bar', () => {
  const html = render('draw');

  it('sits flush on the bar, with no gutter and no overlap', () => {
    expect(html).toContain('bottom-full');
    // A gutter would split the two apart; an overlap would show the bar's
    // border through the ribbon's translucent fill.
    expect(html).not.toMatch(/class="[^"]*\s-?mb-/);
  });

  // Depth by tone, never by relief: the bar is `surface`, the ribbon `panel`.
  // A sheen or a lit rim would bevel the seam and read as moulding, and a drop
  // shadow would put the ribbon in front of the bar rather than behind it.
  it('separates from the bar by tone alone, with no relief at all', () => {
    expect(html).toContain('data-mode="docked"');
    expect(html).not.toMatch(/\btb-(shell|riser)\b/);
    expect(html).not.toMatch(/shadow-(e\d|xs|sm|md|lg|panel)/);
  });

  it('squares off the edge it shares with the bar', () => {
    expect(html).toContain('rounded-b-none');
    expect(html).toContain('border-b-0');
  });

  // `left-1.5` is the bar's own padding, so the two edges line up exactly.
  it('left-aligns to the bar, but centres where the bar is narrower', () => {
    expect(html).toContain('sm:left-1.5');
    expect(html).toContain('sm:translate-x-0');
    expect(html).toContain('left-1/2');
    expect(html).toContain('-translate-x-1/2');
  });

  it('grows out of that edge rather than popping in over it', () => {
    expect(html).toContain('grid-rows-[1fr]');
    expect(render('select')).toContain('grid-rows-[0fr]');
    // Scaling would distort the swatches and read as a balloon, not a riser.
    expect(html).not.toMatch(/\bscale-9\d/);
  });
});
