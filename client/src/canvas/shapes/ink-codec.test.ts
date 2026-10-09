import { describe, expect, it } from 'vitest';
import {
  decodeInkChunk,
  encodeInkChunk,
  inkChunkDimension,
  sameStoredPoint,
} from '@whiteboard/shared';

describe('ink chunks', () => {
  it('stores position-only points in one header byte plus varints', () => {
    const chunk = encodeInkChunk([
      { x: 1.25, y: -2.5 },
      { x: 3.25, y: -1.5 },
      { x: 3.5, y: 4.5 },
    ]);

    // Header, then the first point against zero (40 and -80 in 1/32 units,
    // one byte each after zigzag), then steps of 64/32/8/192.
    expect(inkChunkDimension(chunk)).toBe(2);
    expect(chunk.length).toBeLessThanOrEqual(1 + 6 * 2);
    expect(decodeInkChunk(chunk)).toEqual([
      { x: 1.25, y: -2.5, pressure: 0.5 },
      { x: 3.25, y: -1.5, pressure: 0.5 },
      { x: 3.5, y: 4.5, pressure: 0.5 },
    ]);
  });

  it('adds a pressure channel only when pressure varies', () => {
    const points = [
      { x: 100.125, y: -20.5, pressure: 0.25 },
      { x: 101.25, y: -18.25, pressure: 0.625 },
      { x: 104.5, y: -19, pressure: 0.375 },
    ];
    const chunk = encodeInkChunk(points);
    expect(inkChunkDimension(chunk)).toBe(3);
    expect(decodeInkChunk(chunk)).toEqual(points);
    expect(inkChunkDimension(encodeInkChunk([{ x: 1, y: 1 }]))).toBe(2);
  });

  it('decodes every point to its quantized sample, however long the chunk', () => {
    // Integer deltas cannot drift: the last point is as exact as the first.
    const points = Array.from({ length: 5000 }, (_, index) => ({
      x: 12_000 + Math.cos(index / 7) * 300 + index * 0.37,
      y: -8_000 + Math.sin(index / 3) * 40,
      pressure: 0.1 + (index % 90) / 100,
    }));
    const decoded = decodeInkChunk(encodeInkChunk(points));
    expect(decoded).toHaveLength(points.length);
    for (const [index, point] of points.entries()) {
      const back = decoded[index]!;
      expect(Math.abs(back.x - point.x)).toBeLessThanOrEqual(1 / 64);
      expect(Math.abs(back.y - point.y)).toBeLessThanOrEqual(1 / 64);
      expect(Math.abs(back.pressure! - point.pressure)).toBeLessThanOrEqual(
        1 / 512,
      );
      expect(sameStoredPoint(back, point)).toBe(true);
    }
  });

  it('keeps coordinates past 32-bit range', () => {
    const points = [
      { x: 5e9, y: -5e9, pressure: 0.5 },
      { x: -5e9, y: 5e9, pressure: 0.5 },
    ];
    expect(decodeInkChunk(encodeInkChunk(points))).toEqual(points);
  });

  it('repeats the previous coordinate in place of a non-finite one', () => {
    expect(
      decodeInkChunk(
        encodeInkChunk([
          { x: 2, y: 3 },
          { x: Number.NaN, y: 4 },
        ]),
      ),
    ).toEqual([
      { x: 2, y: 3, pressure: 0.5 },
      { x: 2, y: 4, pressure: 0.5 },
    ]);
  });

  it('is about half the size of the Base64 Float16-delta form', () => {
    const points = Array.from({ length: 300 }, (_, index) => ({
      x: 400 + index * 2.2 + Math.sin(index / 5) * 6,
      y: 900 + Math.cos(index / 4) * 12,
      pressure: 0.5 + Math.sin(index / 20) * 0.3,
    }));
    // That form: a 12-byte anchor and 6 bytes a point, then Base64's 4/3.
    const base64Float16 = Math.ceil((12 + 299 * 6) / 3) * 4;
    expect(encodeInkChunk(points).length).toBeLessThan(base64Float16 * 0.55);
  });

  it('rejects malformed chunks rather than decoding garbage', () => {
    expect(inkChunkDimension(new Uint8Array([4, 0, 0]))).toBeNull();
    expect(decodeInkChunk(new Uint8Array([4, 0, 0]))).toEqual([]);
    expect(inkChunkDimension(new Uint8Array())).toBeNull();
    expect(inkChunkDimension('2:AAAA')).toBeNull();
    // Cut mid-varint, and cut between a point's channels.
    expect(decodeInkChunk(new Uint8Array([2, 0x80]))).toEqual([]);
    expect(decodeInkChunk(new Uint8Array([2, 2, 2, 2]))).toEqual([]);
  });
});

describe('sameStoredPoint', () => {
  it('matches exactly what the encoder rounds together', () => {
    const a = { x: 1, y: 1, pressure: 0.5 };
    expect(sameStoredPoint(a, { x: 1.01, y: 1, pressure: 0.5 })).toBe(true);
    expect(sameStoredPoint(a, { x: 1.02, y: 1, pressure: 0.5 })).toBe(false);
    expect(sameStoredPoint(a, { x: 1, y: 1 })).toBe(true);
    expect(sameStoredPoint(a, { x: 1, y: 1, pressure: 0.6 })).toBe(false);
    expect(sameStoredPoint(a, { ...a, tiltX: 0 })).toBe(true);
    expect(sameStoredPoint(a, { ...a, tiltX: 0.2 })).toBe(false);
  });
});

describe('tilt channels', () => {
  it('widens to five channels only when a sample carries a lean', () => {
    const upright = [
      { x: 0, y: 0, pressure: 0.875, tiltX: 0, tiltY: 0 },
      { x: 1, y: 1, pressure: 0.75, tiltX: 0, tiltY: 0 },
    ];
    // A stylus held vertical for a whole stroke has nothing to store.
    expect(inkChunkDimension(encodeInkChunk(upright))).toBe(3);
    expect(
      inkChunkDimension(
        encodeInkChunk([{ x: 0, y: 0, pressure: 0.5, tiltX: 0.4, tiltY: 0 }]),
      ),
    ).toBe(5);
  });

  it('round-trips lean along with position and pressure', () => {
    const points = [
      { x: 12.5, y: -3.25, pressure: 0.75, tiltX: 0.5, tiltY: -0.25 },
      { x: 14.5, y: -1.25, pressure: 0.5, tiltX: 0.25, tiltY: -0.5 },
      { x: 18.5, y: 2.75, pressure: 0.25, tiltX: -0.5, tiltY: 0.75 },
    ];
    expect(decodeInkChunk(encodeInkChunk(points))).toEqual(points);
  });

  it('leaves tilt off a chunk that does not carry it', () => {
    const [point] = decodeInkChunk(
      encodeInkChunk([{ x: 1, y: 2, pressure: 0.3 }]),
    );
    expect(point).not.toHaveProperty('tiltX');
    expect(point).not.toHaveProperty('tiltY');
  });
});
