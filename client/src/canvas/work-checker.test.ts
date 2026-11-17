import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import { MAX_BLOCK_LINES, blockAround, linesOf, type Line } from './ink-lines';
import type { CommentMessage } from './use-comments-store';
import { orphanedMistakes, outdates, planPins, workSignature } from './work-checker';

const at = (id: string, minY: number, maxY: number, minX = 0) => ({
  id,
  bounds: { minX, minY, maxX: minX + 50, maxY },
});

describe('linesOf', () => {
  it('groups strokes into lines of working, top to bottom', () => {
    const lines = linesOf([
      at('b2', 100, 140, 60),
      at('a1', 0, 40),
      at('b1', 105, 135),
      at('a2', 5, 45, 60),
    ]);
    expect(lines.map((l) => [...l.ids].sort())).toEqual([
      ['a1', 'a2'],
      ['b1', 'b2'],
    ]);
    expect(lines[1]!.bounds).toEqual({ minX: 0, minY: 100, maxX: 110, maxY: 140 });
  });

  it('keeps a fraction on one line', () => {
    // Numerator and denominator clear of the "x =" and bar between them.
    const lines = linesOf([
      at('num', 0, 30, 60),
      at('x', 32, 52),
      at('bar', 39, 42, 60),
      at('den', 55, 85, 60),
      at('next', 130, 160),
    ]);
    expect(lines.map((l) => l.ids.length)).toEqual([4, 1]);
  });
});

// A row of 40-high strokes, 50 wide and 10 apart, from `x` onwards.
const row = (prefix: string, minY: number, count: number, x = 0) =>
  Array.from({ length: count }, (_, i) => at(`${prefix}${i}`, minY, minY + 40, x + i * 60));

describe('blockAround', () => {
  it('sends whole lines after a pause mid-line, with the lines above', () => {
    // Line b's first half was written before the pause, its second after.
    const shapes = [...row('a', 0, 4), ...row('b', 60, 4)];
    expect(blockAround(shapes, ['b2', 'b3']).sort()).toEqual(shapes.map((s) => s.id).sort());
  });

  it('takes the lines below the edit too', () => {
    const shapes = [...row('a', 0, 3), ...row('b', 60, 3), ...row('c', 120, 3)];
    expect(blockAround(shapes, ['a1'])).toEqual(expect.arrayContaining(['c0', 'c2']));
  });

  it('stops at a wide gap sideways and a blank band below', () => {
    const shapes = [
      ...row('a', 0, 3),
      ...row('col', 0, 3, 600), // Another column, 430 across.
      ...row('far', 400, 3), // Another block, 360 down.
    ];
    expect(blockAround(shapes, ['a0']).sort()).toEqual(['a0', 'a1', 'a2']);
  });

  it('caps the lines, keeping more above the edit than below', () => {
    const shapes = Array.from({ length: 20 }, (_, i) => at(`l${i}`, i * 60, i * 60 + 40));
    const ids = (edited: string) =>
      blockAround(shapes, [edited]).map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    expect(ids('l15')).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(ids('l19')).toHaveLength(MAX_BLOCK_LINES);
    expect(ids('l19')[0]).toBe(8);
    expect(ids('l1')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

const lineOf = (ids: string[], minY: number, maxX = 100): Line => ({
  ids,
  bounds: { minX: 0, minY, maxX, maxY: minY + 40 },
});

const thread = (line: Line, extra: Partial<CommentMessage> = {}) => ({
  id: `t${line.bounds.minY}`,
  threadId: `t${line.bounds.minY}`,
  pageId: 'p',
  text: 'wrong',
  authorName: 'Checker',
  authorColor: '#e5484d',
  createdAt: 0,
  resolved: false,
  box: {
    minX: line.bounds.minX - 6,
    minY: line.bounds.minY - 6,
    maxX: line.bounds.maxX + 6,
    maxY: line.bounds.maxY + 6,
  },
  shapeIds: line.ids,
  ...extra,
});

describe('planPins', () => {
  const one = lineOf(['a'], 0);
  const two = lineOf(['b', 'c'], 60);
  const all = () => true;
  const mistake = (line: number) => ({ line, message: 'm' });

  it('raises again a mistake on a thread the checker resolved itself', () => {
    const t = thread(two, { resolved: true });
    const plan = planPins([mistake(2)], [one, two], [t], true, all);
    expect(plan.pins).toHaveLength(1);
    expect(plan.pins[0]!.thread).toBeUndefined();
    expect(plan.clean).toBe(false);
  });

  it('skips one the user dismissed while its shapes all exist, and counts it clean', () => {
    const t = thread(two, { resolved: true, dismissed: true });
    expect(planPins([mistake(2)], [one, two], [t], true, all)).toEqual({
      pins: [],
      resolve: [],
      clean: true,
    });
    // Rewritten: part of the line is gone, so this is new working.
    const rewritten = planPins([mistake(2)], [one, two], [t], true, (id) => id !== 'c');
    expect(rewritten.pins).toHaveLength(1);
    // A manual check reports it regardless.
    expect(planPins([mistake(2)], [one, two], [t], false, all).pins).toHaveLength(1);
  });

  it('does not re-flag a line whose correction was added beside it', () => {
    const t = thread(two, { resolved: true, dismissed: true });
    const withCorrection = lineOf(['b', 'c', 'correction'], 60, 400);
    expect(planPins([mistake(2)], [one, withCorrection], [t], true, all).pins).toEqual([]);
  });

  it('does not suppress on a thread with no recorded shapes', () => {
    const t = thread(two, { resolved: true, dismissed: true, shapeIds: undefined });
    expect(planPins([mistake(2)], [one, two], [t], true, all).pins).toHaveLength(1);
  });

  it('keeps an open thread in place and resolves the ones no longer reported', () => {
    const t = thread(two);
    const kept = planPins([mistake(2)], [one, two], [t], true, all);
    expect(kept.pins[0]!.thread).toBe(t);
    expect(kept.resolve).toEqual([]);
    expect(planPins([mistake(1)], [one, two], [t], true, all).resolve).toEqual([t.id]);
    // Not a line the model saw: left alone.
    expect(planPins([], [one], [t], true, all).resolve).toEqual([]);
  });

  it('pins nothing for a tag it did not draw, and is not clean', () => {
    expect(planPins([mistake(7)], [one, two], [], true, all)).toEqual({
      pins: [],
      resolve: [],
      clean: false,
    });
  });
});

describe('orphanedMistakes', () => {
  const two = lineOf(['b', 'c'], 60);

  it('finds open threads whose shapes are all gone', () => {
    const t = thread(two);
    expect(orphanedMistakes([t], [at('b', 60, 100)])).toEqual([]);
    expect(orphanedMistakes([t], [at('z', 60, 100)])).toEqual([t.id]);
    expect(orphanedMistakes([{ ...t, resolved: true }], [])).toEqual([]);
  });

  it('falls back to what lies under the box for older threads', () => {
    const t = thread(two, { shapeIds: undefined });
    expect(orphanedMistakes([t], [at('z', 60, 100)])).toEqual([]);
    expect(orphanedMistakes([t], [at('z', 300, 340)])).toEqual([t.id]);
  });
});

describe('outdates', () => {
  const sent = {
    ids: new Set(['a']),
    rows: [{ minX: 0, minY: 0, maxX: 200, maxY: 40 }],
  };
  const row = (minY: number) => ({ minX: 300, minY, maxX: 350, maxY: minY + 40 });

  it('is an edit to a shape read or on a row read, not the next line down', () => {
    expect(outdates(sent, 'a', undefined)).toBe(true);
    expect(outdates(sent, 'new', row(10))).toBe(true);
    expect(outdates(sent, 'new', row(80))).toBe(false);
    expect(outdates(sent, 'gone', undefined)).toBe(false);
  });
});

describe('workSignature', () => {
  const equation = (latex: string, color = 'black') =>
    ({ id: 'e', type: 'equation', props: { latex, color } }) as unknown as Shape;
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 40 };

  it('ignores colour but not place or content', () => {
    const base = workSignature([{ shape: equation('x=1'), bounds }]);
    expect(workSignature([{ shape: equation('x=1', 'red'), bounds }])).toBe(base);
    expect(workSignature([{ shape: equation('x=2'), bounds }])).not.toBe(base);
    expect(
      workSignature([{ shape: equation('x=1'), bounds: { ...bounds, minX: 30, maxX: 130 } }]),
    ).not.toBe(base);
  });
});
