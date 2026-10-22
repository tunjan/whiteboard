import { describe, expect, it } from 'vitest';
import {
  drawPathData,
  ellipseDrawCommands,
  polylineDrawCommands,
} from './geometry-synthesis';
import { arrowDrawCommands, lineDrawCommands } from './line-geometry';

/** Absolute coordinates of every point a path names, in order. */
function coords(d: string): number[] {
  const tokens = d.match(/[MLQCmlqc]|-?\d*\.?\d+(?:e-?\d+)?/g)!;
  const arity: Record<string, number> = { m: 2, l: 2, q: 4, c: 6 };
  const out: number[] = [];
  let cmd = '';
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length; ) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    const relative = cmd === cmd.toLowerCase();
    const values = tokens.slice(i, (i += arity[cmd.toLowerCase()]!)).map(Number);
    for (let k = 0; k < values.length; k += 2) {
      out.push(relative ? x + values[k]! : values[k]!);
      out.push(relative ? y + values[k + 1]! : values[k + 1]!);
    }
    [x, y] = out.slice(-2) as [number, number];
    if (cmd === 'm') cmd = 'l';
    if (cmd === 'M') cmd = 'L';
  }
  return out;
}

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('draw stroke style', () => {
  it('reproduces tldraw 5.5.2 toDrawD for a rectangle', () => {
    // `new PathBuilder().moveTo(0,0).lineTo(200,0).lineTo(200,120)
    //   .lineTo(0,120).close().toDrawD({ strokeWidth: 3.5, randomSeed: 'shape:abc' })`
    const tldraw =
      'M 7.6597 -0.1121 L 192.2313 0.3155 Q 199.2313 0.3155 199.2313 7.3155 L 200.9461 112.7769 Q 200.9461 119.7769 193.9461 119.7769 L 7.5749 119.8719 Q 0.5749 119.8719 0.5749 112.8719 L 0.6597 6.8879 Q 0.6597 -0.1121 7.6597 -0.1121 M 7.6069 -0.4875 L 192.0807 -0.2128 Q 199.0807 -0.2128 199.0807 6.7872 L 199.4922 113.7657 Q 199.4922 120.7657 192.4922 120.7657 L 6.6542 119.3059 Q -0.3458 119.3059 -0.3458 112.3059 L 0.6069 6.5125 Q 0.6069 -0.4875 7.6069 -0.4875';
    const ours = drawPathData(
      polylineDrawCommands([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 120 },
        { x: 0, y: 120 },
      ]),
      { seed: 'shape:abc', size: 3.5, closed: true },
    );
    const expected = coords(tldraw);
    const actual = coords(ours);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 2));
  });

  it('is deterministic per seed, and differs between seeds', () => {
    const draw = (seed: string) =>
      drawPathData(polylineDrawCommands(square), { seed, size: 6, closed: true });
    expect(draw('shape-7')).toBe(draw('shape-7'));
    expect(draw('shape-a')).not.toBe(draw('shape-b'));
  });

  it('puts both passes in one path, each rounding every corner', () => {
    const d = drawPathData(polylineDrawCommands(square), {
      seed: 'corners',
      size: 4,
      closed: true,
    });
    expect(d.match(/[Mm]/g)).toHaveLength(2);
    expect(d.match(/[Qq]/g)).toHaveLength(8);
  });

  it('draws an ellipse as four cubics a pass', () => {
    const d = drawPathData(ellipseDrawCommands(50, 25, 50, 25), {
      seed: 'ellipse',
      size: 3.5,
      closed: true,
    });
    expect(d.match(/[Cc]/g)).toHaveLength(8);
  });

  it('keeps a line’s ends on its endpoints and wobbles the rest', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 0 },
    ];
    const xy = coords(
      drawPathData(lineDrawCommands(points, 0, 'linear'), { seed: 'l', size: 4 }),
    );
    expect(xy.slice(0, 2)).toEqual([0, 0]);
    expect(xy.slice(-2)).toEqual([200, 0]);
    expect(xy).not.toContain(40);
  });

  it('leaves a straight arrow body unjittered, as tldraw does', () => {
    const body = [
      { x: 0, y: 0 },
      { x: 120, y: 30 },
    ];
    expect(
      coords(drawPathData(arrowDrawCommands(body, 'straight'), { seed: 'a', size: 4 })),
    ).toEqual([0, 0, 120, 30, 0, 0, 120, 30]);
  });

  it('returns nothing for an invalid brush or fewer than two points', () => {
    expect(drawPathData([], { seed: 'x', size: 4 })).toBe('');
    expect(
      drawPathData(polylineDrawCommands([{ x: 0, y: 0 }]), { seed: 'x', size: 4 }),
    ).toBe('');
    expect(
      drawPathData(polylineDrawCommands(square), { seed: 'x', size: 0 }),
    ).toBe('');
  });
});
