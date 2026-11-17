import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  BarChart2,
  ChevronRight,
  ExternalLink,
  Library,
} from 'lucide-react';
import {
  ANALYTICS_RANGES,
  type AgentAsk,
  type AiJob,
  type AnalyticsBoard,
  type AnalyticsRange,
  type AnalyticsSummary,
  type AnalyticsVisit,
  isAnalyticsRange,
  plainAnswer,
} from '@whiteboard/shared';
import { fetchAnalytics } from '@/board/analytics';
import { formatUsd } from '@/board/ai-models';
import { JOB_LABEL } from '@/components/ai-models-dialog';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import {
  type Bin,
  type Presence,
  binTotal,
  binVisits,
  chartScale,
} from './analytics-bins';
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
 * The page answers a tutor's questions in bar charts: how much student time
 * there was and when, one chart over the range; then which canvases and which
 * students it went to, a ranked horizontal bar each. Opening a canvas gives its
 * own chart over the same range.
 *
 * Every bar speaks the same three states: solid with you, tint without you,
 * outline AFK. AFK stays out of the charts' height, so a forgotten tab cannot
 * flatten every real lesson.
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
  const whole = Math.round(minutes);
  if (whole <= 0) return '0m';
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
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

// Every surface below follows the shell the canvas list uses: the frame's
// tone, a borderless sidebar, one white panel, and inside it hairline-bordered
// 12px cards. Numbers are Inter with tabular figures, not mono — mono is for
// identifiers, and none of these are.

const HOVER_TINT = 'hover:bg-[var(--d-hover)]';
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--d-blue)]';

/**
 * The register's columns — name, bar, totals — shared by the canvas rows and
 * the people inside an opened one, so every bar on the page starts on one line.
 * Below `sm` the bar drops under its row at full width.
 */
const ROW =
  'grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 px-5 sm:grid-cols-[15rem_minmax(0,1fr)_13rem]';
/** Indent that lines a person's avatar up with the canvas name above it. */
const UNDER_NAME = 'pl-[26px]';

/** "4 visits, 3h 23m, 1h without you, 15m AFK" — a bar, said in words. */
function visitsSummary(visits: AnalyticsVisit[]): string {
  const minutes = visits.reduce((sum, v) => sum + v.minutes, 0);
  const alone = visits.reduce((sum, v) => sum + v.aloneMinutes, 0);
  const afk = visits.reduce((sum, v) => sum + v.afkMinutes, 0);
  const parts = [
    `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`,
    formatMinutes(minutes),
  ];
  if (alone > 0) parts.push(`${formatMinutes(alone)} without you`);
  if (afk > 0) parts.push(`${formatMinutes(afk)} AFK`);
  return parts.join(', ');
}

const PRESENCE_LABEL: Record<Presence, string> = {
  with: 'with you',
  alone: 'without you',
  afk: 'AFK, not counted',
};

const PRESENCE_FILL: Record<Presence, string> = {
  with: 'bg-[var(--d-with)]',
  alone: 'bg-[var(--d-alone)]',
  afk: 'shadow-[inset_0_0_0_1px_var(--d-afk)]',
};

/** One state's share of a bar. The gap between states comes from the parent. */
function Fill({ presence, weight }: { presence: Presence; weight: number }) {
  return (
    <span
      aria-hidden
      className={cn('min-h-0.5 min-w-0.5 rounded-[3px]', PRESENCE_FILL[presence])}
      style={{ flex: `${Math.max(weight, 1)} 1 0` }}
    />
  );
}

/** The states present in a sum of minutes, in the order they stack. */
function presenceParts(
  withYou: number,
  alone: number,
  afk: number,
): [Presence, number][] {
  const parts: [Presence, number][] = [
    ['with', withYou],
    ['alone', alone],
    ['afk', afk],
  ];
  return parts.filter(([, minutes]) => minutes > 0);
}

/** A horizontal bar in the states of its minutes, to the scale of its list. */
function TimeBar({
  withYou,
  alone,
  afk,
  top,
  label,
}: {
  withYou: number;
  alone: number;
  afk: number;
  top: number;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex h-2.5 gap-0.5"
      style={{ width: `${((withYou + alone + afk) / top) * 100}%` }}
    >
      {presenceParts(withYou, alone, afk).map(([presence, minutes]) => (
        <Fill key={presence} presence={presence} weight={minutes} />
      ))}
    </span>
  );
}

const BIN_NAME: Record<AnalyticsRange, string> = {
  1: 'hour',
  7: 'day',
  30: 'day',
  365: 'week',
};

/** What a bar stands for, in words. */
function binLabel(bin: Bin, range: AnalyticsRange): string {
  const date = new Date(bin.at);
  const when =
    range === 1
      ? date.toLocaleTimeString(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : date.toLocaleDateString(undefined, {
          weekday: range === 365 ? undefined : 'short',
          day: 'numeric',
          month: 'short',
        });
  return [
    range === 365 ? `Week of ${when}` : when,
    formatMinutes(binTotal(bin)),
    bin.alone > 0 && `${formatMinutes(bin.alone)} without you`,
    bin.afk > 0 && `${formatMinutes(bin.afk)} AFK`,
    bin.visits > 1 && `${bin.visits} visits`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The label under a bar, on the bars each range is read by. */
function binTick(at: number, range: AnalyticsRange): string | null {
  const date = new Date(at);
  if (range === 1) {
    if (date.getHours() % 3) return null;
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (range === 7) {
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
    });
  }
  if (range === 30) {
    if (date.getDay() !== 1) return null;
    return date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  }
  if (date.getDate() > 7) return null;
  return date.toLocaleDateString(undefined, { month: 'short' });
}

/** One column of a chart. Its whole height answers hover, however short the bar. */
function BinBar({
  bin,
  range,
  top,
  flip,
}: {
  bin: Bin;
  range: AnalyticsRange;
  top: number;
  flip: boolean;
}) {
  if (binTotal(bin) + bin.afk === 0) return <span className="min-w-0 flex-1" />;
  const text = binLabel(bin, range);
  const parts = presenceParts(bin.with, bin.alone, 0);
  return (
    <span
      role="img"
      tabIndex={0}
      aria-label={text}
      className="group/bar relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-[4px] outline-none hover:z-20 hover:bg-[var(--d-hover)] focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-[var(--d-ink)]"
    >
      <span
        aria-hidden
        className="flex min-h-[3px] w-full max-w-10 flex-col-reverse gap-0.5"
        style={{ height: `${(binTotal(bin) / top) * 100}%` }}
      >
        {parts.length ? (
          parts.map(([presence, minutes]) => (
            <Fill key={presence} presence={presence} weight={minutes} />
          ))
        ) : (
          <Fill presence="afk" weight={1} />
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-[calc(100%+8px)] hidden rounded-lg bg-[var(--d-ink)] px-2.5 py-1.5 text-(length:--d-fs-caption) whitespace-nowrap text-[var(--d-sheet)] group-hover/bar:block group-focus-visible/bar:block',
          flip ? 'right-0' : 'left-0',
        )}
      >
        {text}
      </span>
    </span>
  );
}

/** Student time as bars across the range, with empty days left empty. */
function TimeChart({
  visits,
  range,
  from,
  to,
  className,
}: {
  visits: AnalyticsVisit[];
  range: AnalyticsRange;
  from: number;
  to: number;
  className: string;
}) {
  const bins = binVisits(visits, range, from, to);
  const { top, lines } = chartScale(Math.max(1, ...bins.map(binTotal)));
  const title = `Student time per ${BIN_NAME[range]}`;
  const ticks = bins.flatMap((bin, i) => {
    const label = binTick(bin.at, range);
    return label ? [{ at: bin.at, i, label }] : [];
  });
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-3">
      <p className="text-(length:--d-fs-meta) text-[var(--d-pencil)]">{title}</p>
      <div className="ml-11 flex flex-col gap-2">
        <div className={cn('relative', className)}>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-px bg-[var(--d-rule)]"
          />
          {lines.map((line) => (
            <span
              key={line}
              aria-hidden
              className="absolute inset-x-0 h-px bg-[var(--d-rule-soft)]"
              style={{ bottom: `${(line / top) * 100}%` }}
            >
              <span className="absolute right-full mr-2 -translate-y-1/2 text-xs whitespace-nowrap tabular-nums text-[var(--d-pencil)]">
                {formatMinutes(line)}
              </span>
            </span>
          ))}
          <div className="absolute inset-0 flex gap-0.5">
            {bins.map((bin, i) => (
              <BinBar
                key={bin.at}
                bin={bin}
                range={range}
                top={top}
                flip={i > bins.length * 0.6}
              />
            ))}
          </div>
        </div>
        <div
          aria-hidden
          className="relative h-4 text-xs text-[var(--d-pencil)]"
        >
          {ticks.map((tick, n) => (
            <span
              key={tick.at}
              className={cn(
                'absolute top-0 -translate-x-1/2 whitespace-nowrap tabular-nums',
                // Crowded labels drop out on narrow screens.
                n % 2 === 1 && 'hidden md:inline',
              )}
              style={{ left: `${((tick.i + 0.5) / bins.length) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

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
          className="text-(length:--d-fs-title) leading-5 font-semibold text-[var(--d-ink)]"
        >
          {title}
        </h2>
        {meta ? (
          <span className="truncate text-(length:--d-fs-meta) text-[var(--d-pencil)]">
            {meta}
          </span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[var(--ds-radius-large)] border border-[var(--ds-border)] bg-[var(--ds-surface-raised)] shadow-[var(--ds-shadow-raised)]">
        {children}
      </div>
    </section>
  );
}

const TH =
  'px-3 py-3 whitespace-nowrap text-right text-(length:--d-fs-meta) font-medium text-[var(--d-pencil)]';
const TD =
  'px-3 py-3 whitespace-nowrap text-right text-(length:--d-fs-body) tabular-nums text-[var(--d-graphite)]';

/** One person's line inside an opened canvas: who, how long, and the sum of it. */
function PersonRow({
  name,
  tutor = false,
  withYou,
  alone,
  afk,
  top,
  note,
  label,
}: {
  name: string;
  tutor?: boolean;
  withYou: number;
  alone: number;
  afk: number;
  top: number;
  note: string;
  label: string;
}) {
  const minutes = withYou + alone;
  return (
    <li className={cn('grid gap-y-2 py-2', ROW)}>
      <span className={cn('flex min-w-0 items-center gap-2.5', UNDER_NAME)}>
        <Avatar name={name} tutor={tutor} />
        <span className="truncate text-(length:--d-fs-lead) text-[var(--d-ink)]">
          {name}
        </span>
      </span>
      <span className="order-last col-span-2 sm:order-none sm:col-span-1">
        <TimeBar
          withYou={withYou}
          alone={alone}
          afk={afk}
          top={top}
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

/** Asks shown before "Show all": enough for a lesson, short of a scroll. */
const ASKS_SHOWN = 5;

/**
 * What the students asked the board agent on one canvas, newest first: who,
 * when, the instruction in their words, and what the board did about it.
 */
function AgentAsks({ asks }: { asks: AgentAsk[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? asks : asks.slice(0, ASKS_SHOWN);
  return (
    <section aria-label="Asked the board" className={cn('flex flex-col gap-2 px-5', UNDER_NAME)}>
      <h3 className="text-(length:--d-fs-meta) font-medium text-[var(--d-pencil)] tabular-nums">
        Asked the board · {asks.length}
      </h3>
      <ol className="flex flex-col gap-3">
        {shown.map((ask) => (
          <li key={`${ask.at}${ask.name}`} className="flex min-w-0 gap-2.5">
            <Avatar name={ask.name} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-(length:--d-fs-meta) text-[var(--d-pencil)]">
                <span className="font-medium text-[var(--d-ink)]">{ask.name}</span>
                {' · '}
                <time dateTime={new Date(ask.at).toISOString()}>{relativeTime(ask.at)}</time>
              </span>
              <q className="text-(length:--d-fs-body) text-pretty text-[var(--d-ink)]">
                {ask.instruction}
              </q>
              <span className="line-clamp-2 text-(length:--d-fs-meta) text-[var(--d-graphite)]">
                {ask.kind === 'nothing' ? 'Nothing changed' : ask.kind === 'reply' ? `Answered: ${plainAnswer(ask.result)}` : ask.result}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {asks.length > ASKS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className={cn(
            'self-start rounded-sm text-(length:--d-fs-meta) font-medium text-[var(--d-blue)] hover:underline',
            FOCUS_RING,
          )}
        >
          {all ? 'Show fewer' : `Show all ${asks.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * An opened canvas: its own chart over the range, then the tutor and each
 * student on one scale, so who was there for how much of it reads down the bars.
 */
function BoardDetail({
  board,
  range,
  from,
  to,
}: {
  board: AnalyticsBoard;
  range: AnalyticsRange;
  from: number;
  to: number;
}) {
  const tutorVisits = board.visits.filter((v) => v.isTutor);
  const studentVisits = board.visits.filter((v) => !v.isTutor);
  const students = board.joiners.filter((j) => !j.isTutor && j.sessions > 0);
  const top = Math.max(
    1,
    board.tutorMinutes,
    ...students.map((j) => j.minutes + j.afkMinutes),
  );
  return (
    <div className="flex flex-col gap-3 bg-[var(--d-well)] pt-2 pb-4">
      <div className={cn('ml-5 pr-5', UNDER_NAME)}>
        <TimeChart
          visits={studentVisits}
          range={range}
          from={from}
          to={to}
          className="h-24"
        />
      </div>
      <ul aria-label={`Who was on ${board.name}`}>
        <PersonRow
          name="You"
          tutor
          withYou={board.tutorMinutes}
          alone={0}
          afk={0}
          top={top}
          note={
            tutorVisits.length
              ? `${tutorVisits.length} ${tutorVisits.length === 1 ? 'visit' : 'visits'}`
              : ''
          }
          label={`You: ${tutorVisits.length ? visitsSummary(tutorVisits) : 'no visits'}`}
        />
        {students.map((joiner) => (
          <PersonRow
            key={joiner.name}
            name={joiner.name}
            withYou={joiner.minutes - joiner.aloneMinutes}
            alone={joiner.aloneMinutes}
            afk={joiner.afkMinutes}
            top={top}
            note={[
              joiner.aloneMinutes > 0
                ? `${formatMinutes(joiner.aloneMinutes)} without you`
                : 'All with you',
              joiner.afkMinutes > 0 && `${formatMinutes(joiner.afkMinutes)} AFK`,
            ]
              .filter(Boolean)
              .join(' · ')}
            label={`${joiner.name}: ${visitsSummary(
              studentVisits.filter((v) => v.name === joiner.name),
            )}`}
          />
        ))}
      </ul>

      {board.agentAsks.length > 0 && <AgentAsks asks={board.agentAsks} />}

      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-5', UNDER_NAME)}>
        <Button
          variant="outline"
          className="gap-2 border-0 bg-[var(--ds-background-neutral)] font-medium text-[var(--ds-text)] hover:bg-[var(--ds-background-neutral-hovered)]"
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
  afkMinutes: number;
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
        afkMinutes: 0,
        lastSeenAt: 0,
      };
      person.minutes += joiner.minutes;
      person.sessions += joiner.sessions;
      person.drawings += joiner.drawings;
      person.aloneMinutes += joiner.aloneMinutes;
      person.afkMinutes += joiner.afkMinutes;
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
  const { studentMinutes, aloneMinutes, afkMinutes } = totals;
  const share = studentMinutes ? (aloneMinutes / studentMinutes) * 100 : 0;
  const shareLabel =
    share > 0 && share < 1 ? 'Under 1%' : `${Math.round(share)}%`;
  const parts = presenceParts(studentMinutes - aloneMinutes, aloneMinutes, afkMinutes);
  const facts: [string, string][] = [
    [totals.sessions.toLocaleString(), totals.sessions === 1 ? 'visit' : 'visits'],
    [`${totals.activeBoards} of ${totals.boards}`, 'canvases active'],
    [totals.drawings.toLocaleString(), totals.drawings === 1 ? 'drawing' : 'drawings'],
  ];
  const strong = 'text-[var(--d-ink)] tabular-nums';
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[40ch] text-(length:--d-fs-display) leading-7 font-bold text-balance text-[var(--d-graphite)]">
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
        <div className="flex flex-wrap justify-between gap-x-7 gap-y-2 text-(length:--d-fs-body) text-[var(--d-graphite)]">
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {parts.map(([presence, minutes]) => (
              <li key={presence} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn('size-2.5 rounded-[3px]', PRESENCE_FILL[presence])}
                />
                <span>
                  <span className="font-semibold tabular-nums text-[var(--d-ink)]">
                    {formatMinutes(minutes)}
                  </span>{' '}
                  {PRESENCE_LABEL[presence]}
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {facts.map(([value, label]) => (
              <li key={label}>
                <span className="tabular-nums text-[var(--d-ink)]">{value}</span>{' '}
                {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface CostRow {
  key: string;
  label: string;
  /** Which model, on the rows that need telling apart. */
  detail?: string;
  requests: number;
  cost: number;
}

/** Spend ranked by a bar each: what is expensive, and what each use costs. */
function CostList({ title, rows }: { title: string; rows: CostRow[] }) {
  const top = Math.max(...rows.map((row) => row.cost));
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-(length:--d-fs-meta) font-medium text-[var(--d-pencil)]">
        {title}
      </h3>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-3 text-(length:--d-fs-body)">
              <span className="min-w-0 truncate text-[var(--d-ink)]">
                {row.label}
                {row.detail ? (
                  <span className="ml-2 text-(length:--d-fs-meta) text-[var(--d-pencil)]">
                    {row.detail}
                  </span>
                ) : null}
              </span>
              <span className="ml-auto text-(length:--d-fs-meta) whitespace-nowrap tabular-nums text-[var(--d-pencil)]">
                {row.requests.toLocaleString()} × {formatUsd(row.cost / row.requests)}
              </span>
              <span className="w-14 text-right font-semibold tabular-nums text-[var(--d-ink)]">
                {formatUsd(row.cost)}
              </span>
            </div>
            <span
              aria-hidden
              className="h-2.5 min-w-0.5 rounded-[3px] bg-[var(--d-graphite)]"
              style={{ width: `${top ? (row.cost / top) * 100 : 0}%` }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What AI cost in range: by the feature that spent it and the canvas it was for. */
function AiUsageCard({
  ai,
  boards,
  range,
}: {
  ai: AnalyticsSummary['ai'];
  boards: AnalyticsBoard[];
  range: AnalyticsRange;
}) {
  const models = new Set(ai.byModel.map((row) => row.model));
  const onlyModel = models.size === 1 ? [...models][0] : null;
  const features: CostRow[] = ai.byModel
    .map((row) => ({
      key: `${row.job} ${row.model}`,
      label: JOB_LABEL[row.job as AiJob] ?? row.job,
      detail: onlyModel ? undefined : row.model,
      requests: row.requests,
      cost: row.cost,
    }))
    .sort((a, b) => b.cost - a.cost);
  const canvases: CostRow[] = boards
    .filter((b) => b.aiRequests > 0)
    .map((b) => ({
      key: b.id,
      label: b.name,
      requests: b.aiRequests,
      cost: b.aiCost,
    }))
    .sort((a, b) => b.cost - a.cost);
  return (
    <Card
      id="ai-usage-heading"
      title="AI usage"
      meta={[
        `${formatUsd(ai.cost)} over ${ai.requests.toLocaleString()} ${ai.requests === 1 ? 'request' : 'requests'} in ${RANGE_PHRASE[range]}`,
        onlyModel,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      {ai.requests === 0 ? (
        <p className="px-5 py-4 text-(length:--d-fs-body) text-[var(--d-graphite)]">
          No AI requests in {RANGE_PHRASE[range]}.
        </p>
      ) : (
        <div className="grid gap-x-12 gap-y-7 p-5 md:grid-cols-2">
          <CostList title="By feature" rows={features} />
          {canvases.length > 0 ? (
            <CostList title="By canvas" rows={canvases} />
          ) : null}
        </div>
      )}
    </Card>
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
    () =>
      (data?.boards ?? [])
        .filter((board) => board.sessions > 0)
        .sort((a, b) => b.studentMinutes - a.studentMinutes),
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
  const topStudent = Math.max(
    1,
    ...people.map((p) => p.minutes + p.afkMinutes),
  );
  const topBoard = Math.max(
    1,
    ...active.map((b) => b.studentMinutes + b.afkMinutes),
  );
  const visitsOf = (person: Person) =>
    (data?.boards ?? []).flatMap((board) =>
      board.visits.filter((v) => !v.isTutor && v.name === person.name),
    );

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
      <PageTitle
        breadcrumbs={['Library']}
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
            className="flex items-center gap-px rounded-[var(--ds-radius-medium)] bg-[var(--ds-background-neutral)] p-px"
          >
            {ANALYTICS_RANGES.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={range === days}
                onClick={() => chooseRange(days)}
                className={cn(
                  'flex h-[30px] items-center rounded-[calc(var(--ds-radius-medium)-1px)] px-3 text-(length:--d-fs-body) font-medium whitespace-nowrap transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-border-focused)]',
                  range === days
                    ? 'bg-[var(--ds-background-selected-bold)] text-[var(--ds-text-inverse)] hover:bg-[var(--ds-background-selected-bold-hovered)]'
                    : 'text-[var(--ds-text)] hover:bg-[var(--ds-background-neutral-hovered)]',
                )}
              >
                {RANGE_LABEL[days]}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex w-full flex-col gap-10 px-6 pt-8 pb-16 md:px-10">
        {error ? (
          <div
            role="alert"
            title={error}
            className="flex items-center gap-3 rounded-[var(--ds-radius-large)] bg-danger-bg px-5 py-4 text-(length:--d-fs-body) text-danger-fg"
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
            'flex flex-col gap-10 transition-opacity duration-200 motion-reduce:transition-none',
            loading && data && 'opacity-50',
          )}
        >
          <Summary totals={data?.totals} range={shownRange} />

          {data && active.length > 0 ? (
            <TimeChart
              visits={active.flatMap((b) => b.visits.filter((v) => !v.isTutor))}
              range={shownRange}
              from={data.from}
              to={data.to}
              className="h-44"
            />
          ) : null}

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
            ) : active.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <p className="text-xl leading-6 font-bold text-balance text-[var(--d-ink)]">
                  No visits in {RANGE_PHRASE[shownRange]}
                </p>
                <p className="max-w-sm text-(length:--d-fs-body) text-balance text-[var(--d-graphite)]">
                  The register fills itself the moment a student opens a canvas
                  link. Try a longer range, or share a canvas.
                </p>
                <Button
                  onClick={() => navigate('/')}
                >
                  Go to canvases
                </Button>
              </div>
            ) : (
              <ul className="py-2">
                {active.map((board) => {
                  const open = openBoardId === board.id;
                  const visits = board.visits.filter((v) => !v.isTutor);
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
                          'grid w-full gap-y-2 py-2.5 text-left transition-colors duration-150',
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

                        <span className="order-last col-span-2 sm:order-none sm:col-span-1">
                          <TimeBar
                            withYou={board.studentMinutes - board.aloneMinutes}
                            alone={board.aloneMinutes}
                            afk={board.afkMinutes}
                            top={topBoard}
                            label={`${board.name}: ${visitsSummary(visits)}`}
                          />
                        </span>

                        <span className="flex flex-col items-end whitespace-nowrap">
                          <span className="text-(length:--d-fs-lead) font-semibold tabular-nums text-[var(--d-ink)]">
                            {formatMinutes(board.studentMinutes)}
                          </span>
                          <span className="text-(length:--d-fs-meta) tabular-nums text-[var(--d-pencil)]">
                            {board.sessions}{' '}
                            {board.sessions === 1 ? 'visit' : 'visits'}
                            {board.afkMinutes > 0
                              ? ` · ${formatMinutes(board.afkMinutes)} AFK`
                              : ''}
                          </span>
                        </span>
                      </button>

                      {open && data ? (
                        <BoardDetail
                          board={board}
                          range={shownRange}
                          from={data.from}
                          to={data.to}
                        />
                      ) : null}
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
                      <th scope="col" className={cn(TH, 'w-full text-left')}>
                        Time
                      </th>
                      <th scope="col" className={TH}>
                        Visits
                      </th>
                      <th scope="col" className={cn(TH, 'hidden md:table-cell')}>
                        Avg stay
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
                        <td className="py-3 pr-3 pl-3">
                          <span className="flex items-center gap-3">
                            <span className="min-w-0 flex-1">
                              <TimeBar
                                withYou={person.minutes - person.aloneMinutes}
                                alone={person.aloneMinutes}
                                afk={person.afkMinutes}
                                top={topStudent}
                                label={visitsSummary(visitsOf(person))}
                              />
                            </span>
                            <span className="text-(length:--d-fs-body) font-semibold whitespace-nowrap tabular-nums text-[var(--d-ink)]">
                              {formatMinutes(person.minutes)}
                            </span>
                          </span>
                        </td>
                        <td className={TD}>{person.sessions}</td>
                        <td className={cn(TD, 'hidden md:table-cell')}>
                          {formatMinutes(person.minutes / person.sessions)}
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

          {data ? (
            <AiUsageCard ai={data.ai} boards={data.boards} range={shownRange} />
          ) : null}
        </div>
      </div>
    </DashboardShell>
  );
}
