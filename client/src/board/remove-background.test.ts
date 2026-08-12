import { describe, expect, it } from 'vitest';

import {
  hasTransparency,
  opaqueBounds,
  removeBackgroundInPlace,
  sampleBackgroundColor,
} from './remove-background';

type Rgb = [number, number, number];

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [10, 10, 10];

/** An opaque RGBA buffer filled with `fill`. */
function image(width: number, height: number, fill: Rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = fill[0];
    data[p * 4 + 1] = fill[1];
    data[p * 4 + 2] = fill[2];
    data[p * 4 + 3] = 255;
  }
  const set = (x: number, y: number, color: Rgb) => {
    const i = (y * width + x) * 4;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, color: Rgb) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, color);
  };
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
  return { data, width, height, set, rect, alphaAt };
}

describe('hasTransparency', () => {
  it('is false for a fully opaque image', () => {
    expect(hasTransparency(image(10, 10, WHITE).data)).toBe(false);
  });

  it('ignores a couple of soft anti-aliasing pixels', () => {
    const img = image(20, 20, WHITE);
    img.data[3] = 0;
    expect(hasTransparency(img.data)).toBe(false);
  });

  it('is true once a real alpha channel is present', () => {
    const img = image(10, 10, WHITE);
    for (let p = 0; p < 20; p++) img.data[p * 4 + 3] = 0;
    expect(hasTransparency(img.data)).toBe(true);
  });
});

describe('sampleBackgroundColor', () => {
  it('takes the dominant border colour, not whichever corner comes first', () => {
    const img = image(16, 16, WHITE);
    // Artwork bleeding off the top-left corner: the mode must ignore it.
    img.rect(0, 0, 3, 3, BLACK);

    expect(sampleBackgroundColor(img.data, img.width, img.height)).toEqual([
      255, 255, 255,
    ]);
  });
});

describe('removeBackgroundInPlace', () => {
  it('erases the backdrop and keeps the artwork', () => {
    const img = image(32, 32, WHITE);
    img.rect(10, 10, 21, 21, BLACK);

    const result = removeBackgroundInPlace(img.data, img.width, img.height);

    expect(result.removed).toBe(true);
    expect(img.alphaAt(0, 0)).toBe(0);
    expect(img.alphaAt(31, 31)).toBe(0);
    expect(img.alphaAt(16, 16)).toBe(255);
  });

  it('keeps a backdrop-coloured region enclosed by the artwork', () => {
    const img = image(32, 32, WHITE);
    img.rect(8, 8, 23, 23, BLACK);
    // A white "highlight" walled in by the black square.
    img.rect(14, 14, 17, 17, WHITE);

    removeBackgroundInPlace(img.data, img.width, img.height);

    expect(img.alphaAt(0, 0)).toBe(0);
    expect(img.alphaAt(15, 15)).toBe(255);
  });

  it('feathers the rim between backdrop and artwork', () => {
    const img = image(32, 32, WHITE);
    img.rect(10, 10, 21, 21, BLACK);
    // One column of half-tone, as an anti-aliased edge would be.
    img.rect(9, 10, 9, 21, [190, 190, 190]);

    removeBackgroundInPlace(img.data, img.width, img.height);

    const rim = img.alphaAt(9, 15);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(255);
  });

  it('leaves an image that already has an alpha channel untouched', () => {
    const img = image(16, 16, WHITE);
    img.rect(4, 4, 11, 11, BLACK);
    for (let p = 0; p < 40; p++) img.data[p * 4 + 3] = 0;
    const before = Uint8ClampedArray.from(img.data);

    const result = removeBackgroundInPlace(img.data, img.width, img.height);

    expect(result).toEqual({ removed: false, erased: 0 });
    expect(img.data).toEqual(before);
  });

  it('abandons the cut-out when the key matches the whole image', () => {
    const img = image(16, 16, WHITE);

    const result = removeBackgroundInPlace(img.data, img.width, img.height);

    expect(result).toEqual({ removed: false, erased: 0 });
    expect(img.alphaAt(8, 8)).toBe(255);
  });
});

describe('opaqueBounds', () => {
  it('returns the tight box around what survived', () => {
    const img = image(32, 32, WHITE);
    img.rect(10, 12, 21, 19, BLACK);
    removeBackgroundInPlace(img.data, img.width, img.height);

    expect(opaqueBounds(img.data, img.width, img.height)).toEqual({
      x: 10,
      y: 12,
      width: 12,
      height: 8,
    });
  });

  it('is null when nothing is left', () => {
    const img = image(8, 8, WHITE);
    for (let p = 0; p < 64; p++) img.data[p * 4 + 3] = 0;

    expect(opaqueBounds(img.data, img.width, img.height)).toBeNull();
  });
});
