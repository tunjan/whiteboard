import { describe, expect, it } from 'vitest';
import { crc32, withPhysChunk } from './png-phys';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Serialize one PNG chunk: length, type, data, CRC(type + data). */
function chunk(type: string, data: number[] = []): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const length = [
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
  ];
  const crc = crc32(new Uint8Array([...typeBytes, ...data]));
  const crcBytes = [
    (crc >>> 24) & 0xff,
    (crc >>> 16) & 0xff,
    (crc >>> 8) & 0xff,
    crc & 0xff,
  ];
  return [...length, ...typeBytes, ...data, ...crcBytes];
}

/** A structurally valid PNG: signature, IHDR, optional extras, IDAT, IEND. */
function makePng(extra: number[] = []): ArrayBuffer {
  const ihdr = chunk('IHDR', Array.from({ length: 13 }, (_, i) => i));
  const idat = chunk('IDAT', [1, 2, 3, 4]);
  const iend = chunk('IEND');
  return new Uint8Array([...SIGNATURE, ...ihdr, ...extra, ...idat, ...iend])
    .buffer;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Offsets of every chunk of `type`, found by scanning the chunk list. */
function chunkOffsets(bytes: Uint8Array, type: string): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: number[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const name = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (name === type) found.push(offset);
    offset += length + 12;
  }
  return found;
}

describe('crc32', () => {
  it('matches the CRC the PNG spec fixes for an empty IEND chunk', () => {
    // IEND carries no data, so its CRC is a constant every PNG encoder emits.
    expect(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44]))).toBe(0xae426082);
  });

  it('is order-sensitive', () => {
    expect(crc32(new Uint8Array([1, 2, 3]))).not.toBe(
      crc32(new Uint8Array([3, 2, 1])),
    );
  });
});

describe('withPhysChunk', () => {
  it('inserts pHYs before the image data', async () => {
    const bytes = await bytesOf(withPhysChunk(makePng(), 2));

    const phys = chunkOffsets(bytes, 'pHYs');
    const idat = chunkOffsets(bytes, 'IDAT');
    expect(phys).toHaveLength(1);
    expect(phys[0]!).toBeLessThan(idat[0]!);
  });

  it('encodes the scaled resolution in pixels per metre', async () => {
    const bytes = await bytesOf(withPhysChunk(makePng(), 2));
    const view = new DataView(bytes.buffer);
    const start = chunkOffsets(bytes, 'pHYs')[0]!;

    // 72 DPI * 2 = 144 DPI, expressed per metre.
    const expected = Math.round((72 * 2) / 0.0254);
    expect(view.getUint32(start)).toBe(9);
    expect(view.getUint32(start + 8)).toBe(expected);
    expect(view.getUint32(start + 12)).toBe(expected);
    expect(view.getUint8(start + 16)).toBe(1);
  });

  it('writes a CRC that covers the chunk type and data', async () => {
    const bytes = await bytesOf(withPhysChunk(makePng(), 1));
    const view = new DataView(bytes.buffer);
    const start = chunkOffsets(bytes, 'pHYs')[0]!;

    const covered = bytes.subarray(start + 4, start + 4 + 4 + 9);
    expect(view.getUint32(start + 17)).toBe(crc32(covered));
  });

  it('replaces an existing pHYs rather than adding a second', async () => {
    const stale = chunk('pHYs', [0, 0, 0, 1, 0, 0, 0, 1, 1]);
    const bytes = await bytesOf(withPhysChunk(makePng(stale), 2));
    const view = new DataView(bytes.buffer);

    const phys = chunkOffsets(bytes, 'pHYs');
    expect(phys).toHaveLength(1);
    expect(view.getUint32(phys[0]! + 8)).toBe(Math.round((72 * 2) / 0.0254));
  });

  it('keeps the rest of the file byte-identical', async () => {
    const original = new Uint8Array(makePng());
    const bytes = await bytesOf(withPhysChunk(makePng(), 2));

    expect(bytes.length).toBe(original.length + 21);
    const physStart = chunkOffsets(bytes, 'pHYs')[0]!;
    const withoutPhys = new Uint8Array([
      ...bytes.subarray(0, physStart),
      ...bytes.subarray(physStart + 21),
    ]);
    expect(withoutPhys).toEqual(original);
  });

  it('leaves data it cannot parse as a PNG untouched', async () => {
    const notPng = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer;

    expect(await bytesOf(withPhysChunk(notPng, 2))).toEqual(
      new Uint8Array(notPng),
    );
    // A truncated chunk header must not be walked off the end of the buffer.
    const truncated = new Uint8Array([...SIGNATURE, 0, 0, 0, 200, 73, 68, 65, 84]).buffer;
    expect((await bytesOf(withPhysChunk(truncated, 2))).length).toBe(16);
  });

  it('is a no-op for a non-positive scale', async () => {
    const original = new Uint8Array(makePng());

    expect(await bytesOf(withPhysChunk(makePng(), 0))).toEqual(original);
  });
});
