/**
 * PNG `pHYs` (physical pixel dimensions) chunk injection.
 *
 * `canvas.toBlob('image/png')` writes no `pHYs` chunk, so every consumer falls
 * back to 72 DPI and treats the pixel grid as the logical size. Our exports are
 * rasterized at up to 2x, so a 2x image opened in Preview, Word, or Figma comes
 * out at twice the size it had on the board. Declaring the physical resolution
 * tells those consumers how to scale it back down.
 *
 * Chromium re-encodes images during clipboard sanitization and drops ancillary
 * chunks, so this survives the clipboard on Safari and Firefox but generally not
 * on Chrome. It always survives a downloaded file, on every browser.
 */

/** Bytes of a PNG chunk that are not its payload: length + type + CRC. */
const CHUNK_OVERHEAD = 12;
/** Length of a `pHYs` payload: two uint32 resolutions plus the unit byte. */
const PHYS_DATA_LENGTH = 9;
/** A whole `pHYs` chunk on the wire. */
const PHYS_CHUNK_LENGTH = PHYS_DATA_LENGTH + CHUNK_OVERHEAD;
/** Metres per inch — converts a DPI figure into the `pHYs` pixels-per-metre unit. */
const METRES_PER_INCH = 0.0254;
/** The DPI every consumer assumes when a PNG declares no physical resolution. */
const BASE_DPI = 72;

let crcTable: Uint32Array | null = null;

/** Lazily-built IEEE 802.3 CRC-32 table (the polynomial PNG mandates). */
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 over `bytes`, as PNG computes it for each chunk (type + data). */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ChunkLocation {
  /** Offset of the chunk's length field. */
  start: number;
  /** Bytes the chunk occupies in full. */
  totalSize: number;
}

/**
 * Locate the first chunk of `type`, walking the chunk list from the 8-byte
 * signature. Returns null for a truncated or non-PNG buffer rather than
 * throwing — callers fall back to the unmodified image.
 */
function findChunk(view: DataView, type: string): ChunkLocation | null {
  let offset = 8;
  while (offset + CHUNK_OVERHEAD <= view.byteLength) {
    const length = view.getUint32(offset);
    const name = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    );
    const totalSize = length + CHUNK_OVERHEAD;
    // A length that runs past the buffer means the data isn't a PNG we can
    // safely rewrite; stop rather than reading whatever follows.
    if (offset + totalSize > view.byteLength) return null;
    if (name === type) return { start: offset, totalSize };
    offset += totalSize;
  }
  return null;
}

/** Serialize a `pHYs` chunk declaring `pixelsPerMetre` on both axes. */
function buildPhysChunk(pixelsPerMetre: number): ArrayBuffer {
  const buffer = new ArrayBuffer(PHYS_CHUNK_LENGTH);
  const view = new DataView(buffer);
  view.setUint32(0, PHYS_DATA_LENGTH);
  view.setUint8(4, 0x70); // 'p'
  view.setUint8(5, 0x48); // 'H'
  view.setUint8(6, 0x59); // 'Y'
  view.setUint8(7, 0x73); // 's'
  view.setUint32(8, pixelsPerMetre); // x axis
  view.setUint32(12, pixelsPerMetre); // y axis
  view.setUint8(16, 1); // unit specifier: 1 = metre
  // The CRC covers the type and the data, but not the length field.
  view.setUint32(17, crc32(new Uint8Array(buffer, 4, 4 + PHYS_DATA_LENGTH)));
  return buffer;
}

/**
 * Return `png` with a `pHYs` chunk declaring `scale`x the base 72 DPI, so the
 * image reports the logical size it was laid out at rather than its raster
 * size. An existing `pHYs` is replaced; anything that isn't a parseable PNG is
 * returned untouched.
 */
export function withPhysChunk(png: ArrayBuffer, scale: number): Blob {
  const type = 'image/png';
  if (!(scale > 0) || png.byteLength < 8) return new Blob([png], { type });

  const view = new DataView(png);
  const existing = findChunk(view, 'pHYs');
  // `pHYs` must precede the first IDAT. Replacing one in place keeps that true;
  // otherwise insert immediately before the image data.
  const anchor = existing ?? findChunk(view, 'IDAT');
  if (!anchor) return new Blob([png], { type });

  const chunk = buildPhysChunk(Math.round((BASE_DPI * scale) / METRES_PER_INCH));
  const head = png.slice(0, anchor.start);
  const tail = png.slice(anchor.start + (existing ? existing.totalSize : 0));
  return new Blob([head, chunk, tail], { type });
}
