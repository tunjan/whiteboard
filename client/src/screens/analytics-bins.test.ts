import { describe, expect, it } from 'vitest';
import type { AnalyticsVisit } from '@whiteboard/shared';
import {
  binTotal,
  binVisits,
  chartScale,
  presenceSegments,
} from './analytics-bins';

const MIN = 60_000;

function visit(over: Partial<AnalyticsVisit>): AnalyticsVisit {
  return {
    name: 'Ada',
    isTutor: false,
    color: null,
    startedAt: 0,
    endedAt: 60 * MIN,
    minutes: 60,
    drawings: 0,
    aloneMinutes: 0,
    afkMinutes: 0,
    afkSpans: [],
    aloneSpans: [],
    ...over,
  };
}

describe('presenceSegments', () => {
  it('reads a visit with no spans as all with the tutor', () => {
    expect(presenceSegments(visit({}))).toEqual([
      { from: 0, to: 60 * MIN, presence: 'with' },
    ]);
  });

  it('cuts at every change of state, in order', () => {
    const segments = presenceSegments(
      visit({
        aloneSpans: [
          [0, 5 * MIN],
          [40 * MIN, 45 * MIN],
          [50 * MIN, 60 * MIN],
        ],
        afkSpans: [[45 * MIN, 50 * MIN]],
      }),
    );
    expect(segments.map((s) => [s.presence, s.from / MIN, s.to / MIN])).toEqual([
      ['alone', 0, 5],
      ['with', 5, 40],
      ['alone', 40, 45],
      ['afk', 45, 50],
      ['alone', 50, 60],
    ]);
  });

  it('joins neighbouring spans of the same state', () => {
    const segments = presenceSegments(
      visit({
        aloneSpans: [
          [0, 30 * MIN],
          [30 * MIN, 60 * MIN],
        ],
      }),
    );
    expect(segments).toEqual([{ from: 0, to: 60 * MIN, presence: 'alone' }]);
  });

  it('keeps a mark for a visit with no length', () => {
    expect(presenceSegments(visit({ endedAt: 0, minutes: 0 }))).toHaveLength(1);
  });
});

describe('binVisits', () => {
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 9, day, hour, minute).getTime();

  it('sums a day and splits it by presence', () => {
    const bins = binVisits(
      [
        visit({ startedAt: at(14, 9), minutes: 50, aloneMinutes: 10 }),
        visit({ startedAt: at(14, 18), minutes: 20, aloneMinutes: 20, afkMinutes: 5 }),
        visit({ startedAt: at(15, 9), minutes: 30 }),
      ],
      30,
      at(14, 8),
      at(15, 12),
    );
    expect(bins).toHaveLength(2);
    expect(bins[0]).toMatchObject({ visits: 2, with: 40, alone: 30, afk: 5 });
    expect(binTotal(bins[0]!)).toBe(70);
    expect(bins[0]!.at).toBe(at(14, 0));
    expect(bins[0]!.end).toBe(at(15, 0));
  });

  it('keeps the empty days of the window', () => {
    const bins = binVisits(
      [visit({ startedAt: at(16, 9) })],
      7,
      at(14, 12),
      at(17, 12),
    );
    expect(bins.map((b) => b.visits)).toEqual([0, 0, 1, 0]);
  });

  it('groups a year by Monday week', () => {
    // 12 Oct 2026 is a Monday.
    const bins = binVisits(
      [
        visit({ startedAt: at(12, 9) }),
        visit({ startedAt: at(18, 21) }),
        visit({ startedAt: at(19, 9) }),
      ],
      365,
      at(12, 0),
      at(19, 12),
    );
    expect(bins.map((b) => [b.at, b.visits])).toEqual([
      [at(12, 0), 2],
      [at(19, 0), 1],
    ]);
  });

  it('cuts a visit at the hour across a day', () => {
    const startedAt = at(14, 9, 30);
    const bins = binVisits(
      [
        visit({
          startedAt,
          endedAt: startedAt + 60 * MIN,
          aloneSpans: [[startedAt, startedAt + 10 * MIN]],
        }),
      ],
      1,
      at(14, 9),
      at(14, 11),
    );
    expect(bins.map((b) => [b.visits, b.with, b.alone])).toEqual([
      [1, 20, 10],
      [0, 30, 0],
    ]);
  });
});

describe('chartScale', () => {
  it('rounds up to a gridline', () => {
    expect(chartScale(50)).toEqual({ top: 60, lines: [30, 60] });
    expect(chartScale(130)).toEqual({ top: 180, lines: [60, 120, 180] });
  });

  it('keeps going past the last step', () => {
    expect(chartScale(40_000).top).toBe(42_000);
  });
});
