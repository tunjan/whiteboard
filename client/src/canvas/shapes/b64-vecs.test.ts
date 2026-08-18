import { describe, expect, it } from 'vitest';
import {
  decodeB64Vecs,
  encodeB64Vecs,
  encodedDimension,
  floatToHalf,
  halfToFloat,
} from './b64-vecs';

describe('Base64 vector segments', () => {
  it('uses an 8-byte Float32 anchor and 4-byte Float16 2D deltas', () => {
    const encoded = encodeB64Vecs([
      { x: 1.25, y: -2.5 },
      { x: 3.25, y: -1.5 },
      { x: 3.5, y: 4.5 },
    ]);

    // 16 payload bytes become 24 Base64 characters, plus the `2:` prefix.
    expect(encoded).toHaveLength(26);
    expect(encodedDimension(encoded)).toBe(2);
    expect(decodeB64Vecs(encoded)).toEqual([
      { x: 1.25, y: -2.5, pressure: 0.5 },
      { x: 3.25, y: -1.5, pressure: 0.5 },
      { x: 3.5, y: 4.5, pressure: 0.5 },
    ]);
  });

  it('uses a 12-byte anchor and 6-byte deltas when pressure varies', () => {
    const points = [
      { x: 100.125, y: -20.5, pressure: 0.2 },
      { x: 101.25, y: -18.25, pressure: 0.65 },
      { x: 104.5, y: -19, pressure: 0.4 },
    ];
    const encoded = encodeB64Vecs(points);
    const decoded = decodeB64Vecs(encoded);

    // 24 payload bytes become 32 Base64 characters, plus the `3:` prefix.
    expect(encoded).toHaveLength(34);
    expect(encodedDimension(encoded)).toBe(3);
    for (let index = 0; index < points.length; index++) {
      expect(decoded[index]?.x).toBeCloseTo(points[index]!.x, 3);
      expect(decoded[index]?.y).toBeCloseTo(points[index]!.y, 3);
      expect(decoded[index]?.pressure).toBeCloseTo(points[index]!.pressure!, 3);
    }
  });

  it('stores deltas against the preceding decoded point', () => {
    const points = Array.from({ length: 50 }, (_, index) => ({
      x: 12_000 + index * 0.125,
      y: -8_000 + Math.sin(index / 3),
      pressure: 0.1 + index / 100,
    }));
    const decoded = decodeB64Vecs(encodeB64Vecs(points));

    expect(decoded).toHaveLength(points.length);
    expect(decoded.at(-1)?.x).toBeCloseTo(points.at(-1)!.x, 3);
    expect(decoded.at(-1)?.y).toBeCloseTo(points.at(-1)!.y, 2);
    expect(decoded.at(-1)?.pressure).toBeCloseTo(points.at(-1)!.pressure!, 2);
  });

  it('rejects malformed dimensions, Base64, and byte layouts', () => {
    expect(decodeB64Vecs('4:AAAA')).toEqual([]);
    expect(decodeB64Vecs('2:not-base64')).toEqual([]);
    expect(decodeB64Vecs('2:AAAAAAAAAA=A')).toEqual([]);
    expect(decodeB64Vecs('3:AAAA')).toEqual([]);
    expect(encodedDimension('garbage')).toBeNull();
  });
});

describe('Float16 conversion', () => {
  it.each([0, -0, 0.0001, -2.5, 1 / 3, 1024, 65_504])(
    'round-trips %s within binary16 precision',
    (value) => {
      const decoded = halfToFloat(floatToHalf(value));
      const tolerance = Math.max(0.000001, Math.abs(value) / 1_000);
      expect(Math.abs(decoded - value)).toBeLessThanOrEqual(tolerance);
    },
  );

  it('sanitizes non-finite inputs and saturates finite overflow', () => {
    expect(halfToFloat(floatToHalf(Number.NaN))).toBe(0);
    expect(halfToFloat(floatToHalf(Number.POSITIVE_INFINITY))).toBe(0);
    expect(halfToFloat(floatToHalf(1e20))).toBe(65_504);
  });
});
