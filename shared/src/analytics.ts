/**
 * Contracts for the tutor's analytics page (`GET /api/analytics`).
 *
 * The unit is the board, not a "student" record: a board is what the tutor
 * names, keeps notes on, and invites someone to, and the app has no other
 * durable identity for a person. Who actually turned up is recorded per join
 * (`AnalyticsJoiner`), from the display name that client published, so a board
 * row carries both the practice-level facts and the people behind them.
 */

/** One visit to a board: a person's reconnects within a sitting, joined up. */
export interface AnalyticsVisit {
  name: string;
  isTutor: boolean;
  color: string | null;
  startedAt: number;
  endedAt: number;
  minutes: number;
  /** Shapes this person added during the visit — strokes, text, images. */
  drawings: number;
  /**
   * Minutes of this visit with no tutor connected to the board. Always 0 on a
   * tutor's own visit.
   */
  aloneMinutes: number;
  /**
   * Minutes left out of `minutes` and `aloneMinutes`: stretches with no input
   * past a five-minute grace while no tutor was on the board.
   */
  afkMinutes: number;
}

/** One person who joined a board, identified by the name they published. */
export interface AnalyticsJoiner {
  name: string;
  isTutor: boolean;
  /** Identity colour published with the name, for the avatar tint. */
  color: string | null;
  sessions: number;
  minutes: number;
  drawings: number;
  /** Of `minutes`, how many had no tutor on the board. */
  aloneMinutes: number;
  lastSeenAt: number;
}

/** A board's row in the register. */
export interface AnalyticsBoard {
  id: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  /**
   * Last time a student was on this board, across all time rather than the
   * requested range — "quiet since June" is what a 30-day view cannot answer
   * about itself. Null if no student has ever joined.
   */
  lastActiveAt: number | null;
  studentMinutes: number;
  tutorMinutes: number;
  /** Student minutes with no tutor on the board. */
  aloneMinutes: number;
  /** Student joins in range. */
  sessions: number;
  /** Distinct UTC days in range with at least one student join. */
  activeDays: number;
  /** Shapes students added in range. */
  drawings: number;
  /** Pages on the board (one stored document each, plus the board's own). */
  pages: number;
  /** Bytes of stored CRDT state, snapshot plus its update log. */
  bytes: number;
  /** Dated session notes the tutor has written, across all time. */
  notedSessions: number;
  /** Every visit that started in range, tutor's included, oldest first. */
  visits: AnalyticsVisit[];
  joiners: AnalyticsJoiner[];
}

export interface AnalyticsSummary {
  rangeDays: number;
  /** The window reported: the last `rangeDays` × 24 hours, ending now. */
  from: number;
  to: number;
  totals: {
    studentMinutes: number;
    tutorMinutes: number;
    aloneMinutes: number;
    sessions: number;
    /** Boards with at least one student join in range. */
    activeBoards: number;
    /** Boards on the account, whether or not they saw activity. */
    boards: number;
    /** Distinct student display names seen in range. */
    students: number;
    drawings: number;
  };
  boards: AnalyticsBoard[];
}

/**
 * Ranges the page offers — a day, a week, a month, a year. Bounded server-side
 * so a request cannot ask for all time.
 */
export const ANALYTICS_RANGES = [1, 7, 30, 365] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: number): value is AnalyticsRange {
  return (ANALYTICS_RANGES as readonly number[]).includes(value);
}
