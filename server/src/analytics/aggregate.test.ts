import { describe, expect, it } from 'vitest';
import {
  type BoardRow,
  type SessionRow,
  aggregate,
  toVisits,
} from './aggregate';

const NOW = new Date('2026-03-10T18:00:00.000Z');

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    boardId: 'b1',
    name: 'Ada',
    color: '#4F70A8',
    isTutor: false,
    startedAt: new Date('2026-03-10T15:00:00.000Z'),
    lastSeenAt: new Date('2026-03-10T16:00:00.000Z'),
    edits: 0,
    drawings: 0,
    afk: [],
    ...overrides,
  };
}

function board(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    id: 'b1',
    name: 'Ada Lovelace',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastOpenedAt: new Date('2026-03-10T14:00:00.000Z'),
    ...overrides,
  };
}

function summary(
  sessions: SessionRow[],
  days = 14,
  lastStudentAt?: Map<string, number>,
) {
  return aggregate({
    boards: [board()],
    sessions,
    content: new Map(),
    lastStudentAt,
    days,
    now: NOW,
  });
}

describe('visits', () => {
  it('joins a reconnect back onto the visit it dropped out of', () => {
    const visits = toVisits([
      session({
        startedAt: new Date('2026-03-10T15:00:00.000Z'),
        lastSeenAt: new Date('2026-03-10T15:20:00.000Z'),
      }),
      session({
        startedAt: new Date('2026-03-10T15:22:00.000Z'),
        lastSeenAt: new Date('2026-03-10T15:50:00.000Z'),
      }),
    ]);
    expect(visits).toHaveLength(1);
    // The two minutes off the board are not minutes on it.
    expect(visits[0]!.minutes).toBe(48);
  });

  it('keeps a later lesson separate', () => {
    const visits = toVisits([
      session({
        startedAt: new Date('2026-03-10T15:00:00.000Z'),
        lastSeenAt: new Date('2026-03-10T16:00:00.000Z'),
      }),
      session({
        startedAt: new Date('2026-03-10T19:00:00.000Z'),
        lastSeenAt: new Date('2026-03-10T20:00:00.000Z'),
      }),
    ]);
    expect(visits).toHaveLength(2);
  });

  it('drops a handshake that did nothing, but keeps a short one that edited', () => {
    const short = {
      startedAt: new Date('2026-03-10T15:00:00.000Z'),
      lastSeenAt: new Date('2026-03-10T15:00:05.000Z'),
    };
    expect(toVisits([session(short)])).toHaveLength(0);
    expect(toVisits([session({ ...short, edits: 4 })])).toHaveLength(1);
  });

  it('does not merge two people on the same board', () => {
    const visits = toVisits([
      session({ name: 'Ada' }),
      session({ name: 'Ben' }),
    ]);
    expect(visits).toHaveLength(2);
  });

  it('keeps a visit on the day it started', () => {
    const [visit] = toVisits([
      session({
        startedAt: new Date('2026-03-09T23:30:00.000Z'),
        lastSeenAt: new Date('2026-03-10T00:30:00.000Z'),
      }),
    ]);
    expect(visit!.day).toBe('2026-03-09');
  });
});

describe('aggregate', () => {
  it('counts a student visit into its board, its timeline and the totals', () => {
    const result = summary([session({ edits: 12, drawings: 5 })]);
    const row = result.boards[0]!;
    expect(row.studentMinutes).toBe(60);
    expect(row.sessions).toBe(1);
    expect(row.activeDays).toBe(1);
    expect(row.drawings).toBe(5);
    expect(row.visits).toHaveLength(1);
    expect(row.visits[0]).toMatchObject({
      name: 'Ada',
      minutes: 60,
      drawings: 5,
    });
    expect(result.totals.studentMinutes).toBe(60);
    expect(result.totals.drawings).toBe(5);
    expect(result.totals.students).toBe(1);
    expect(result.totals.activeBoards).toBe(1);
  });

  it('reports a day as the last 24 hours, not since midnight', () => {
    const lastNight = session({
      startedAt: new Date('2026-03-09T20:00:00.000Z'),
      lastSeenAt: new Date('2026-03-09T21:00:00.000Z'),
    });
    expect(summary([lastNight], 1).boards[0]!.sessions).toBe(1);
    const yesterdayMorning = session({
      startedAt: new Date('2026-03-09T09:00:00.000Z'),
      lastSeenAt: new Date('2026-03-09T10:00:00.000Z'),
    });
    expect(summary([yesterdayMorning], 1).boards[0]!.sessions).toBe(0);
  });

  it('counts the minutes a student spent with no tutor on the board', () => {
    // Student 15:00–16:00; tutor 15:10–15:30 and again 15:40–16:30.
    const result = summary([
      session(),
      session({
        name: 'Tutor',
        isTutor: true,
        startedAt: new Date('2026-03-10T15:10:00.000Z'),
        lastSeenAt: new Date('2026-03-10T15:30:00.000Z'),
      }),
      session({
        name: 'Tutor',
        isTutor: true,
        startedAt: new Date('2026-03-10T15:40:00.000Z'),
        lastSeenAt: new Date('2026-03-10T16:30:00.000Z'),
      }),
    ]);
    const row = result.boards[0]!;
    // 10 minutes before the tutor came, 10 in the gap between their two rows —
    // which the tutor's own visit joins over, so it has to be read off the rows.
    expect(row.aloneMinutes).toBe(20);
    expect(result.totals.aloneMinutes).toBe(20);
    const ada = row.joiners.find((j) => j.name === 'Ada')!;
    expect(ada.aloneMinutes).toBe(20);
    expect(row.joiners.find((j) => j.isTutor)!.aloneMinutes).toBe(0);
  });

  it('drops idle time only where the tutor was not on the board', () => {
    const at = (hhmm: string) =>
      new Date(`2026-03-10T${hhmm}:00.000Z`).getTime();
    // Student 15:00–16:00, idle 15:20–15:50; tutor on 15:30–16:00.
    const result = summary([
      session({ afk: [[at('15:20'), at('15:50')]] }),
      session({
        name: 'Tutor',
        isTutor: true,
        startedAt: new Date(at('15:30')),
        lastSeenAt: new Date(at('16:00')),
      }),
    ]);
    const row = result.boards[0]!;
    // Only 15:20–15:30 is idle and alone; 15:30–15:50 had the tutor there.
    expect(row.studentMinutes).toBe(50);
    // Alone was 15:00–15:30, less the ten idle minutes.
    expect(row.aloneMinutes).toBe(20);
    const visit = row.visits.find((v) => !v.isTutor)!;
    expect(visit.afkMinutes).toBe(10);
    expect(visit.afkSpans).toEqual([[at('15:20'), at('15:30')]]);
    expect(visit.aloneSpans).toEqual([[at('15:00'), at('15:20')]]);
    expect(row.afkMinutes).toBe(10);
    expect(row.joiners.find((j) => !j.isTutor)!.afkMinutes).toBe(10);
    expect(result.totals.afkMinutes).toBe(10);
  });

  it('splits an idle stretch around a tutor who came and went', () => {
    const at = (hhmm: string) =>
      new Date(`2026-03-10T${hhmm}:00.000Z`).getTime();
    const result = summary([
      session({ afk: [[at('15:10'), at('15:50')]] }),
      session({
        name: 'Tutor',
        isTutor: true,
        startedAt: new Date(at('15:20')),
        lastSeenAt: new Date(at('15:30')),
      }),
    ]);
    const visit = result.boards[0]!.visits.find((v) => !v.isTutor)!;
    expect(visit.afkSpans).toEqual([
      [at('15:10'), at('15:20')],
      [at('15:30'), at('15:50')],
    ]);
    expect(visit.afkMinutes).toBe(30);
    expect(visit.minutes).toBe(30);
  });

  it('ignores idle stretches outside the connection they belong to', () => {
    const result = summary([
      session({
        afk: [
          [
            Date.parse('2026-03-10T15:50:00Z'),
            Date.parse('2026-03-10T17:00:00Z'),
          ],
        ],
      }),
    ]);
    expect(result.boards[0]!.studentMinutes).toBe(50);
  });

  it('does not let a tutor on another board count as present', () => {
    const result = aggregate({
      boards: [board(), board({ id: 'b2', name: 'Other' })],
      sessions: [
        session(),
        session({ boardId: 'b2', name: 'Tutor', isTutor: true }),
      ],
      content: new Map(),
      days: 7,
      now: NOW,
    });
    expect(result.boards.find((b) => b.id === 'b1')!.aloneMinutes).toBe(60);
  });

  it('dates a board from the last student on it, not from the range', () => {
    // How a quiet board arrives: no sessions in range, one fact about the past.
    const stopped = new Date('2026-01-20T11:00:00.000Z').getTime();
    const result = summary([], 14, new Map([['b1', stopped]]));
    expect(result.boards[0]).toMatchObject({
      sessions: 0,
      lastActiveAt: stopped,
    });
  });

  it('keeps tutor time out of the student figures', () => {
    const result = summary([
      session({ name: 'Tutor', isTutor: true, edits: 3, drawings: 2 }),
    ]);
    const row = result.boards[0]!;
    expect(row.tutorMinutes).toBe(60);
    expect(row.studentMinutes).toBe(0);
    expect(row.sessions).toBe(0);
    expect(row.drawings).toBe(0);
    expect(result.totals.students).toBe(0);
    expect(result.totals.activeBoards).toBe(0);
    // The tutor being on a board is not a student having been on it.
    expect(row.lastActiveAt).toBeNull();
    expect(row.joiners[0]).toMatchObject({ name: 'Tutor', isTutor: true });
  });

  it('reports a board nobody visited, with no activity', () => {
    const result = summary([]);
    expect(result.boards).toHaveLength(1);
    expect(result.boards[0]).toMatchObject({
      sessions: 0,
      studentMinutes: 0,
      lastActiveAt: null,
    });
    expect(result.boards[0]!.visits).toEqual([]);
  });

  it('dates the last visit from outside the range it reports', () => {
    const old = new Date('2026-01-05T10:00:00.000Z');
    const result = summary([
      session({
        startedAt: old,
        lastSeenAt: new Date(old.getTime() + 3_600_000),
      }),
    ]);
    const row = result.boards[0]!;
    expect(row.sessions).toBe(0);
    expect(row.studentMinutes).toBe(0);
    expect(row.lastActiveAt).toBe(old.getTime() + 3_600_000);
    // Still listed, with nothing counted against them and the date they stopped.
    expect(row.joiners[0]).toMatchObject({
      name: 'Ada',
      sessions: 0,
      minutes: 0,
      lastSeenAt: old.getTime() + 3_600_000,
    });
  });

  it('rolls a person up across their visits', () => {
    const result = summary([
      session({ name: 'Ada' }),
      session({
        name: 'Ada',
        startedAt: new Date('2026-03-09T15:00:00.000Z'),
        lastSeenAt: new Date('2026-03-09T15:30:00.000Z'),
      }),
      session({ name: '', color: null }),
    ]);
    const joiners = result.boards[0]!.joiners;
    expect(joiners[0]).toMatchObject({ name: 'Ada', sessions: 2, minutes: 90 });
    expect(joiners[1]!.name).toBe('Unnamed');
  });
});
