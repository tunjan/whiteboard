import { describe, expect, it } from 'vitest';
import { rangeError } from '@/components/pdf-range-dialog';
import { pdfColumnLayout } from './place-pdf';

const A4 = { worldW: 595, worldH: 842 };
const AT = { x: 100, y: 100 };

describe('pdfColumnLayout', () => {
  it('centres a single page on the paste point', () => {
    const [page] = pdfColumnLayout([A4], AT);
    expect(page).toMatchObject({ x: 100 - 595 / 2, y: 100 - 842 / 2 });
  });

  it('stacks pages top to bottom with a gap', () => {
    const [first, second] = pdfColumnLayout([A4, A4], AT);
    expect(second!.y - first!.y).toBe(842 + 24);
    expect(second!.x).toBe(first!.x);
  });

  it('centres the whole column, not the first page', () => {
    const pages = pdfColumnLayout([A4, A4, A4], AT);
    const height = 3 * 842 + 2 * 24;
    expect(pages[0]!.y).toBe(100 - height / 2);
    expect(pages[2]!.y + 842).toBe(100 + height / 2);
  });

  it('centres pages of differing widths on the same axis', () => {
    const pages = pdfColumnLayout([A4, { worldW: 300, worldH: 400 }], AT);
    expect(pages[0]!.x + 595 / 2).toBe(100);
    expect(pages[1]!.x + 300 / 2).toBe(100);
  });

  it('carries the source fields through', () => {
    const [page] = pdfColumnLayout([{ ...A4, blobId: 'abc' }], AT);
    expect(page!.blobId).toBe('abc');
  });

  it('places nothing for no pages', () => {
    expect(pdfColumnLayout([], AT)).toEqual([]);
  });
});

describe('rangeError', () => {
  it('accepts a range within both the document and the limit', () => {
    expect(rangeError('5', '14', 40, 10)).toBeNull();
    expect(rangeError('1', '1', 40, 10)).toBeNull();
  });

  it('rejects a range longer than the limit', () => {
    expect(rangeError('1', '11', 40, 10)).toMatch(/11 pages/);
  });

  it('rejects a range past the end of the document', () => {
    expect(rangeError('38', '41', 40, 10)).toMatch(/pages 1 to 40/);
    expect(rangeError('0', '5', 40, 10)).toMatch(/pages 1 to 40/);
  });

  it('rejects a reversed range', () => {
    expect(rangeError('9', '4', 40, 10)).toMatch(/before the first/);
  });

  it('rejects blank and non-integer input', () => {
    expect(rangeError('', '10', 40, 10)).toMatch(/page number/);
    expect(rangeError('2', '  ', 40, 10)).toMatch(/page number/);
    expect(rangeError('1.5', '4', 40, 10)).toMatch(/page number/);
  });
});
