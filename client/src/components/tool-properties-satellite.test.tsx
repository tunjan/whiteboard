import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/canvas/tools/register';
import {
  allSwatches,
  paletteColors,
  quickSwatches,
} from '@/canvas/use-style-store';
import { ToolPropertiesSatellite } from './tool-properties-satellite';

const render = (activeToolId: string, placement?: 'bottom' | 'left') =>
  renderToStaticMarkup(
    <ToolPropertiesSatellite activeToolId={activeToolId} placement={placement} />,
  );

describe('quickSwatches', () => {
  // Ordered as a rainbow, not by frequency: a row this long is found by where
  // a colour falls in the ramp, so ink first and then hue order.
  it('offers ink and a hue ramp closed by grey', () => {
    expect(
      quickSwatches(paletteColors('light')).map((c) => c.name),
    ).toEqual([
      'Black',
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Blue',
      'Violet',
      'Grey',
    ]);
  });

  // Held as palette slots, so slot 0 is whichever ink reads on this canvas.
  it('flips the ink swatch with the canvas rather than restating a hex', () => {
    const dark = quickSwatches(paletteColors('dark'));
    expect(dark[0]!.name).toBe('White');
    expect(dark[0]!.value).toBe(paletteColors('dark')[0]!.value);
    expect(dark.map((c) => c.name).slice(1)).toEqual([
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Blue',
      'Violet',
      'Grey',
    ]);
  });

  // One order on every colour surface: the ramp, then its light variants in
  // the same hue order.
  it('follows the ramp with the light variants in the same order', () => {
    expect(
      allSwatches(paletteColors('light')).map((c) => c.name).slice(8),
    ).toEqual(['Light red', 'Light green', 'Light blue', 'Light violet']);
  });
});

describe('ToolPropertiesSatellite', () => {
  // Under a bottom bar each stroke setting sits behind a chevron of its own,
  // as in the reference tray; beside a rail they are out on a row.
  it('offers the swatches and the stroke row to the pen', () => {
    const html = render('draw');
    expect(html).toContain('aria-label="Style controls"');
    expect(html).toContain('aria-label="Color"');
    expect(html).toContain('aria-label="Stroke"');
    expect(render('draw', 'left')).toContain('aria-label="Stroke weight"');
    expect(html).not.toContain('inert=""');
    expect(html).not.toContain('tbar-sep');
  });

  it('carries the same controls for the highlighter', () => {
    // The highlighter's band has no dash, so its weight is the one menu.
    expect(render('highlighter')).toContain('aria-label="Stroke weight"');
    expect(render('highlighter', 'left')).toContain('aria-label="Stroke weight"');
  });

  // Text has no stroke width to set — `fontSize` lives on the shape, not in the
  // style store — so the row is absent rather than present and inert.
  it('drops the stroke row for text but keeps the swatches', () => {
    const html = render('text');
    expect(html).toContain('aria-label="Color"');
    expect(html).not.toContain('aria-label="Stroke weight"');
  });

  // Hidden means hidden three ways: out of the accessibility tree, out of the
  // Tab order, and out of the way of the pointer. The first two are attributes
  // and the third is `.style-bar-motion[data-visible='false']`, so the flag
  // those rules key off is what has to be in the markup.
  it('hides itself, inertly, on a tool with no properties to set', () => {
    for (const tool of ['select', 'hand', 'laser', 'graph']) {
      const html = render(tool);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('inert=""');
      expect(html).toContain('data-visible="false"');
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
    expect(html).not.toContain('tbar-sep');
  });

  it('marks exactly one choice in each control', () => {
    const html = render('draw');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(
      html.match(/role="radiogroup"/g)!.length,
    );
  });

  // The sliding chip is placed off the segment count and the chosen index, and
  // nothing else: four segments and the first one chosen here. Those two
  // numbers are all the component states, because the same control is laid out
  // two ways — flush inside this plate, and inset by the padding the wide bar
  // gives its capsules — and the width and step differ between them. A chip
  // that wrote its own pixels could only ever be right for one, and one sized
  // in fixed pixels would sit half a key off as soon as a coarse pointer grew
  // every key to 44px.
  it('places the weight indicator from the segment count and index', () => {
    const html = render('draw', 'left');
    expect(html).toContain('--seg-count:4');
    expect(html).toContain('--seg-index:0');
    expect(html).not.toMatch(/tb-mark[^>]*width:\s*\d/);
  });

  // The ramp is the one switch here that does *not* take a travelling chip. A
  // chip is a ground, and a ground behind a swatch is a second colour sitting
  // next to the colour being chosen — which shifts how every swatch beside it
  // reads. The chosen colour wears a ring instead (`.tbar-swatch` in section 9
  // of `index.css`), drawn in box-shadows so the dot never changes size and
  // pushes the ramp along.
  it('marks the chosen colour with a ring, never with a ground', () => {
    const html = render('draw');
    // No chip under the ramp, and the ring is not written per swatch: the only
    // thing the markup states about a swatch is the colour it actually is.
    const ramp = html.slice(
      html.indexOf('aria-label="Color"'),
      html.indexOf('aria-label="Stroke"'),
    );
    expect(ramp).not.toContain('tbar-chip');
    expect(html).not.toContain('box-shadow');
    // Exactly one swatch is checked, and CSS hangs the ring off that.
    expect(
      html.match(/class="tbar-swatch"/g)?.length,
    ).toBeGreaterThan(1);
  });
});

describe('the tray under a bottom bar', () => {
  // Changing tool must not move the tray's top edge, so no tool gets a second
  // row: frames and stickers used to, and an unlabelled slider sat alone on it.
  it('is one row for every tool', () => {
    for (const tool of ['draw', 'eraser', 'rectangle', 'arrow', 'text', 'frame', 'sticker']) {
      expect(render(tool).match(/tbar-style-row/g)).toHaveLength(1);
    }
  });

  it('puts the tray away with the bar', () => {
    const html = renderToStaticMarkup(
      <ToolPropertiesSatellite activeToolId="draw" barHidden />,
    );
    expect(html).toContain('data-visible="false"');
  });
});

// The pill has to read as a second bar stacked over the toolbar rather than as
// a flange growing out of it. Each of these is one of the things doing that
// work, so each is worth failing a build over.
describe('ToolPropertiesSatellite as a bar in its own right', () => {
  const html = render('draw');

  it('rises into place rather than unrolling out of the bar', () => {
    expect(html).toContain('data-visible="true"');
    expect(render('select')).toContain('data-visible="false"');
    expect(html).toContain('style-bar-motion');
    // Animating grid-template-rows was the flush riser's trick, and it looked
    // like the bar extruding a flange. A separate pill has to arrive as one.
    expect(html).not.toMatch(/grid-rows-\[[01]fr\]/);
  });

  // Tailwind's `translate-*` and `scale-*` utilities write the `translate` and
  // `scale` properties, which a `transition-[opacity,transform]` does not
  // cover: the rise and the shrink landed in one frame while only the fade
  // ever eased. The motion moved to a rule that names the property it moves.
  it('does not move itself with utilities the transition cannot reach', () => {
    for (const tool of ['draw', 'select']) {
      const markup = render(tool);
      expect(markup).not.toContain('scale-[0.97]');
      expect(markup).not.toContain('transition-[opacity,transform]');
      expect(markup).not.toMatch(/\btranslate-y-\d/);
    }
  });

  it('ends the colour row with the key to the colour panel', () => {
    expect(html).toContain('aria-label="Colors"');
  });
});

// The bar replaced the top-right style panel, so every control that panel
// carried has to be reachable here, on the bar itself.
describe('ToolPropertiesSatellite as the only style surface', () => {
  const controls = (tool: string) =>
    [...render(tool).matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);

  // No catch-all Options key: every setting has its own place in the tray. The
  // arrow's route and ends are out in the open, and fold behind one key only
  // under the narrow bar.
  it('shows every setting on the bar rather than behind a key', () => {
    expect(controls('draw')).not.toContain('Options');
    const wideArrow = renderToStaticMarkup(
      <ToolPropertiesSatellite activeToolId="arrow" fullPalette />,
    );
    for (const name of ['Route', 'Ends', 'Stroke']) {
      expect(wideArrow).toContain(`aria-label="${name}"`);
    }
    expect(controls('arrow')).toEqual(expect.arrayContaining(['Arrow', 'Stroke']));
    expect(controls('text')).toEqual(
      expect.arrayContaining(['Font', 'Weight', 'Align']),
    );
  });

  // The shape tools are the exception: one row of the shapes themselves, with
  // colour, stroke and weight behind chevrons, as in the reference tray.
  it('gives the shape tools the shape tray', () => {
    for (const tool of ['rectangle', 'line']) {
      const labels = [
        ...renderToStaticMarkup(
          <ToolPropertiesSatellite activeToolId={tool} fullPalette />,
        ).matchAll(/aria-label="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(labels).toEqual(
        expect.arrayContaining([
          'Shape',
          'Triangle',
          'More shapes',
          'Color',
          'Stroke',
          'Opacity',
          'Stroke weight',
        ]),
      );
    }
  });

  // Under the narrow bar nine shapes and the menus cannot share one row, so
  // the shapes fold behind a key showing the one in hand.
  it('folds the shapes behind one key under the narrow bar', () => {
    const labels = controls('rectangle');
    expect(labels).toContain('Shape, Rectangle');
    expect(labels).not.toContain('Triangle');
  });

  // The highlighter fixes its own translucency and takes no dash or fill, so
  // it is the one inking tool with a single row.
  it('gives the highlighter only colour and weight', () => {
    expect(render('highlighter').match(/tbar-style-row/g)).toHaveLength(1);
  });

  // Wide subjects can outrun a phone. The bar is capped to the viewport here,
  // and `.tbar-style` takes the sideways scroll under 640px — on one axis, so a
  // vertical scroller cannot open for the pixel a focus ring bleeds.
  it('stays inside a narrow screen and scrolls sideways within it', () => {
    const html = render('draw');
    expect(html).toContain('max-w-[calc((100vw-1rem)/var(--drawer-scale))]');
    expect(html).toContain('tbar-style');
  });
});

// One key, one geometry. Every control on this bar — a swatch, a weight, a
// popover trigger — is a `.tbar-item`, and its size, corner, fill and states
// are all in section 9 of `index.css`. A key that writes its own is how a row
// of controls drifts apart, so the markup is checked for the absence of that.
describe('ToolPropertiesSatellite key geometry', () => {
  const html = render('draw');

  it('builds every key from the one shared class', () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(8);
    // The inking tools stand in the drawer's own slots, like the bar's, each
    // with its chevron, and the stroke settings wait behind the tray's
    // chevron key.
    for (const button of buttons) {
      expect(button).toMatch(/tbar-item|drawer-cell|drawer-ink-more|tray-menu/);
    }
  });

  it('lets no key state its own size or corner', () => {
    expect(html).not.toMatch(/class="[^"]*\bsize-\d/);
    expect(html).not.toMatch(/class="[^"]*\btbar-item[^"]*\brounded-/);
  });

  // The chip is placed off the segment count and the chosen index, and nothing
  // else: four segments and the first one chosen here. A chip that wrote its
  // own pixels would sit half a key off as soon as a coarse pointer grew every
  // key to 44px.
  it('places the weight indicator from the segment count and index alone', () => {
    const html = render('draw', 'left');
    expect(html).toContain('--seg-count:4');
    expect(html).toContain('--seg-index:0');
    expect(html).not.toMatch(/tbar-chip[^>]*width:\s*\d/);
  });
});
