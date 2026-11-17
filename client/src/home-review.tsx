// Design review harness for the board list.
//
// `home.tsx` sits behind the tutor password and lists whatever boards the dev
// database holds, so it cannot be looked at — in either theme, at either width,
// empty or paged — without a seeded server. This mounts the real screen against
// a generated library by answering its two requests in the page.
//
// `?theme=dark` opens in dark. `?empty=1` serves an empty library. `?count=N`
// sets how many boards (default 14, enough to page). `?live=N` puts a student
// in the first N boards.
import { createRoot } from 'react-dom/client';
import './index.css';
import type { BoardMeta } from '@whiteboard/shared';
import { Home } from './screens/home';
import { applyTheme } from './use-theme-store';

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light');
const count = params.get('empty') === '1' ? 0 : Number(params.get('count') ?? 14);

const NAMES = [
  'Amara Okonkwo — Further Maths',
  'Leo Vasquez — IB AA HL',
  'Ines Marchetti — Physics',
  'Tom Bergström — GCSE catch-up',
  'Priya Nair — A-level Chemistry',
  'Kenji Watanabe — Calculus',
  'Sofia Lindqvist — Statistics',
  'Mateo Rossi — Mechanics',
  'Hannah Schulz — Vectors',
  'Yusuf Demir — Complex numbers',
  'Chloé Martin — Probability',
  'Oliver Brown — Trigonometry',
  'Zara Ahmed — Differential equations',
  'Lucas Silva — Integration',
  'Mia Novak — Sequences & series',
  'Noah Kim — Proof',
  'Daryna (Ivan)',
  'Oksana (Sofia)',
];

const HOUR = 3_600_000;
const now = Date.now();
const boards: BoardMeta[] = Array.from({ length: count }, (_, i) => ({
  id: `review-${i}`,
  name: NAMES[i % NAMES.length]!,
  createdAt: now - (i + 3) * 9 * 24 * HOUR,
  updatedAt: now - i * 7 * HOUR,
  lastOpenedAt: now - (i * i + 1) * 5 * HOUR,
  favorite: i % 5 === 2,
}));
// `?afk=N` makes the first N live students idle.
const afk = Number(params.get('afk') ?? 0);
const live = boards
  .slice(0, Number(params.get('live') ?? 1))
  .map((b, i) => ({
    id: b.id,
    afk:
      i < afk ? [{ name: b.name.split(' ')[0]!, idleMinutes: 7 + i * 5 }] : [],
  }));

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url =
    typeof input === 'string' ? input : String((input as Request).url);
  if (url.includes('/api/auth/me')) {
    return Response.json({ authenticated: true, name: 'Alberto Trigo' });
  }
  if (url.endsWith('/api/boards')) return Response.json(boards);
  if (url.endsWith('/api/boards/live')) return Response.json(live);
  // Writes succeed without a server, so undo and favorites can be exercised.
  const write = /\/api\/boards\/([^/]+)$/.exec(url);
  if (write && (init?.method === 'PATCH' || init?.method === 'DELETE')) {
    const i = boards.findIndex((b) => b.id === decodeURIComponent(write[1]!));
    if (i >= 0 && init.method === 'DELETE') boards.splice(i, 1);
    if (i >= 0 && init.method === 'PATCH') {
      Object.assign(boards[i]!, JSON.parse(String(init.body)));
    }
    return Response.json({ ok: true });
  }
  return realFetch(input, init);
};

createRoot(document.getElementById('root')!).render(<Home />);
