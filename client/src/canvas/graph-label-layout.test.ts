import { describe, expect, it } from 'vitest';
import { placePointLabels } from './graph-label-layout';

const bounds = { x: 0, y: 0, w: 400, h: 300 };
const options = { fontSize: 13, dotRadius: 7, offset: 8 };

describe('placePointLabels', () => {
  it('puts a lone label above-right of its dot', () => {
    const [label] = placePointLabels([{ x: 100, y: 100, width: 60 }], bounds, options);
    expect(label).toEqual({ x: 108, y: 92 - 13 + 13 * 0.8, anchor: 'start' });
  });

  it('flips to the left near the right edge', () => {
    const [label] = placePointLabels([{ x: 380, y: 100, width: 60 }], bounds, options);
    expect(label?.anchor).toBe('end');
    expect(label?.x).toBe(372);
  });

  it('moves a second label to a free slot instead of overlapping', () => {
    const [a, b] = placePointLabels(
      [
        { x: 100, y: 100, width: 60 },
        { x: 110, y: 100, width: 60 },
      ],
      bounds,
      options,
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b).not.toEqual(a);
  });

  it('drops labels when a row of dots is too dense to label', () => {
    // Twenty dots 12px apart along one line: far too tight for 60px labels.
    const requests = Array.from({ length: 20 }, (_, i) => ({
      x: 20 + i * 12,
      y: 150,
      width: 60,
    }));
    const labels = placePointLabels(requests, bounds, options);
    const placed = labels.filter((l) => l !== null);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(requests.length);
    expect(labels[0]).not.toBeNull();
  });

  it('keeps clear of lines, and drops a label with nowhere clean to go', () => {
    const diagonal = [
      { x: 60, y: 140 },
      { x: 100, y: 100 },
      { x: 140, y: 60 },
    ];
    const [label] = placePointLabels([{ x: 100, y: 100, width: 60 }], bounds, {
      ...options,
      lines: [diagonal],
    });
    expect(label?.anchor).toBe('end');
    expect(label?.y).toBeLessThan(100);

    // Rules through every slot's row: nowhere clean, so no label.
    const rules = [85, 100, 115].map((y) => [
      { x: 0, y },
      { x: 400, y },
    ]);
    const [boxedIn] = placePointLabels([{ x: 100, y: 100, width: 60 }], bounds, {
      ...options,
      lines: rules,
    });
    expect(boxedIn).toBeNull();
  });

  it('keeps a silent point clear without labelling it', () => {
    const [a, b] = placePointLabels(
      [
        { x: 100, y: 100, width: 60, silent: true },
        { x: 100, y: 120, width: 60 },
      ],
      bounds,
      options,
    );
    expect(a).toBeNull();
    expect(b).not.toBeNull();
    expect(b?.y).toBeGreaterThan(100 + options.dotRadius);
  });

  it('avoids obstacles', () => {
    const [label] = placePointLabels([{ x: 100, y: 100, width: 60 }], bounds, {
      ...options,
      obstacles: [{ x: 100, y: 70, w: 80, h: 25 }],
    });
    expect(label?.anchor).toBe('end');
  });
});
