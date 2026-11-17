import type {
  AgentAsk,
  AnalyticsAiModel,
  AnalyticsBoard,
  AnalyticsJoiner,
  AnalyticsSummary,
  AnalyticsVisit,
} from '@whiteboard/shared';

/**
 * Turns raw connection rows into the register the tutor reads.
 *
 * Pure and in TypeScript rather than SQL: the shaping is mostly the visit rule
 * below, which is a fold over each person's rows in time order — awkward as a
 * window function and hard to check, where here it is a few lines with a test.
 * The row count this folds over is a tutoring practice's joins over a year at
 * most, so the work is trivial next to the round trip that fetched it.
 */

export interface SessionRow {
  boardId: string;
  name: string;
  color: string | null;
  isTutor: boolean;
  startedAt: Date;
  lastSeenAt: Date;
  edits: number;
  drawings: number;
  /** Stretches with no input past the grace, as [startMs, endMs]. */
  afk: [number, number][];
}

export interface BoardRow {
  id: string;
  name: string;
  createdAt: Date;
  lastOpenedAt: Date;
}

export interface BoardContent {
  pages: number;
  bytes: number;
  notedSessions: number;
}

/**
 * A dropped socket reconnects on its own, and three reconnects in a lesson are
 * not three visits. Rows from the same person on the same board resume the
 * previous visit if they start within this gap of it — long enough to cover a
 * reconnect or a closed lid, short enough that this evening is never last
 * night's lesson.
 */
const VISIT_GAP_MS = 10 * 60_000;

/** A connection this short is a handshake, not a visit. */
const MIN_VISIT_MS = 20_000;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface Visit {
  boardId: string;
  name: string;
  color: string | null;
  isTutor: boolean;
  day: string;
  startedAt: number;
  endedAt: number;
  minutes: number;
  edits: number;
  drawings: number;
  aloneMinutes: number;
  /** AFK minutes left out of `minutes` because no tutor was there. */
  afkMinutes: number;
  afkSpans: Interval[];
  aloneSpans: Interval[];
}

type Interval = [start: number, end: number];

/** Each board's tutor connections, merged into disjoint spans in time order. */
function tutorPresence(rows: SessionRow[]): Map<string, Interval[]> {
  const byBoard = new Map<string, Interval[]>();
  for (const row of rows) {
    if (!row.isTutor) continue;
    const start = row.startedAt.getTime();
    const span: Interval = [start, Math.max(start, row.lastSeenAt.getTime())];
    const list = byBoard.get(row.boardId);
    if (list) list.push(span);
    else byBoard.set(row.boardId, [span]);
  }
  for (const [boardId, list] of byBoard) {
    list.sort((a, b) => a[0] - b[0]);
    const merged: Interval[] = [];
    for (const span of list) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    byBoard.set(boardId, merged);
  }
  return byBoard;
}

/** The parts of [start, end] not covered by any of `spans`, which are sorted. */
function uncovered(start: number, end: number, spans: Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = start;
  for (const [from, to] of spans) {
    if (from >= end) break;
    if (from > cursor) gaps.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps;
}

const minutesIn = (spans: Interval[]) =>
  spans.reduce((sum, [from, to]) => sum + (to - from) / 60_000, 0);

/**
 * Collapse rows into visits. A visit belongs to the day it started on, so a
 * lesson that runs past midnight stays one entry on the day it was taught.
 */
export function toVisits(rows: SessionRow[]): Visit[] {
  // Absence is measured per connection, before rows join into visits: the
  // tutor dropping out mid-lesson is exactly the gap a visit would paper over.
  const tutors = tutorPresence(rows);
  const byPerson = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = `${row.boardId}\u0000${row.isTutor ? 'tutor' : 'student'}\u0000${row.name}`;
    const list = byPerson.get(key);
    if (list) list.push(row);
    else byPerson.set(key, [row]);
  }

  const visits: Visit[] = [];
  for (const list of byPerson.values()) {
    list.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    let current: Visit | null = null;
    for (const row of list) {
      const started = row.startedAt.getTime();
      const ended = Math.max(started, row.lastSeenAt.getTime());
      const presence = tutors.get(row.boardId) ?? [];
      // AFK only costs a student time the tutor was not there for: with the
      // tutor on, a still student may be listening on the call.
      const afkSpans: Interval[] = [];
      if (!row.isTutor) {
        for (const [from, to] of row.afk) {
          const start = Math.max(started, from);
          const end = Math.min(ended, to);
          if (end > start) afkSpans.push(...uncovered(start, end, presence));
        }
      }
      const afk = minutesIn(afkSpans);
      const minutes = (ended - started) / 60_000 - afk;
      const aloneSpans = row.isTutor
        ? []
        : uncovered(started, ended, presence).flatMap(([from, to]) =>
            uncovered(from, to, afkSpans),
          );
      const alone = minutesIn(aloneSpans);
      if (current && started - current.endedAt <= VISIT_GAP_MS) {
        current.endedAt = Math.max(current.endedAt, ended);
        current.minutes += minutes;
        current.edits += row.edits;
        current.drawings += row.drawings;
        current.aloneMinutes += alone;
        current.afkMinutes += afk;
        current.afkSpans.push(...afkSpans);
        current.aloneSpans.push(...aloneSpans);
        // The identity can arrive after the first row of a visit opened.
        if (row.name && !current.name) current.name = row.name;
        if (row.color && !current.color) current.color = row.color;
        continue;
      }
      if (current) visits.push(current);
      current = {
        boardId: row.boardId,
        name: row.name,
        color: row.color,
        isTutor: row.isTutor,
        day: utcDay(row.startedAt),
        startedAt: started,
        endedAt: ended,
        minutes,
        edits: row.edits,
        drawings: row.drawings,
        aloneMinutes: alone,
        afkMinutes: afk,
        afkSpans,
        aloneSpans,
      };
    }
    if (current) visits.push(current);
  }
  return visits.filter(
    (visit) =>
      visit.endedAt - visit.startedAt >= MIN_VISIT_MS || visit.edits > 0,
  );
}

export interface AggregateInput {
  boards: BoardRow[];
  /** Sessions that ended within the range. */
  sessions: SessionRow[];
  content: Map<string, BoardContent>;
  /**
   * Last time a student was on each board, over all of history. The sessions
   * above are fetched by range, so a board last visited in June carries no row
   * here in a 30-day view and would otherwise read as never visited at all.
   */
  lastStudentAt?: Map<string, number>;
  /** AI spend in range, per board and per model. */
  ai?: {
    byBoard: Map<string, { requests: number; cost: number }>;
    byModel: AnalyticsAiModel[];
  };
  /** Students' instructions to the board agent in range, per board, newest first. */
  agentAsks?: Map<string, AgentAsk[]>;
  days: number;
  now: Date;
}

const DAY_MS = 86_400_000;

/** The start of the window: `days` × 24 hours before `now`. */
export function rangeStart(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function aggregate(input: AggregateInput): AnalyticsSummary {
  const from = rangeStart(input.days, input.now).getTime();
  const visits = toVisits(input.sessions).sort(
    (a, b) => a.startedAt - b.startedAt,
  );
  const students = new Set<string>();

  interface Acc {
    studentMinutes: number;
    tutorMinutes: number;
    aloneMinutes: number;
    afkMinutes: number;
    sessions: number;
    drawings: number;
    activeDays: Set<string>;
    lastActiveAt: number | null;
    visits: AnalyticsVisit[];
    joiners: Map<string, AnalyticsJoiner>;
  }
  const acc = new Map<string, Acc>();
  const accFor = (boardId: string): Acc => {
    let entry = acc.get(boardId);
    if (!entry) {
      entry = {
        studentMinutes: 0,
        tutorMinutes: 0,
        aloneMinutes: 0,
        afkMinutes: 0,
        sessions: 0,
        drawings: 0,
        activeDays: new Set(),
        lastActiveAt: null,
        visits: [],
        joiners: new Map(),
      };
      acc.set(boardId, entry);
    }
    return entry;
  };

  for (const [boardId, at] of input.lastStudentAt ?? []) {
    accFor(boardId).lastActiveAt = at;
  }

  for (const visit of visits) {
    const entry = accFor(visit.boardId);
    if (!visit.isTutor) {
      entry.lastActiveAt = Math.max(entry.lastActiveAt ?? 0, visit.endedAt);
    }

    const name = visit.name || 'Unnamed';
    const joinerKey = `${visit.isTutor ? 'tutor' : 'student'}\u0000${name}`;
    const joiner = entry.joiners.get(joinerKey) ?? {
      name,
      isTutor: visit.isTutor,
      color: visit.color,
      sessions: 0,
      minutes: 0,
      drawings: 0,
      aloneMinutes: 0,
      afkMinutes: 0,
      lastSeenAt: 0,
    };
    // Counted within the range, but last seen across all of it: a student who
    // stopped coming in June belongs on the list, with the date that says so.
    joiner.lastSeenAt = Math.max(joiner.lastSeenAt, visit.endedAt);
    if (!joiner.color && visit.color) joiner.color = visit.color;
    entry.joiners.set(joinerKey, joiner);

    // A visit belongs to the range it started in, so a lesson running across
    // the window's edge is counted whole or not at all.
    if (visit.startedAt < from) continue;
    joiner.sessions += 1;
    joiner.minutes += visit.minutes;
    joiner.drawings += visit.drawings;
    joiner.aloneMinutes += visit.aloneMinutes;
    joiner.afkMinutes += visit.afkMinutes;
    entry.visits.push({
      name,
      isTutor: visit.isTutor,
      color: visit.color ?? joiner.color,
      startedAt: visit.startedAt,
      endedAt: visit.endedAt,
      minutes: Math.round(visit.minutes),
      drawings: visit.drawings,
      aloneMinutes: Math.round(visit.aloneMinutes),
      afkMinutes: Math.round(visit.afkMinutes),
      afkSpans: visit.afkSpans,
      aloneSpans: visit.aloneSpans,
    });
    if (visit.isTutor) {
      entry.tutorMinutes += visit.minutes;
      continue;
    }
    entry.studentMinutes += visit.minutes;
    entry.aloneMinutes += visit.aloneMinutes;
    entry.afkMinutes += visit.afkMinutes;
    entry.drawings += visit.drawings;
    entry.sessions += 1;
    entry.activeDays.add(visit.day);
    students.add(name);
  }

  const boards: AnalyticsBoard[] = input.boards.map((board) => {
    const entry = acc.get(board.id);
    const content = input.content.get(board.id);
    return {
      id: board.id,
      name: board.name,
      createdAt: board.createdAt.getTime(),
      lastOpenedAt: board.lastOpenedAt.getTime(),
      lastActiveAt: entry?.lastActiveAt ?? null,
      studentMinutes: Math.round(entry?.studentMinutes ?? 0),
      tutorMinutes: Math.round(entry?.tutorMinutes ?? 0),
      aloneMinutes: Math.round(entry?.aloneMinutes ?? 0),
      afkMinutes: Math.round(entry?.afkMinutes ?? 0),
      sessions: entry?.sessions ?? 0,
      activeDays: entry?.activeDays.size ?? 0,
      drawings: entry?.drawings ?? 0,
      pages: content?.pages ?? 0,
      bytes: content?.bytes ?? 0,
      notedSessions: content?.notedSessions ?? 0,
      aiRequests: input.ai?.byBoard.get(board.id)?.requests ?? 0,
      aiCost: input.ai?.byBoard.get(board.id)?.cost ?? 0,
      agentAsks: input.agentAsks?.get(board.id) ?? [],
      visits: entry?.visits ?? [],
      joiners: [...(entry?.joiners.values() ?? [])]
        .map((joiner) => ({
          ...joiner,
          minutes: Math.round(joiner.minutes),
          aloneMinutes: Math.round(joiner.aloneMinutes),
          afkMinutes: Math.round(joiner.afkMinutes),
        }))
        .sort((a, b) => b.minutes - a.minutes || b.sessions - a.sessions),
    };
  });

  // Busiest first: the register is read for who is active, and a board with no
  // activity in range is a different question, answered further down the page.
  boards.sort(
    (a, b) =>
      b.studentMinutes - a.studentMinutes ||
      (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) ||
      a.name.localeCompare(b.name),
  );

  const byModel = input.ai?.byModel ?? [];
  const sum = (pick: (b: AnalyticsBoard) => number) =>
    boards.reduce((total, b) => total + pick(b), 0);
  return {
    rangeDays: input.days,
    from,
    to: input.now.getTime(),
    totals: {
      studentMinutes: sum((b) => b.studentMinutes),
      tutorMinutes: sum((b) => b.tutorMinutes),
      aloneMinutes: sum((b) => b.aloneMinutes),
      afkMinutes: sum((b) => b.afkMinutes),
      sessions: sum((b) => b.sessions),
      activeBoards: boards.filter((b) => b.sessions > 0).length,
      boards: boards.length,
      students: students.size,
      drawings: sum((b) => b.drawings),
    },
    boards,
    ai: {
      requests: byModel.reduce((total, m) => total + m.requests, 0),
      cost: byModel.reduce((total, m) => total + m.cost, 0),
      byModel,
    },
  };
}
