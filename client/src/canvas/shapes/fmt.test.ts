import { describe, expect, it } from 'vitest';
import { CentiPixelPathWriter, SVG_PATH_BUFFER_SIZE, toCenti } from './fmt';

describe('CentiPixelPathWriter', () => {
  it('rounds to integer hundredths and emits compact relative commands', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset();
    writer.moveTo(toCenti(10.125), toCenti(-2.004));
    writer.lineTo(toCenti(12.5), toCenti(-1));
    writer.quadraticTo(toCenti(13), toCenti(2), toCenti(15), toCenti(3));
    writer.close();

    expect(writer.finish()).toBe('M 10.13 -2 l 2.37 1 q 0.5 3 2.5 4 Z');
  });

  it('serializes cubic and elliptical arc fields at centi precision', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset();
    writer.moveTo(0, 0);
    writer.cubicTo(100, 200, 300, 400, 500, 600);
    writer.ellipticArcTo(250, 125, 4500, true, false, 800, 900);

    expect(writer.finish()).toBe('M 0 0 c 1 2 3 4 5 6 a 2.5 1.25 45 1 0 3 3');
  });

  it('grows past the reusable 64 KB starting buffer without truncating', () => {
    const writer = new CentiPixelPathWriter();
    writer.reset(SVG_PATH_BUFFER_SIZE + 1);
    writer.moveTo(0, 0);
    for (let index = 1; index <= 12_000; index++) {
      writer.lineTo(index * 100, index % 2 === 0 ? 0 : 100);
    }

    const result = writer.finish();
    expect(result.length).toBeGreaterThan(SVG_PATH_BUFFER_SIZE);
    expect(result.endsWith(' l 1 -1')).toBe(true);
  });
});
