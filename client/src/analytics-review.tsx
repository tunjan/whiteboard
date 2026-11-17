// Design review harness for the attendance register.
//
// `analytics.tsx` sits behind the tutor password and behind a database with
// months of attendance in it, so the register cannot be looked at — in either
// theme, at either width — without a seeded server. This mounts the real screen
// against a generated term's worth of lessons by answering its two requests in
// the page.
//
// `?theme=dark` opens in dark. `?empty=1` serves a practice nobody has visited.
import { createRoot } from 'react-dom/client';
import './index.css';
import type {
  AgentAsk,
  AnalyticsBoard,
  AnalyticsJoiner,
  AnalyticsSummary,
  AnalyticsVisit,
} from '@whiteboard/shared';
import { Analytics } from './screens/analytics';
import { applyTheme } from './use-theme-store';

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light');
const empty = params.get('empty') === '1';

const DAY = 86_400_000;

interface Plan {
  board: string;
  student: string;
  color: string;
  /** Days between lessons. */
  cadence: number;
  minutes: number;
  /** Lessons back from today this student has been coming. */
  lessons: number;
  /** Lessons ago they last showed up. */
  stoppedAfter?: number;
  pages: number;
  notes: number;
}

const PLANS: Plan[] = [
  {
    board: 'Amara Okonkwo — Further Maths',
    student: 'Amara',
    color: '#4F70A8',
    cadence: 7,
    minutes: 60,
    lessons: 13,
    pages: 9,
    notes: 11,
  },
  {
    board: 'Leo Vasquez — IB AA HL',
    student: 'Leo',
    color: '#7762B5',
    cadence: 7,
    minutes: 90,
    lessons: 12,
    pages: 14,
    notes: 9,
  },
  {
    board: 'Ines Marchetti — Physics',
    student: 'Ines',
    color: '#3A7B64',
    cadence: 7,
    minutes: 55,
    lessons: 11,
    pages: 7,
    notes: 6,
  },
  {
    board: 'Tom Bergström — GCSE catch-up',
    student: 'Tom',
    color: '#856B3F',
    cadence: 14,
    minutes: 45,
    lessons: 6,
    pages: 4,
    notes: 3,
  },
  {
    board: 'Priya Nair — Calculus',
    student: 'Priya',
    color: '#AB517E',
    cadence: 7,
    minutes: 60,
    lessons: 9,
    pages: 6,
    notes: 5,
  },
  {
    board: 'Sofia Duarte — Mechanics',
    student: 'Sofia',
    color: '#627638',
    cadence: 7,
    minutes: 60,
    lessons: 20,
    stoppedAfter: 8,
    pages: 12,
    notes: 14,
  },
  {
    board: 'Hugo Lefèvre — Trial lesson',
    student: 'Hugo',
    color: '#3D7881',
    cadence: 7,
    minutes: 30,
    lessons: 1,
    stoppedAfter: 1,
    pages: 2,
    notes: 1,
  },
];

const HOUR = 3_600_000;

/**
 * Every visit a plan produces, newest lesson first. Each lesson has the tutor
 * on for most of it — the student usually turns up a few minutes early — and
 * every third week the student also comes back alone to do homework.
 */
function planVisits(plan: Plan, n: number, now: number): AnalyticsVisit[] {
  const visits: AnalyticsVisit[] = [];
  // Staggered so the day view has a couple of lessons in it.
  const lead = (2 + n * 5) * HOUR;
  for (
    let lesson = plan.stoppedAfter ?? 0;
    lesson < plan.lessons;
    lesson += 1
  ) {
    const at = now - lead - lesson * plan.cadence * DAY;
    // Lessons run over and under; a register of identical bars is a fiction.
    const minutes = plan.minutes + ((lesson * 7) % 3) * 8 - 8;
    const early = ((lesson * 5) % 3) * 6;
    visits.push({
      name: plan.student,
      isTutor: false,
      color: plan.color,
      startedAt: at,
      endedAt: at + minutes * 60_000,
      minutes,
      drawings: 12 + ((lesson * 37) % 60),
      aloneMinutes: early,
      afkMinutes: 0,
      afkSpans: [],
      aloneSpans: early ? [[at, at + early * 60_000]] : [],
    });
    visits.push({
      name: 'Tutor',
      isTutor: true,
      color: '#DC2626',
      startedAt: at + early * 60_000,
      endedAt: at + (minutes + 5) * 60_000,
      minutes: minutes + 5 - early,
      drawings: 20 + ((lesson * 23) % 40),
      aloneMinutes: 0,
      afkMinutes: 0,
      afkSpans: [],
      aloneSpans: [],
    });
    if (lesson % 3 === 1) {
      const homework = at + 2 * DAY;
      visits.push({
        name: plan.student,
        isTutor: false,
        color: plan.color,
        startedAt: homework,
        endedAt: homework + 50 * 60_000,
        minutes: 35,
        drawings: 18,
        aloneMinutes: 35,
        afkMinutes: 15,
        afkSpans: [[homework + 20 * 60_000, homework + 35 * 60_000]],
        aloneSpans: [
          [homework, homework + 20 * 60_000],
          [homework + 35 * 60_000, homework + 50 * 60_000],
        ],
      });
    }
  }
  // One board has a second student on it — a study partner, not the tutor.
  if (plan.student === 'Leo') {
    for (const daysAgo of [9, 23]) {
      const at = now - daysAgo * DAY - 4 * HOUR;
      visits.push({
        name: 'Mina',
        isTutor: false,
        color: '#9F50AB',
        startedAt: at,
        endedAt: at + 37 * 60_000,
        minutes: 37,
        drawings: 21,
        aloneMinutes: 37,
        afkMinutes: 0,
        afkSpans: [],
        aloneSpans: [[at, at + 37 * 60_000]],
      });
    }
  }
  // One student who stayed on after the lesson and wandered off — the shape
  // that used to be the loudest thing on the page.
  if (plan.student === 'Ines') {
    const at = now - 7 * HOUR;
    const tick = (minutes: number) => at + minutes * 60_000;
    visits.push({
      name: plan.student,
      isTutor: false,
      color: plan.color,
      startedAt: at,
      endedAt: tick(150),
      minutes: 60,
      drawings: 14,
      aloneMinutes: 60,
      afkMinutes: 90,
      afkSpans: [
        [tick(25), tick(70)],
        [tick(80), tick(100)],
        [tick(125), tick(150)],
      ],
      aloneSpans: [
        [at, tick(25)],
        [tick(70), tick(80)],
        [tick(100), tick(125)],
      ],
    });
  }
  return visits.filter((v) => v.startedAt <= now);
}

const SAMPLE_ASKS: Omit<AgentAsk, 'name' | 'color' | 'at'>[] = [
  { instruction: 'Plot y = x² − 4x + 3 and mark where it crosses the x-axis', kind: 'done', result: 'Added a graph' },
  { instruction: 'Why is the discriminant negative here?', kind: 'reply', result: 'Because $b^2 = 4$ is smaller than $4ac = 12$, so $b^2 - 4ac = -8$: there are no real roots.' },
  { instruction: 'Just solve question 3 for me', kind: 'reply', result: 'Let’s work through it together. What do you get when you expand the bracket first?' },
  { instruction: 'Write the quadratic formula', kind: 'done', result: 'Added an equation' },
  { instruction: 'Move the graph next to my working', kind: 'done', result: 'Changed an item' },
  { instruction: 'hmm', kind: 'nothing', result: '' },
  { instruction: 'Draw a right triangle with sides 3, 4, 5 and label them', kind: 'done', result: 'Added a shape and 3 texts' },
];

function sampleAsks(name: string, now: number, count: number): AgentAsk[] {
  return SAMPLE_ASKS.slice(0, count).map((ask, i) => ({
    ...ask,
    name,
    color: null,
    at: now - (i * 9 + 4) * 60_000,
  }));
}

function build(days: number): AnalyticsSummary {
  const now = Date.now();
  const from = now - days * DAY;

  const boards: AnalyticsBoard[] = PLANS.map((plan, n) => {
    const all = planVisits(plan, n, now);
    // Like the server: a visit before the range dates its person but is not
    // counted in it.
    const visits = all
      .filter((v) => v.startedAt >= from)
      .sort((a, b) => a.startedAt - b.startedAt);
    const joiners = new Map<string, AnalyticsJoiner>();
    for (const visit of all) {
      const joiner = joiners.get(visit.name) ?? {
        name: visit.name,
        isTutor: visit.isTutor,
        color: visit.color,
        sessions: 0,
        minutes: 0,
        drawings: 0,
        aloneMinutes: 0,
        afkMinutes: 0,
        lastSeenAt: 0,
      };
      joiner.lastSeenAt = Math.max(joiner.lastSeenAt, visit.endedAt);
      if (visit.startedAt >= from) {
        joiner.sessions += 1;
        joiner.minutes += visit.minutes;
        joiner.drawings += visit.drawings;
        joiner.aloneMinutes += visit.aloneMinutes;
        joiner.afkMinutes += visit.afkMinutes;
      }
      joiners.set(visit.name, joiner);
    }
    const students = visits.filter((v) => !v.isTutor);
    const total = (
      list: AnalyticsVisit[],
      pick: (v: AnalyticsVisit) => number,
    ) => list.reduce((sum, v) => sum + pick(v), 0);
    const lastActiveAt = Math.max(
      0,
      ...all.filter((v) => !v.isTutor).map((v) => v.endedAt),
    );

    return {
      id: `bd-${plan.student.toLowerCase()}`,
      name: plan.board,
      createdAt: now - (60 + n * 30) * DAY,
      lastOpenedAt: lastActiveAt || now - 90 * DAY,
      lastActiveAt: lastActiveAt || null,
      studentMinutes: total(students, (v) => v.minutes),
      tutorMinutes: total(
        visits.filter((v) => v.isTutor),
        (v) => v.minutes,
      ),
      aloneMinutes: total(students, (v) => v.aloneMinutes),
      afkMinutes: total(students, (v) => v.afkMinutes),
      sessions: students.length,
      activeDays: new Set(
        students.map((v) => new Date(v.startedAt).toISOString().slice(0, 10)),
      ).size,
      drawings: total(students, (v) => v.drawings),
      pages: plan.pages,
      bytes: 90_000 + n * 140_000,
      notedSessions: plan.notes,
      // A few cents of transcription per lesson in range.
      aiRequests: students.length * 3,
      aiCost: students.length * 0.0042,
      // A few instructions to the board agent on the first canvases only,
      // so the list and its absence both show.
      agentAsks: n > 1 ? [] : sampleAsks(plan.student, now, n === 0 ? 7 : 2),
      visits,
      joiners: [...joiners.values()].sort((a, b) => b.minutes - a.minutes),
    };
  }).sort((a, b) => b.studentMinutes - a.studentMinutes);

  const sum = (pick: (b: AnalyticsBoard) => number) =>
    boards.reduce((total, b) => total + pick(b), 0);
  return {
    rangeDays: days,
    from,
    to: now,
    totals: {
      studentMinutes: sum((b) => b.studentMinutes),
      tutorMinutes: sum((b) => b.tutorMinutes),
      aloneMinutes: sum((b) => b.aloneMinutes),
      afkMinutes: sum((b) => b.afkMinutes),
      sessions: sum((b) => b.sessions),
      activeBoards: boards.filter((b) => b.sessions > 0).length,
      boards: boards.length,
      students: new Set(
        boards.flatMap((b) =>
          b.joiners
            .filter((j) => !j.isTutor && j.sessions > 0)
            .map((j) => j.name),
        ),
      ).size,
      drawings: sum((b) => b.drawings),
    },
    boards,
    ai: {
      requests: sum((b) => b.aiRequests),
      cost: sum((b) => b.aiCost),
      byModel: [
        { job: 'check', model: 'anthropic/claude-haiku-5.5', requests: Math.ceil(sum((b) => b.aiRequests) * 0.32), cost: sum((b) => b.aiCost) * 0.42 },
        { job: 'agent', model: 'anthropic/claude-haiku-5.5', requests: Math.ceil(sum((b) => b.aiRequests) * 0.12), cost: sum((b) => b.aiCost) * 0.41 },
        { job: 'vision', model: 'anthropic/claude-haiku-5.5', requests: Math.ceil(sum((b) => b.aiRequests) * 0.28), cost: sum((b) => b.aiCost) * 0.12 },
        { job: 'text', model: 'anthropic/claude-haiku-5.5', requests: Math.ceil(sum((b) => b.aiRequests) * 0.28), cost: sum((b) => b.aiCost) * 0.05 },
      ],
    },
  };
}

function emptyPractice(days: number): AnalyticsSummary {
  const seeded = build(days);
  return {
    ...seeded,
    totals: {
      studentMinutes: 0,
      tutorMinutes: 0,
      aloneMinutes: 0,
      afkMinutes: 0,
      sessions: 0,
      activeBoards: 0,
      boards: seeded.boards.length,
      students: 0,
      drawings: 0,
    },
    boards: seeded.boards.map((board) => ({
      ...board,
      studentMinutes: 0,
      tutorMinutes: 0,
      aloneMinutes: 0,
      afkMinutes: 0,
      sessions: 0,
      activeDays: 0,
      drawings: 0,
      lastActiveAt: null,
      visits: [],
      joiners: [],
    })),
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string' ? input : String((input as Request).url);
  if (url.includes('/api/auth/me')) {
    return Response.json({ authenticated: true, name: 'Tutor' });
  }
  if (url.includes('/api/ai/models')) {
    if (init?.method === 'PUT') return Response.json(JSON.parse(String(init.body)));
    const price = (prompt: string, completion: string) => ({ prompt, completion });
    return Response.json({
      selected: {
        vision: 'deepseek/deepseek-v4-flash-vision-exp',
        text: 'deepseek/deepseek-v4-flash',
        stt: 'openai/whisper-large-v3-turbo',
        image: 'recraft/recraft-v4.1-flash',
      },
      options: {
        vision: [
          { id: 'deepseek/deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision', pricing: price('0.0000002', '0.0000008') },
          { id: 'google/gemini-3.1-flash', name: 'Gemini 3.1 Flash', pricing: price('0.0000005', '0.000003') },
        ],
        text: [
          { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', pricing: price('0.0000001', '0.0000004') },
        ],
        stt: [
          { id: 'openai/whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo', pricing: price('0.00000333', '0') },
          { id: 'openai/gpt-4o-transcribe', name: 'GPT-4o Transcribe', pricing: price('0.0000025', '0.00001') },
        ],
        image: [
          { id: 'recraft/recraft-v4.1-flash', name: 'Recraft V4.1 Flash', pricing: { image_output: '0.00000167664670658683' } },
          { id: 'x-ai/grok-imagine-image-2.0', name: 'Grok Imagine 2.0', pricing: { image: '0.01' } },
        ],
      },
    });
  }
  if (url.includes('/api/analytics')) {
    const days = Number(
      new URL(url, location.origin).searchParams.get('days') ?? 30,
    );
    return Response.json(empty ? emptyPractice(days) : build(days));
  }
  return realFetch(input, init);
};

createRoot(document.getElementById('root')!).render(<Analytics />);
