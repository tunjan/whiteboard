import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart2,
  ChevronRight,
  ExternalLink,
  Library,
} from 'lucide-react';
import {
  ANALYTICS_RANGES,
  type AnalyticsBoard,
  type AnalyticsRange,
  type AnalyticsSummary,
  type AnalyticsVisit,
  isAnalyticsRange,
} from '@whiteboard/shared';
import { fetchAnalytics } from '@/board/analytics';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import {
  AccountMenu,
  DashboardShell,
  NavItem,
  PageTitle,
  initials,
  markerFor,
} from './dashboard-shell';
import { Login } from './login';

/**
 * The tutor's attendance register.
 *
 * Laid out as a register rather than a dashboard: canvases down the left, time
 * across, and each visit drawn where it happened and as long as it lasted. One
 * artifact answers the questions a tutor has — who came, when, for how long,
 * and whether anyone was there with them — where a stack of counters and a
 * trend line would answer none of them without arithmetic.
 */

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  1: 'Day',
  7: 'Week',
  30: 'Month',
  365: 'Year',
};

const RANGE_PHRASE: Record<AnalyticsRange, string> = {
  1: 'the last 24 hours',
  7: 'the last week',
  30: 'the last month',
  365: 'the last year',
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function relativeTime(ts: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = ts - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function spanLabel(from: number, to: number): string {
  const format = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: to - from > 180 * 86_400_000 ? 'numeric' : undefined,
    });
  return `${format(from)} – ${format(to)}`;
}

function visitLabel(visit: AnalyticsVisit): string {
  const start = new Date(visit.startedAt);
  const date = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const parts = [
    `${visit.isTutor ? 'You' : visit.name} · ${date} ${time(start)}–${time(new Date(visit.endedAt))}`,
    formatMinutes(visit.minutes),
  ];
  if (!visit.isTutor) {
    parts.push(
      `${visit.drawings} ${visit.drawings === 1 ? 'drawing' : 'drawings'}`,
    );
    if (visit.aloneMinutes > 0) {
      parts.push(`${formatMinutes(visit.aloneMinutes)} without you`);
    }
    if (visit.afkMinutes > 0) {
      parts.push(`${formatMinutes(visit.afkMinutes)} idle, not counted`);
    }
  }
  return parts.join(' · ');
}

interface Tick {
  at: number;
  /** Where the label sits: the middle of the day or month it names. */
  mid: number;
  label: string;
}

const HOUR = 3_600_000;

/**
 * Where the axis is marked for a range, in the tutor's own time zone: hours
 * across a day, days across a week, Mondays across a month, months across a
 * year — the unit each view is read in.
 */
function axisTicks(from: number, to: number, range: AnalyticsRange): Tick[] {
  const ticks: Tick[] = [];
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  if (range === 1) {
    cursor.setHours(Math.ceil(cursor.getHours() / 3) * 3);
  } else {
    cursor.setHours(0);
    if (range === 365) cursor.setDate(1);
  }
  const step = () => {
    if (range === 1) cursor.setHours(cursor.getHours() + 3);
    else if (range === 7) cursor.setDate(cursor.getDate() + 1);
    else if (range === 30) cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1);
  };
  for (; cursor.getTime() <= to; step()) {
    const at = cursor.getTime();
    if (at < from) continue;
    if (range === 30 && cursor.getDay() !== 1) continue;
    // An hour is a moment, so its label sits on the line. A day or a month is
    // a span, so its label sits over the span — and a span still running is
    // centred on what has happened of it so far.
    let mid = at;
    if (range === 7 || range === 30) mid = Math.min(at + 12 * HOUR, (at + to) / 2);
    if (range === 365) {
      const next = new Date(at);
      next.setMonth(next.getMonth() + 1);
      mid = (at + Math.min(next.getTime(), to)) / 2;
    }
    const label =
      range === 1
        ? cursor.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })
        : range === 7
          ? cursor.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
            })
          : range === 30
            ? cursor.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })
            : cursor.toLocaleDateString(undefined, { month: 'short' });
    ticks.push({ at, mid, label });
  }
  return ticks;
}

interface Axis {
  from: number;
  to: number;
  ticks: Tick[];
}

const position = (axis: Axis, ts: number) =>
  Math.min(1, Math.max(0, (ts - axis.from) / (axis.to - axis.from)));
// Every surface below follows the shell the canvas list uses: the frame's
// tone, a borderless sidebar, one white panel, and inside it hairline-bordered
// 12px cards. Numbers are Inter with tabular figures, not mono — mono is for
// identifiers, and none of these are.

const HOVER_TINT = 'hover:bg-[var(--d-hover)]';
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--d-blue)]';

/**
 * The register's columns — name, lane, totals — shared by the canvas rows and
 * the people inside an opened one, so every lane on the page sits on the same
 * axis. Below `sm` the lane drops under its row at full width.
 */
const ROW =
  'grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 px-5 sm:grid-cols-[15rem_minmax(0,1fr)_9rem]';
/** Indent that lines a person's avatar up with the canvas name above it. */
const UNDER_NAME = 'pl-[26px]';

/** The range's time axis, labelled — sits above the lanes it measures. */
function AxisLabels({ axis }: { axis: Axis }) {
  return (
    <div
      aria-hidden
      className="relative h-4 text-xs text-[var(--d-pencil)]"
    >
      {axis.ticks.map((tick, i) => (
        <span
          key={tick.at}
          className={cn(
            'absolute top-0 -translate-x-1/2 whitespace-nowrap tabular-nums',
            // Crowded labels drop out on narrow screens; the gridlines stay.
            i % 2 === 1 && 'hidden md:inline',
          )}
          style={{ left: `${position(axis, tick.mid) * 100}%` }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

/** "4 visits, 3h 23m, 1h without you" — what a lane shows, said in words. */
function laneSummary(visits: AnalyticsVisit[]): string {
  const minutes = visits.reduce((sum, v) => sum + v.minutes, 0);
  const alone = visits.reduce((sum, v) => sum + v.aloneMinutes, 0);
  const parts = [
    `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`,
    formatMinutes(minutes),
  ];
  if (alone > 0) parts.push(`${formatMinutes(alone)} without you`);
  return parts.join(', ');
}

/**
 * One lane of visits laid on the axis. A bar is as wide as the visit was long,
 * with a floor so a quarter-hour in a year view still reads as a mark. Visits
 * passed as `under` sit as a thin blue rule beneath — the tutor's — so a bar
 * with nothing under it is time a student spent on their own.
 *
 * With `focusable`, each bar is a stop for the keyboard and names its visit on
 * focus as well as on hover; otherwise the lane is one image with a summary.
 */
function Lane({
  axis,
  bars,
  ink,
  under = [],
  label,
  focusable = false,
  tall = false,
}: {
  axis: Axis;
  bars: AnalyticsVisit[];
  ink: (visit: AnalyticsVisit) => string;
  under?: AnalyticsVisit[];
  label: string;
  focusable?: boolean;
  tall?: boolean;
}) {
  const span = (visit: AnalyticsVisit) => {
    const left = position(axis, visit.startedAt);
    return {
      left,
      style: {
        left: `${left * 100}%`,
        width: `${(position(axis, visit.endedAt) - left) * 100}%`,
      },
    };
  };
  return (
    <div
      role={focusable ? 'group' : 'img'}
      aria-label={label}
      className={cn('relative w-full', tall ? 'h-7' : 'h-6')}
    >
      {axis.ticks.map((tick) => (
        <div
          key={tick.at}
          aria-hidden
          className="absolute inset-y-0 w-px bg-[var(--d-rule-soft)]"
          style={{ left: `${position(axis, tick.at) * 100}%` }}
        />
      ))}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px -translate-y-[1.5px] bg-[var(--d-rule)]"
      />
      {under.map((visit) => (
        <div
          key={`u-${visit.startedAt}`}
          aria-hidden={focusable || undefined}
          title={focusable ? undefined : visitLabel(visit)}
          className="absolute bottom-0 h-[3px] min-w-[3px] rounded-full bg-[var(--d-blue)]"
          style={span(visit).style}
        />
      ))}
      {bars.map((visit) => {
        const { left, style } = span(visit);
        const text = visitLabel(visit);
        return focusable ? (
          <span
            key={`b-${visit.name}-${visit.startedAt}`}
            role="img"
            tabIndex={0}
            aria-label={text}
            className="group/visit absolute top-[4px] bottom-[7px] min-w-[5px] rounded-full outline-none before:absolute before:-inset-x-1.5 before:-inset-y-1 before:content-[''] focus-visible:ring-2 focus-visible:ring-[var(--d-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--d-well)]"
            style={{ ...style, backgroundColor: ink(visit) }}
          >
            <span
              aria-hidden
              className={cn(
                'pointer-events-none absolute bottom-[calc(100%+8px)] z-10 hidden rounded-lg bg-[var(--d-ink)] px-2.5 py-1.5 text-(length:--d-fs-caption) whitespace-nowrap text-[var(--d-sheet)] group-hover/visit:block group-focus-visible/visit:block',
                left > 0.6 ? 'right-0' : 'left-0',
              )}
            >
              {text}
            </span>
          </span>
        ) : (
          <div
            key={`b-${visit.name}-${visit.startedAt}`}
            title={text}
            className="absolute top-[4px] bottom-[7px] min-w-[5px] rounded-full"
            style={{ ...style, backgroundColor: ink(visit) }}
          />
        );
      })}
    </div>
  );
}

/**
 * A student writes in the marker their name hashes to. The colour a client
 * publishes is not used here: it can be any hue, and on this page blue is
 * the tutor and green is "live".
 */
const studentInk = (visit: AnalyticsVisit) => markerFor(visit.name);
const neutralInk = () => 'var(--d-graphite)';
const tutorInk = () => 'var(--d-blue)';

function Avatar({ name, tutor = false }: { name: string; tutor?: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-(length:--d-fs-caption) font-semibold text-[var(--d-sheet)]"
      style={{ backgroundColor: tutor ? 'var(--d-ink)' : markerFor(name) }}
    >
      {initials(name, '?')}
    </span>
  );
}

/** A section of the sheet: a display-face title over a softly outlined panel. */
function Card({
  id,
  title,
  meta,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 px-1">
        <h2
          id={id}
          className="d-display text-(length:--d-fs-title) font-semibold text-[var(--d-ink)]"
        >
          {title}
        </h2>
        {meta ? (
          <span className="truncate text-(length:--d-fs-meta) text-[var(--d-pencil)]">
            {meta}
          </span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[22px] bg-[var(--d-sheet)] ring-1 ring-[var(--d-rule)]">
        {children}
      </div>
    </section>
  );
}

const TH =
  'px-3 py-3 whitespace-nowrap text-right text-(length:--d-fs-meta) font-medium text-[var(--d-pencil)]';
const TD =
  'px-3 py-3 whitespace-nowrap text-right text-(length:--d-fs-body) tabular-nums text-[var(--d-graphite)]';

/** One person's line inside an opened canvas: who, when, and the sum of it. */
function PersonLane({
  axis,
  name,
  tutor = false,
  bars,
  minutes,
  note,
  label,
}: {
  axis: Axis;
  name: string;
  tutor?: boolean;
  bars: AnalyticsVisit[];
  minutes: number;
  note: string;
  label: string;
}) {
  return (
    <li className={cn('grid gap-y-2 py-2', ROW)}>
      <span className={cn('flex min-w-0 items-center gap-2.5', UNDER_NAME)}>
        <Avatar name={name} tutor={tutor} />
        <span className="truncate text-(length:--d-fs-lead) text-[var(--d-ink)]">
          {name}
        </span>
      </span>
      <span className="order-last col-span-2 sm:order-none sm:col-span-1">
        <Lane
          tall
          focusable
          axis={axis}
          bars={bars}
          ink={tutor ? tutorInk : studentInk}
          label={label}
        />
      </span>
      <span className="flex flex-col items-end whitespace-nowrap">
        <span className="text-(length:--d-fs-body) font-semibold tabular-nums text-[var(--d-ink)]">
          {minutes > 0 ? formatMinutes(minutes) : 'Not here'}
        </span>
        {note ? (
          <span className="text-(length:--d-fs-meta) tabular-nums text-[var(--d-pencil)]">
            {note}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * An opened canvas: the tutor's own lane first, then each student's on the
 * same axis, so time without the tutor reads straight down the column.
 */
function BoardDetail({ board, axis }: { board: AnalyticsBoard; axis: Axis }) {
  const tutorVisits = board.visits.filter((v) => v.isTutor);
  const students = board.joiners.filter((j) => !j.isTutor && j.sessions > 0);
  return (
    <div className="flex flex-col gap-2 bg-[var(--d-well)] pt-1 pb-4">
      <ul aria-label={`Who was on ${board.name}`}>
        <PersonLane
          axis={axis}
          name="You"
          tutor
          bars={tutorVisits}
          minutes={board.tutorMinutes}
          note={
            tutorVisits.length
              ? `${tutorVisits.length} ${tutorVisits.length === 1 ? 'visit' : 'visits'}`
              : ''
          }
          label={`You: ${tutorVisits.length ? laneSummary(tutorVisits) : 'no visits'}`}
        />
        {students.map((joiner) => {
          const visits = board.visits.filter(
            (v) => !v.isTutor && v.name === joiner.name,
          );
          return (
            <PersonLane
              key={joiner.name}
              axis={axis}
              name={joiner.name}
              bars={visits}
              minutes={joiner.minutes}
              note={
                joiner.aloneMinutes > 0
                  ? `${formatMinutes(joiner.aloneMinutes)} without you`
                  : 'All with you'
              }
              label={`${joiner.name}: ${laneSummary(visits)}`}
            />
          );
        })}
      </ul>

      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-5', UNDER_NAME)}>
        <Button
          variant="outline"
          className="h-9 gap-2 rounded-full border-0 bg-[var(--d-sheet)] px-4 text-(length:--d-fs-body) font-medium shadow-none ring-1 ring-[var(--d-rule)] hover:bg-[var(--d-hover)]"
          onClick={() => navigate(`/board/${encodeURIComponent(board.id)}`)}
        >
          <ExternalLink className="size-4 text-[var(--d-blue)]" />
          Open canvas
        </Button>
        {board.notedSessions > 0 ? (
          <span className="text-(length:--d-fs-meta) tabular-nums text-[var(--d-pencil)]">
            {board.notedSessions}{' '}
            {board.notedSessions === 1 ? 'session note' : 'session notes'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface Person {
  name: string;
  minutes: number;
  sessions: number;
  drawings: number;
  aloneMinutes: number;
  boards: number;
  lastSeenAt: number;
}

/** Everyone who joined, rolled up across the canvases they worked on. */
function rollUpPeople(boards: AnalyticsBoard[]): Person[] {
  const people = new Map<string, Person>();
  for (const board of boards) {
    for (const joiner of board.joiners) {
      if (joiner.isTutor) continue;
      const person = people.get(joiner.name) ?? {
        name: joiner.name,
        minutes: 0,
        sessions: 0,
        drawings: 0,
        aloneMinutes: 0,
        boards: 0,
        lastSeenAt: 0,
      };
      person.minutes += joiner.minutes;
      person.sessions += joiner.sessions;
      person.drawings += joiner.drawings;
      person.aloneMinutes += joiner.aloneMinutes;
      person.boards += 1;
      person.lastSeenAt = Math.max(person.lastSeenAt, joiner.lastSeenAt);
      people.set(joiner.name, person);
    }
  }
  // Someone with nothing in this range is a quiet canvas, not a row of zeros:
  // the section below says so with the date they were last here.
  return [...people.values()]
    .filter((person) => person.sessions > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

/**
 * The range in one sentence, led by the number only this page can give: how
 * much of the students' time was spent without the tutor, as a share.
 */
function Summary({
  totals,
  range,
}: {
  totals: AnalyticsSummary['totals'] | undefined;
  range: AnalyticsRange;
}) {
  if (!totals) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full max-w-xl rounded-xl" />
        <Skeleton className="h-5 w-full max-w-md rounded-full" />
      </div>
    );
  }
  const { studentMinutes, aloneMinutes } = totals;
  const share = studentMinutes ? (aloneMinutes / studentMinutes) * 100 : 0;
  const shareLabel =
    share > 0 && share < 1 ? 'Under 1%' : `${Math.round(share)}%`;
  const facts: [string, string][] = [
    [formatMinutes(aloneMinutes), 'without you'],
    [totals.sessions.toLocaleString(), totals.sessions === 1 ? 'visit' : 'visits'],
    [`${totals.activeBoards} of ${totals.boards}`, 'canvases active'],
    [totals.drawings.toLocaleString(), totals.drawings === 1 ? 'drawing' : 'drawings'],
  ];
  const strong = 'text-[var(--d-ink)] tabular-nums';
  return (
    <div className="flex flex-col gap-5">
      <p className="d-display max-w-[24ch] text-(length:--d-fs-display) leading-[1.12] font-semibold text-balance text-[var(--d-graphite)]">
        {studentMinutes === 0 ? (
          <>No student time in {RANGE_PHRASE[range]}.</>
        ) : (
          <>
            <span className={strong}>{formatMinutes(studentMinutes)}</span> of
            student time in {RANGE_PHRASE[range]}.{' '}
            {aloneMinutes === 0 ? (
              <>All of it with you.</>
            ) : (
              <>
                <span className={strong}>{shareLabel}</span> of it without you.
              </>
            )}
          </>
        )}
      </p>
      {studentMinutes > 0 ? (
        <ul className="flex flex-wrap gap-x-7 gap-y-2 text-(length:--d-fs-lead) text-[var(--d-graphite)]">
          {facts.map(([value, label]) => (
            <li key={label}>
              <span className="font-semibold tabular-nums text-[var(--d-ink)]">
                {value}
              </span>{' '}
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const RANGE_KEY = 'attendance-range';

function savedRange(): AnalyticsRange {
  try {
    const saved = Number(localStorage.getItem(RANGE_KEY));
    if (isAnalyticsRange(saved)) return saved;
  } catch {
    // Storage blocked: fall through to the week.
  }
  return 7;
}

export function Analytics() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [range, setRange] = useState<AnalyticsRange>(savedRange);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openBoardId, setOpenBoardId] = useState<string | null>(null);

  useEffect(() => {
    void getAuth().then(setAuth);
  }, []);

  const chooseRange = (days: AnalyticsRange) => {
    setRange(days);
    try {
      localStorage.setItem(RANGE_KEY, String(days));
    } catch {
      // Not remembered this time; the choice still applies.
    }
  };

  const load = useCallback((days: AnalyticsRange, signal?: AbortSignal) => {
    setError(null);
    setLoading(true);
    fetchAnalytics(days, signal)
      .then(setData)
      .catch((cause: unknown) => {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : 'Could not load the register',
        );
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const controller = new AbortController();
    load(range, controller.signal);
    return () => controller.abort();
  }, [auth?.authenticated, range, load]);

  const people = useMemo(() => (data ? rollUpPeople(data.boards) : []), [data]);
  const quiet = useMemo(
    () =>
      (data?.boards ?? [])
        .filter((board) => board.sessions === 0)
        .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)),
    [data],
  );
  const active = useMemo(
    () => (data?.boards ?? []).filter((board) => board.sessions > 0),
    [data],
  );
  const axis = useMemo<Axis | null>(
    () =>
      data
        ? {
            from: data.from,
            to: data.to,
            ticks: axisTicks(data.from, data.to, data.rangeDays as AnalyticsRange),
          }
        : null,
    [data],
  );

  if (auth && !auth.authenticated) {
    return <Login onSuccess={() => void getAuth().then(setAuth)} />;
  }

  const accountName = auth?.name?.trim() || 'Tutor';
  const signOut = async () => {
    await logout();
    setAuth({ authenticated: false });
  };
  // The figures on screen belong to the range they were fetched for, which
  // lags the control while a new range loads.
  const shownRange = (data?.rangeDays ?? range) as AnalyticsRange;

  return (
    <DashboardShell
      busy={!data || loading}
      account={
        auth ? <AccountMenu name={accountName} onLogout={signOut} /> : null
      }
      nav={
        <>
          <NavItem
            icon={<Library />}
            label="Canvases"
            onClick={() => navigate('/')}
          />
          <NavItem
            icon={<BarChart2 />}
            label="Attendance"
            active
            onClick={() => undefined}
          />
        </>
      }
    >
      <div className="flex items-center justify-between px-4 pt-4 md:hidden">
        <Button
          variant="ghost"
          aria-label="Back to canvases"
          onClick={() => navigate('/')}
          className="size-10 rounded-full p-0 text-[var(--d-graphite)] hover:bg-[var(--d-hover)]"
        >
          <ArrowLeft className="size-5" />
        </Button>
        {auth ? (
          <AccountMenu name={accountName} onLogout={signOut} compact />
        ) : null}
      </div>

      <PageTitle
        title="Attendance"
        detail={
          data ? (
            <span className="tabular-nums">{spanLabel(data.from, data.to)}</span>
          ) : (
            ' '
          )
        }
        actions={
          <div
            role="group"
            aria-label="Date range"
            className="flex items-center gap-1 rounded-full bg-[var(--d-tray)] p-1"
          >
            {ANALYTICS_RANGES.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={range === days}
                onClick={() => chooseRange(days)}
                className={cn(
                  'flex h-9 items-center rounded-full px-4 text-(length:--d-fs-body) font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-blue)]',
                  range === days
                    ? 'bg-[var(--d-sheet)] text-[var(--d-ink)]'
                    : 'text-[var(--d-graphite)] hover:text-[var(--d-ink)]',
                )}
              >
                {RANGE_LABEL[days]}
              </button>
            ))}
          </div>
        }
      />

      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-14 px-5 pt-10 pb-16 md:px-12 md:pt-14">
        {error ? (
          <div
            role="alert"
            title={error}
            className="flex items-center gap-3 rounded-[18px] bg-danger-bg px-5 py-4 text-(length:--d-fs-body) text-danger-fg"
          >
            <AlertCircle className="size-4 shrink-0" />
            <span className="mr-auto">
              Attendance didn’t load. Check your connection, then try again.
            </span>
            <button
              type="button"
              className="shrink-0 rounded-sm font-semibold underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-current"
              onClick={() => load(range)}
            >
              Try again
            </button>
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-col gap-14 transition-opacity duration-200 motion-reduce:transition-none',
            loading && data && 'opacity-50',
          )}
        >
          <Summary totals={data?.totals} range={shownRange} />

          <Card id="register-heading" title="Register">
            {!data ? (
              <div className="divide-y divide-[var(--d-rule-soft)]">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-5 px-5 py-4">
                    <Skeleton className="h-4 w-40 rounded-full" />
                    <Skeleton className="h-5 flex-1 rounded-full" />
                    <Skeleton className="h-4 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            ) : active.length === 0 || !axis ? (
              <div className="d-dots m-2 flex flex-col items-center gap-5 rounded-[18px] px-6 py-16 text-center">
                <p className="d-hand text-(length:--d-fs-display) leading-[1.05] font-semibold text-balance text-[var(--d-graphite)]">
                  No visits in {RANGE_PHRASE[shownRange]}
                </p>
                <p className="max-w-sm text-(length:--d-fs-body) text-balance text-[var(--d-graphite)]">
                  The register fills itself the moment a student opens a canvas
                  link. Try a longer range, or share a canvas.
                </p>
                <Button
                  onClick={() => navigate('/')}
                  className="h-11 rounded-full bg-[var(--d-ink)] px-5 text-(length:--d-fs-body) font-medium text-[var(--d-sheet)] hover:bg-[color-mix(in_srgb,var(--d-ink)_86%,var(--d-sheet))]"
                >
                  Go to canvases
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--d-rule-soft)]">
                <li aria-hidden className={cn('hidden pt-5 pb-2 sm:grid', ROW)}>
                  <span />
                  <AxisLabels axis={axis} />
                  <span />
                </li>
                <li aria-hidden className="px-5 pt-4 pb-1 sm:hidden">
                  <AxisLabels axis={axis} />
                </li>
                {active.map((board) => {
                  const open = openBoardId === board.id;
                  const visits = board.visits.filter((v) => !v.isTutor);
                  const label = `${board.name}: ${laneSummary(visits)}`;
                  return (
                    <li
                      key={board.id}
                      className={cn(open && 'bg-[var(--d-well)]')}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpenBoardId(open ? null : board.id)}
                        className={cn(
                          'grid w-full py-4 text-left transition-colors duration-150',
                          ROW,
                          FOCUS_RING,
                          HOVER_TINT,
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <ChevronRight
                            aria-hidden
                            className={cn(
                              'size-4 shrink-0 text-[var(--d-pencil)] transition-transform duration-200 motion-reduce:transition-none',
                              open && 'rotate-90 text-[var(--d-ink)]',
                            )}
                          />
                          <span className="truncate text-(length:--d-fs-lead) font-medium text-[var(--d-ink)]">
                            {board.name}
                          </span>
                        </span>

                        <span className="hidden sm:block">
                          <Lane
                            axis={axis}
                            bars={visits}
                            ink={neutralInk}
                            under={board.visits.filter((v) => v.isTutor)}
                            label={label}
                          />
                        </span>

                        <span className="flex flex-col items-end whitespace-nowrap">
                          <span className="text-(length:--d-fs-lead) font-semibold tabular-nums text-[var(--d-ink)]">
                            {formatMinutes(board.studentMinutes)}
                          </span>
                          <span className="text-(length:--d-fs-meta) tabular-nums text-[var(--d-pencil)]">
                            {board.sessions}{' '}
                            {board.sessions === 1 ? 'visit' : 'visits'} over{' '}
                            {board.activeDays}{' '}
                            {board.activeDays === 1 ? 'day' : 'days'}
                          </span>
                        </span>
                      </button>

                      {open ? null : (
                        <div className="px-5 pb-4 sm:hidden">
                          <Lane
                            axis={axis}
                            bars={visits}
                            ink={neutralInk}
                            under={board.visits.filter((v) => v.isTutor)}
                            label={label}
                          />
                        </div>
                      )}

                      {open ? <BoardDetail board={board} axis={axis} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {people.length > 0 ? (
            <Card
              id="people-heading"
              title="Students"
              meta="By the name each entered when joining"
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--d-rule-soft)]">
                      <th scope="col" className={cn(TH, 'pl-5 text-left')}>
                        Student
                      </th>
                      <th scope="col" className={cn(TH, 'hidden sm:table-cell')}>
                        Canvases
                      </th>
                      <th scope="col" className={TH}>
                        Visits
                      </th>
                      <th scope="col" className={cn(TH, 'hidden md:table-cell')}>
                        Avg stay
                      </th>
                      <th scope="col" className={TH}>
                        Time
                      </th>
                      <th scope="col" className={TH}>
                        Without you
                      </th>
                      <th scope="col" className={cn(TH, 'hidden sm:table-cell')}>
                        Drawings
                      </th>
                      <th
                        scope="col"
                        className={cn(TH, 'hidden pr-5 sm:table-cell')}
                      >
                        Last seen
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--d-rule-soft)]">
                    {people.map((person) => (
                      <tr
                        key={person.name}
                        className="transition-colors duration-150 hover:bg-[var(--d-hover)]"
                      >
                        <th
                          scope="row"
                          className="py-3 pr-3 pl-5 text-left font-normal"
                        >
                          <span className="flex items-center gap-3">
                            <Avatar name={person.name} />
                            <span className="truncate text-(length:--d-fs-body) font-medium text-[var(--d-ink)]">
                              {person.name}
                            </span>
                          </span>
                        </th>
                        <td className={cn(TD, 'hidden sm:table-cell')}>
                          {person.boards}
                        </td>
                        <td className={TD}>{person.sessions}</td>
                        <td className={cn(TD, 'hidden md:table-cell')}>
                          {formatMinutes(person.minutes / person.sessions)}
                        </td>
                        <td className={cn(TD, 'font-semibold text-[var(--d-ink)]')}>
                          {formatMinutes(person.minutes)}
                        </td>
                        <td className={TD}>
                          {person.aloneMinutes > 0 ? (
                            formatMinutes(person.aloneMinutes)
                          ) : (
                            <span aria-label="None" className="text-[var(--d-pencil)]">
                              –
                            </span>
                          )}
                        </td>
                        <td className={cn(TD, 'hidden sm:table-cell')}>
                          {person.drawings.toLocaleString()}
                        </td>
                        <td
                          className={cn(
                            TD,
                            'hidden pr-5 text-(length:--d-fs-meta) text-[var(--d-pencil)] sm:table-cell',
                          )}
                        >
                          {relativeTime(person.lastSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {quiet.length > 0 ? (
            <Card
              id="quiet-heading"
              title="Quiet canvases"
              meta={`No student in ${RANGE_PHRASE[shownRange]}`}
            >
              <ul className="divide-y divide-[var(--d-rule-soft)]">
                {quiet.map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/board/${encodeURIComponent(board.id)}`)
                      }
                      className={cn(
                        'flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors duration-150',
                        FOCUS_RING,
                        HOVER_TINT,
                      )}
                    >
                      <span className="truncate text-(length:--d-fs-lead) text-[var(--d-ink)]">
                        {board.name}
                      </span>
                      <span className="shrink-0 text-(length:--d-fs-meta) text-[var(--d-pencil)]">
                        {board.lastActiveAt
                          ? `Last student ${relativeTime(board.lastActiveAt)}`
                          : 'No student has joined yet'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
