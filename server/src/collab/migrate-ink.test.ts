import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  decodeInkChunk,
  encodeInkChunk,
  sameStoredPoint,
  type DrawPoint,
} from '@whiteboard/shared';
import { migrateInk, readLegacyPoints } from './migrate-ink';

// Written by the Base64 encoder this format replaced, with what its decoder
// read back from each.
const BASE64_PRESSURE = '3:zcwkQWZmlsBSuJ4+M0FmPikwTUCaQh8t';
const BASE64_PRESSURE_POINTS = [
  { x: 10.3, y: -4.7, pressure: 0.31 },
  { x: 12.899609, y: -3.100391, pressure: 0.440005 },
  { x: 15.05, y: 0.20039, pressure: 0.520022 },
];
const BASE64_TILT = '5:AACAPwAAAEAAAAA/AACAPgAAAL8AQQA0AABmKmYu';
const BASE64_TILT_POINTS = [
  { x: 1, y: 2, pressure: 0.5, tiltX: 0.25, tiltY: -0.5 },
  { x: 3.5, y: 2.25, pressure: 0.5, tiltX: 0.299988, tiltY: -0.400024 },
];
const BASE64_FLAT = '2:AADJQgBASEMAPQC9';
const BASE64_FLAT_POINTS = [
  { x: 100.5, y: 200.25, pressure: 0.5 },
  { x: 101.75, y: 199, pressure: 0.5 },
];

const stroke: DrawPoint[] = [
  { x: 1, y: 2, pressure: 0.25 },
  { x: 3, y: 5, pressure: 0.75 },
];

function board(mapName = 'shapes') {
  const doc = new Y.Doc();
  const shapes = doc.getMap<Y.Map<unknown>>(mapName);
  const add = (id: string, points: unknown, props: object = {}) => {
    const m = new Y.Map<unknown>();
    shapes.set(id, m);
    m.set('type', 'draw');
    m.set('props', { color: '#000', size: 4, ...props });
    if (points !== undefined) m.set('points', points);
    return m;
  };
  return { doc, shapes, add };
}

function pointsOf(m: Y.Map<unknown>): DrawPoint[] {
  const arr = m.get('points') as Y.Array<Uint8Array>;
  return arr.toArray().flatMap(decodeInkChunk);
}

function expectStored(actual: DrawPoint[], expected: DrawPoint[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, i) =>
    expect(sameStoredPoint(point, expected[i]!)).toBe(true),
  );
}

describe('readLegacyPoints', () => {
  it('decodes Base64 segments exactly as their own decoder did', () => {
    expect(readLegacyPoints([BASE64_PRESSURE])).toEqual(BASE64_PRESSURE_POINTS);
    expect(readLegacyPoints([BASE64_TILT])).toEqual(BASE64_TILT_POINTS);
    expect(readLegacyPoints([BASE64_FLAT, BASE64_PRESSURE])).toEqual([
      ...BASE64_FLAT_POINTS,
      ...BASE64_PRESSURE_POINTS,
    ]);
  });

  it('reads number triples and point objects', () => {
    expect(readLegacyPoints([1, 2, 0.25, 3, 5, 0.75])).toEqual(stroke);
    expect(readLegacyPoints(stroke)).toEqual(stroke);
  });

  it('drops what it cannot read', () => {
    expect(readLegacyPoints(['9:AAAA', 'nonsense', null])).toEqual([]);
  });
});

describe('migrateInk', () => {
  it('rewrites every legacy form into one chunk', () => {
    const { doc, add } = board();
    const b64 = add('b64', Y.Array.from([BASE64_FLAT, BASE64_PRESSURE]));
    const triples = add('triples', Y.Array.from([1, 2, 0.25, 3, 5, 0.75]));
    const objects = add('objects', Y.Array.from(stroke));
    const inProps = add('props', undefined, { points: stroke });

    expect(migrateInk(doc)).toEqual({ migrated: 4, current: 0 });

    expectStored(pointsOf(b64), [
      ...BASE64_FLAT_POINTS,
      ...BASE64_PRESSURE_POINTS,
    ]);
    expect((b64.get('points') as Y.Array<unknown>).length).toBe(1);
    expect(pointsOf(triples)).toEqual(stroke);
    expect(pointsOf(objects)).toEqual(stroke);
    expect(pointsOf(inProps)).toEqual(stroke);
    expect(inProps.get('props')).toEqual({ color: '#000', size: 4 });
  });

  it('prefers the Y.Array over a stale props copy, and drops the copy', () => {
    const { doc, add } = board();
    const m = add('s', Y.Array.from(stroke), { points: [{ x: 9, y: 9 }] });
    migrateInk(doc);
    expect(pointsOf(m)).toEqual(stroke);
    expect(m.get('props')).not.toHaveProperty('points');
  });

  it('reaches the per-page maps of a board document from before the split', () => {
    const { doc, add } = board('shapes:page-2');
    const m = add('s', Y.Array.from(stroke));
    // The migration only sees names the document already holds, as it does
    // when the document comes from storage.
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, Y.encodeStateAsUpdate(doc));
    expect(migrateInk(loaded)).toEqual({ migrated: 1, current: 0 });
    expect(m.get('points')).toBeInstanceOf(Y.Array);
    const shape = loaded.getMap<Y.Map<unknown>>('shapes:page-2').get('s')!;
    expect(pointsOf(shape)).toEqual(stroke);
  });

  it('leaves current strokes and other shapes alone, and is idempotent', () => {
    const { doc, shapes, add } = board();
    add('current', Y.Array.from([encodeInkChunk(stroke)]));
    add('empty', Y.Array.from([] as Uint8Array[]));
    const rect = new Y.Map<unknown>();
    shapes.set('rect', rect);
    rect.set('type', 'rectangle');
    rect.set('props', { points: 'not ink' });
    add('legacy', Y.Array.from(stroke));

    expect(migrateInk(doc)).toEqual({ migrated: 1, current: 2 });
    const before = Y.encodeStateVector(doc);
    expect(migrateInk(doc)).toEqual({ migrated: 0, current: 3 });
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(rect.get('props')).toEqual({ points: 'not ink' });
  });

  it('shrinks a Base64-era document', () => {
    const { doc, add } = board();
    const segment = [BASE64_PRESSURE, BASE64_FLAT, BASE64_TILT];
    for (let i = 0; i < 200; i++) {
      add(
        `s${i}`,
        Y.Array.from(Array.from({ length: 30 }, (_, j) => segment[j % 3]!)),
      );
    }
    const migrated = new Y.Doc();
    Y.applyUpdateV2(migrated, Y.encodeStateAsUpdateV2(doc));
    const before = Y.encodeStateAsUpdateV2(migrated).length;
    migrateInk(migrated);
    expect(Y.encodeStateAsUpdateV2(migrated).length).toBeLessThan(before * 0.7);
  });
});
