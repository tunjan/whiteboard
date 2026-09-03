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

describe('tilt channels', () => {
  it('widens to five channels only when a sample carries a lean', () => {
    const upright = [
      { x: 0, y: 0, pressure: 0.9, tiltX: 0, tiltY: 0 },
      { x: 1, y: 1, pressure: 0.8, tiltX: 0, tiltY: 0 },
    ];
    // A stylus held vertical for a whole stroke has nothing to store, and must
    // not pay four bytes a sample to say so.
    expect(encodedDimension(encodeB64Vecs(upright))).toBe(3);
    expect(
      encodedDimension(
        encodeB64Vecs([{ x: 0, y: 0, pressure: 0.5, tiltX: 0.4, tiltY: 0 }]),
      ),
    ).toBe(5);
  });

  it('round-trips lean along with position and pressure', () => {
    const points = [
      { x: 12.5, y: -3.25, pressure: 0.75, tiltX: 0.5, tiltY: -0.25 },
      { x: 14.5, y: -1.25, pressure: 0.5, tiltX: 0.25, tiltY: -0.5 },
      { x: 18.5, y: 2.75, pressure: 0.25, tiltX: -0.5, tiltY: 0.75 },
    ];
    const decoded = decodeB64Vecs(encodeB64Vecs(points));

    expect(decoded).toHaveLength(3);
    for (const [index, point] of points.entries()) {
      const back = decoded[index]!;
      expect(back.x).toBeCloseTo(point.x, 3);
      expect(back.y).toBeCloseTo(point.y, 3);
      expect(back.pressure).toBeCloseTo(point.pressure, 3);
      expect(back.tiltX).toBeCloseTo(point.tiltX, 3);
      expect(back.tiltY).toBeCloseTo(point.tiltY, 3);
    }
  });

  it('leaves tilt off a segment that does not carry it', () => {
    // Absent is not zero: a stroke drawn before tilt was read must decode to
    // the samples it was written from, so nothing downstream can mistake it
    // for a pen that was measured and found upright.
    const [point] = decodeB64Vecs(encodeB64Vecs([{ x: 1, y: 2, pressure: 0.3 }]));
    expect(point).not.toHaveProperty('tiltX');
    expect(point).not.toHaveProperty('tiltY');
  });

  it('rejects a dimension it does not know', () => {
    expect(encodedDimension('4:AAAA')).toBeNull();
    expect(decodeB64Vecs('4:AAAA')).toEqual([]);
  });
});
