import { describe, expect, it } from 'vitest';
import { resizeCursor } from './resize-cursor';

/** The `<svg …>` document a cursor string embeds, decoded back out of its URI. */
function svgOf(cursor: string): string {
  const encoded = cursor.match(/data:image\/svg\+xml,([^"]+)/)?.[1];
  expect(encoded).toBeDefined();
  return decodeURIComponent(encoded!);
}

function angleOf(cursor: string): number {
  const angle = svgOf(cursor).match(/rotate\((-?[\d.]+) 16 16\)/)?.[1];
  expect(angle).toBeDefined();
  return Number(angle);
}

describe('resize cursor', () => {
  it('points along the direction the handle actually drags', () => {
    // A side handle drags along its own axis; a corner along its diagonal.
    expect(angleOf(resizeCursor('e', 0))).toBe(0);
    expect(angleOf(resizeCursor('n', 0))).toBe(90);
    expect(angleOf(resizeCursor('se', 0))).toBe(45);
    expect(angleOf(resizeCursor('ne', 0))).toBe(135);
    // The arrow is double-headed, so opposite handles share one glyph.
    expect(resizeCursor('e', 0)).toBe(resizeCursor('w', 0));
    expect(resizeCursor('nw', 0)).toBe(resizeCursor('se', 0));
  });

  it('follows the box to angles the native cursors cannot express', () => {
    // The whole point of synthesizing the glyph: 30 degrees is not one of the
    // eight keywords, and rounding to one would aim the arrow off the edge.
    expect(angleOf(resizeCursor('e', Math.PI / 6))).toBe(30);
    expect(angleOf(resizeCursor('n', Math.PI / 6))).toBe(120);
    // Turning a quarter turn puts a handle where its neighbour-plus-two was.
    expect(angleOf(resizeCursor('e', Math.PI / 2))).toBe(90);
  });

  it('holds the shadow to one screen-space light source', () => {
    // Rotating the shadow offset forward by the glyph's own angle lands back
    // on the same down-right vector: the light stays put as the arrow turns.
    for (const rotation of [0, Math.PI / 6, -Math.PI / 4, 1.1]) {
      const cursor = resizeCursor('ne', rotation);
      const svg = svgOf(cursor);
      const dx = Number(svg.match(/dx='(-?[\d.]+)'/)?.[1]);
      const dy = Number(svg.match(/dy='(-?[\d.]+)'/)?.[1]);
      const a = (angleOf(cursor) * Math.PI) / 180;

      expect(dx * Math.cos(a) - dy * Math.sin(a)).toBeCloseTo(1, 2);
      expect(dx * Math.sin(a) + dy * Math.cos(a)).toBeCloseTo(1, 2);
    }
  });

  it('keeps a native keyword behind the glyph', () => {
    // Quantized to the nearest eighth turn, which is all the keywords cover —
    // so the fallback for a box turned 30 degrees names the 45-degree cursor
    // while the glyph itself stays on 30. That gap is the reason for the glyph.
    expect(resizeCursor('e', 0).endsWith(', ew-resize')).toBe(true);
    expect(resizeCursor('e', Math.PI / 12).endsWith(', ew-resize')).toBe(true);
    expect(resizeCursor('e', Math.PI / 6).endsWith(', nwse-resize')).toBe(true);
    expect(angleOf(resizeCursor('e', Math.PI / 6))).toBe(30);
    expect(resizeCursor('e', Math.PI / 2).endsWith(', ns-resize')).toBe(true);
  });
});
