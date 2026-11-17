import type { AnalyticsRange, AnalyticsVisit } from '@whiteboard/shared';

/**
 * What the bar charts draw: every stretch of a visit is one of three states,
 * summed into hours, days or weeks. Pure and apart from the screen so the cuts
 * can be tested without mounting it.
 */
export type Presence = 'with' | 'alone' | 'afk';

export interface Segment {
  from: number;
  to: number;
  presence: Presence;
}

const within = (at: number, spans: [number, number][]) =>
  spans.some(([from, to]) => at >= from && at < to);

/** A visit cut wherever its state changes, in time order. */
export function presenceSegments(visit: AnalyticsVisit): Segment[] {
  const { startedAt, endedAt, afkSpans, aloneSpans, isTutor } = visit;
  // A visit can be a moment long: an edit on a connection that closed at once.
  if (endedAt <= startedAt) {
    return [
      { from: startedAt, to: endedAt, presence: isTutor ? 'with' : 'alone' },
    ];
  }
  const cuts = new Set([startedAt, endedAt]);
  for (const at of [...afkSpans, ...aloneSpans].flat()) {
    if (at > startedAt && at < endedAt) cuts.add(at);
  }
  const times = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (const [i, from] of times.slice(0, -1).entries()) {
    const to = times[i + 1]!;
    const presence = within(from, afkSpans)
      ? 'afk'
      : within(from, aloneSpans)
        ? 'alone'
        : 'with';
    const last = segments.at(-1);
    if (last?.presence === presence) last.to = to;
    else segments.push({ from, to, presence });
  }
  return segments;
}

/** One bar of a chart: an hour's minutes, a day's, or a week's. */
export interface Bin {
  at: number;
  end: number;
  visits: number;
  with: number;
  alone: number;
  afk: number;
}

/** The time that counts. AFK is left out, as it is from every total here. */
export const binTotal = (bin: Bin) => bin.with + bin.alone;

/** The start of the hour, day or Monday week `at` falls in. */
function binStart(at: number, range: AnalyticsRange): number {
  const start = new Date(at);
  if (range === 1) return start.setMinutes(0, 0, 0);
  start.setHours(0, 0, 0, 0);
  if (range === 365) start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start.getTime();
}

function binEnd(at: number, range: AnalyticsRange): number {
  const end = new Date(at);
  if (range === 1) return end.setHours(end.getHours() + 1);
  return end.setDate(end.getDate() + (range === 365 ? 7 : 1));
}

/**
 * Every bin of the window, empty ones included: a gap is what a missed lesson
 * looks like. A day or week holds a visit whole, on the day it started. An hour
 * cannot, a lesson runs across them, so a visit is cut at the hour.
 */
export function binVisits(
  visits: AnalyticsVisit[],
  range: AnalyticsRange,
  from: number,
  to: number,
): Bin[] {
  const bins = new Map<number, Bin>();
  for (let at = binStart(from, range); at < to; at = binEnd(at, range)) {
    const end = binEnd(at, range);
    bins.set(at, { at, end, visits: 0, with: 0, alone: 0, afk: 0 });
  }
  for (const visit of visits) {
    const first = bins.get(binStart(visit.startedAt, range));
    if (first) first.visits += 1;
    if (range !== 1) {
      if (!first) continue;
      first.with += visit.minutes - visit.aloneMinutes;
      first.alone += visit.aloneMinutes;
      first.afk += visit.afkMinutes;
      continue;
    }
    // ponytail: a reconnect gap inside a visit reads as present here, at most
    // VISIT_GAP_MS each. Scale by visit.minutes if hours ever need to sum exactly.
    for (const segment of presenceSegments(visit)) {
      let at = segment.from;
      while (at < segment.to) {
        const hour = binStart(at, range);
        const until = Math.min(binEnd(hour, range), segment.to);
        const bin = bins.get(hour);
        if (bin) bin[segment.presence] += (until - at) / 60_000;
        at = until;
      }
    }
  }
  return [...bins.values()];
}

const STEPS = [15, 30, 60, 120, 180, 300, 600, 1200, 3000, 6000];

/** Round gridlines for a chart: at most three, in whole hours past the first. */
export function chartScale(peak: number): { top: number; lines: number[] } {
  const step = STEPS.find((s) => peak / s <= 3) ?? STEPS.at(-1)!;
  const top = Math.ceil(peak / step) * step;
  const lines: number[] = [];
  for (let line = step; line <= top; line += step) lines.push(line);
  return { top, lines };
}
