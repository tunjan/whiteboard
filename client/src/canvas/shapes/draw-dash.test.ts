import { describe, expect, it } from 'vitest';
import { buildInkRender, drawUtil } from './draw';

function pointsOfLength(sampleCount: number) {
  return Array.from({ length: sampleCount }, (_, i) => ({
    x: i * 3,
    y: Math.sin(i / 6) * 40,
    pressure: 0.5,
  }));
}

const PROPS = {
  ...drawUtil.getDefaultProps(),
  dash: 'dashed' as const,
  size: 4,
};

/** The dash pattern for a stroke of `sampleCount` points, as `"<array> @ <offset>"`. */
function dashPattern(sampleCount: number, isDrawing: boolean): string {
  const { dash } = buildInkRender(
    PROPS,
    pointsOfLength(sampleCount),
    isDrawing,
    0,
  );
  return `${dash?.strokeDasharray} @ ${dash?.strokeDashoffset}`;
}

describe('a dashed pencil stroke', () => {
  const growth = [5, 20, 50, 120, 300];

  it('keeps its dashes still while it is being drawn', () => {
    const frames = growth.map((n) => dashPattern(n, true));
    // Every dash already on screen must stay exactly where it was as the hand
    // carries on. Fitting the pattern to the length re-solved it every frame,
    // and the drawn part of the stroke crawled along behind the pen.
    for (const frame of frames) expect(frame).toBe(frames[0]);
  });

  it('fits the pattern to the stroke once it is finished', () => {
    expect(
      new Set(growth.map((n) => dashPattern(n, false))).size,
    ).toBeGreaterThan(1);
  });

  it('does not shift the start of the stroke when the pen lifts', () => {
    const offsetOf = (pattern: string): string => pattern.split('@')[1]!;
    for (const samples of [50, 120, 300]) {
      expect(offsetOf(dashPattern(samples, false))).toBe(
        offsetOf(dashPattern(samples, true)),
      );
    }
  });
});
