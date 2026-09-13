import { describe, expect, it } from 'vitest';
import { rotationCursor } from './rotation-cursor';

/** The `<svg …>` document a cursor string embeds, decoded back out of its URI. */
function svgOf(cursor: string): string {
  const encoded = cursor.match(/data:image\/svg\+xml,([^"]+)/)?.[1];
  expect(encoded).toBeDefined();
  return decodeURIComponent(encoded!);
}

function shadowOffset(cursor: string): { dx: number; dy: number } {
  const svg = svgOf(cursor);
  const dx = Number(svg.match(/dx='(-?[\d.]+)'/)?.[1]);
  const dy = Number(svg.match(/dy='(-?[\d.]+)'/)?.[1]);
  return { dx, dy };
}

describe('rotation cursor', () => {
  it('wires the glyph to the shadow filter it declares', () => {
    const svg = svgOf(rotationCursor('rotate-nw', 0));

    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    // A filter reference that does not resolve leaves the cursor unshadowed
    // with no error anywhere, so the id and its use are checked together.
    expect(svg).toContain("<filter id='shadow'");
    expect(svg).toContain("filter='url(#shadow)'");
    // The glyph turns about the middle of the 32px box, which is also the
    // hotspot, so the cursor's tip stays on the point it is aimed at.
    expect(svg).toContain('rotate(0 16 16)');
    expect(rotationCursor('rotate-nw', 0)).toContain('") 16 16, default');
  });

  it('holds the shadow to one screen-space light source', () => {
    // Whatever the glyph's total angle, rotating its shadow offset forward by
    // that angle lands on the same down-right vector: the light stays put
    // while the arrow turns under it.
    for (const [handle, rotation] of [
      ['rotate-nw', 0],
      ['rotate-ne', 0],
      ['rotate-se', Math.PI / 3],
      ['rotate-sw', -Math.PI / 4],
    ] as const) {
      const base = { 'rotate-nw': 0, 'rotate-ne': 90, 'rotate-se': 180, 'rotate-sw': 270 }[
        handle
      ];
      const total = ((Math.round(base + (rotation * 180) / Math.PI) % 360) + 360) % 360;
      const a = (total * Math.PI) / 180;
      const { dx, dy } = shadowOffset(rotationCursor(handle, rotation));

      expect(dx * Math.cos(a) - dy * Math.sin(a)).toBeCloseTo(1, 2);
      expect(dx * Math.sin(a) + dy * Math.cos(a)).toBeCloseTo(1, 2);
    }
  });
});
