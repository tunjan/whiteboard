import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Slider } from './slider';

/** Thumbs the slider renders for `props`. */
function thumbCount(markup: string): number {
  return (markup.match(/data-slot="slider-thumb"/g) ?? []).length;
}

describe('Slider', () => {
  it('draws one thumb for a single value, however it is spelled', () => {
    // Base UI takes a lone value as a bare number, and every slider in this app
    // is a single value. Counting thumbs off `Array.isArray` alone put a second,
    // unbound thumb at the maximum on all of them — and being last in the DOM it
    // sat on top at the right-hand end, so dragging there moved nothing.
    for (const value of [0.35, [0.35]]) {
      expect(
        thumbCount(
          renderToStaticMarkup(
            <Slider min={0} max={1} step={0.01} value={value} />,
          ),
        ),
      ).toBe(1);
    }
  });

  it('draws one thumb for a zero value', () => {
    // Zero is the value a taper, a volume or a smoothing amount sits at when
    // it is turned off, so it must not read as "no value given".
    expect(
      thumbCount(
        renderToStaticMarkup(<Slider min={0} max={1} step={0.01} value={0} />),
      ),
    ).toBe(1);
  });

  it('still draws a thumb per value for a range', () => {
    expect(
      thumbCount(
        renderToStaticMarkup(
          <Slider min={0} max={1} step={0.01} defaultValue={[0.2, 0.8]} />,
        ),
      ),
    ).toBe(2);
  });
});
