import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  BarChart2,
  Check,
  ChevronDown,
  LayoutGrid,
  Library,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SquareCheck,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import {
  boardRepository,
  fetchLiveBoardIds,
} from '@/board/server-board-repository';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Toaster, toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import {
  AccountMenu,
  DashboardShell,
  FOCUS,
  initials,
  Lozenge,
  markerFor,
  NEUTRAL_BUTTON,
  NavItem,
  PageTitle,
} from './dashboard-shell';
import { Login } from './login';

type TitleDialogState =
  { mode: 'create' } | { mode: 'rename'; board: BoardMeta };

type LibraryView = 'all' | 'favorites';
type SortMode = 'activity' | 'edited' | 'created' | 'name';
type LibraryLayout = 'grid' | 'list';

// Grid or list is a per-browser habit, not something worth syncing.
const LAYOUT_KEY = 'whiteboard:library-layout';

// Favorites used to live in this browser only. Read once, pushed to the
// server, then forgotten — the server copy is the one every device shares.
const LEGACY_FAVORITES_KEY = 'whiteboard:favorite-board-ids';

// How long a deleted canvas can still be brought back.
const UNDO_MS = 8_000;

// Row controls wait for the pointer, but stay put on any screen that can be
// touched — a touch laptop has hover too, yet a finger on it has none — and
// while their own menu is open.
const REVEAL =
  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 [@media(any-pointer:coarse)]:opacity-100';

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const SORT_LABELS: Record<SortMode, string> = {
  activity: 'Last opened',
  edited: 'Last edited',
  created: 'Date created',
  name: 'Name',
};

function takeLegacyFavoriteIds(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(LEGACY_FAVORITES_KEY) ?? '[]');
    localStorage.removeItem(LEGACY_FAVORITES_KEY);
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function readLayout(): LibraryLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

// The timestamp a sort orders by, and so the one its day groups are cut on.
function sortTime(board: BoardMeta, mode: SortMode): number {
  if (mode === 'created') return board.createdAt;
  if (mode === 'edited') return board.updatedAt;
  return board.lastOpenedAt;
}

function relativeTime(ts: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = ts - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

const DAY_MS = 86_400_000;

// Calendar buckets, not rolling hours: "Today" means since midnight, which is
// how a tutor thinks about who they've already seen.
function recencyGroup(ts: number, startOfToday: number): string {
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - DAY_MS) return 'Yesterday';
  if (ts >= startOfToday - 6 * DAY_MS) return 'Past week';
  if (ts >= startOfToday - 29 * DAY_MS) return 'Past month';
  return 'Earlier';
}

// A card's date pill has room for "18 Apr"; the year only when it isn't this one.
function absoluteDate(ts: number): string {
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

// The group heading already says which day, so the row says what the heading
// doesn't: the time within today or yesterday, the weekday within the week.
// Letter groups carry no time, so there the row says how long ago.
function stampInGroup(ts: number, group: string): string {
  if (group === 'Today' || group === 'Yesterday') {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (group === 'Past week') {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'long' });
  }
  if (group === 'Past month' || group === 'Earlier') return absoluteDate(ts);
  return relativeTime(ts);
}

const LIVE_GROUP = 'Live now';

function letterGroup(name: string): string {
  const first = name.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(first) ? first : '#';
}

// "Daryna (Ivan)" is a student plus who they come with, and "Leo — IB AA HL"
// a student plus their course. Either tail is data the name field was made to
// carry, so it reads as the card's quieter second line.
function splitName(name: string): { primary: string; secondary: string | null } {
  const match =
    /^(.+?)\s*\(([^()]+)\)\s*$/.exec(name) ?? /^(.+?)\s+[—–]\s+(.+)$/.exec(name);
  return match
    ? { primary: match[1]!, secondary: match[2]!.trim() }
    : { primary: name, secondary: null };
}

// "Amara is on one right now" — who, not how many, because the tutor knows
// these students by name. Past two the count takes over.
function liveClause(names: string[]): string {
  if (names.length === 1) return `${names[0]} is on one right now`;
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are on canvases right now`;
  }
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are on canvases right now`;
}

// The part of a name a search matched, set apart so it is clear why a card is
// still here. Case-insensitive; only the first occurrence is marked.
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[var(--ds-radius-xsmall)] bg-[var(--ds-background-accent-yellow-subtler)] text-inherit">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

// A section heading over its group: the name, then a neutral count badge.
// "Live now" carries the pulsing dot, the one moving thing on the page.
function GroupHeading({ label, count }: { label: string; count: number }) {
  const live = label === LIVE_GROUP;
  return (
    <h2 className="flex items-center gap-2 text-(length:--d-fs-body) leading-5 font-semibold text-[var(--ds-text)]">
      {live ? (
        <span
          aria-hidden="true"
          className="d-pulse size-2 rounded-full bg-[var(--ds-icon-success)] text-[var(--ds-icon-success)]"
        />
      ) : null}
      {label}
      {/* A letter's count is noise; a day's is a headcount. */}
      {label.length === 1 || label === '#' ? null : (
        <span className="rounded-full bg-[var(--ds-background-neutral)] px-1.5 text-(length:--d-fs-caption) leading-4 font-medium tabular-nums">
          {count}
        </span>
      )}
    </h2>
  );
}

// Windows and Linux have no ⌘; showing it there is a hint that doesn't work.
const FIND_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

function absoluteTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function boardHref(id: string): string {
  return `/board/${encodeURIComponent(id)}`;
}

function openBoardLink(event: ReactMouseEvent<HTMLAnchorElement>, id: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  navigate(boardHref(id));
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  );
}

// The top nav's search: a 32px field that grows to 780px, with the shortcut
// hint where the clear button takes over once there is something to clear.
function BoardSearch({
  inputRef,
  value,
  onChange,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <search className="relative min-w-0 max-w-[780px] flex-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--ds-icon-subtle)]"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        placeholder="Search students"
        aria-label="Search canvases"
        aria-keyshortcuts="Meta+K Control+K"
        className="h-8 w-full rounded-[var(--ds-radius-medium)] border border-[var(--ds-border-input)] bg-[var(--ds-background-input)] pr-14 pl-9 text-(length:--d-fs-body) text-[var(--ds-text)] outline-none transition-colors placeholder:text-[var(--ds-text-subtlest)] hover:bg-[var(--ds-background-input-hovered)] focus-visible:border-[var(--ds-border-focused)] focus-visible:bg-[var(--ds-background-input)] focus-visible:ring-1 focus-visible:ring-[var(--ds-border-focused)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className={cn(
            'absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-[var(--ds-radius-small)] text-[var(--ds-icon-subtle)] transition-colors hover:bg-[var(--ds-background-neutral-subtle-hovered)] hover:text-[var(--ds-icon)]',
            FOCUS,
          )}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <Kbd className="absolute top-1/2 right-2 hidden -translate-y-1/2 md:inline-flex">
          {FIND_KEYS}
        </Kbd>
      )}
    </search>
  );
}

const CARD_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4';

export function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<LibraryView>('all');
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [layout, setLayout] = useState<LibraryLayout>(readLayout);
  const [titleDialog, setTitleDialog] = useState<TitleDialogState | null>(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(
    new Set(),
  );
  // Deleted but still undoable: hidden from the list, not yet sent.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(
    new Set(),
  );
  const pendingCommits = useRef(new Set<() => void>());
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const ready = auth?.authenticated === true && boards !== null;

  // A student joining shows on the tab itself, for when this page is behind
  // the board the tutor is teaching on.
  const liveInTitle = boards?.filter((b) => liveIds.has(b.id)).length ?? 0;
  useEffect(() => {
    if (!ready) return;
    const before = document.title;
    document.title = liveInTitle > 0 ? `(${liveInTitle}) Canvases` : 'Canvases';
    return () => {
      document.title = before;
    };
  }, [ready, liveInTitle]);

  const refresh = () => {
    void boardRepository.list().then(setBoards);
  };

  useEffect(() => {
    void getAuth().then(setAuth);
  }, []);

  useEffect(() => {
    if (!auth?.authenticated) return;
    const legacy = takeLegacyFavoriteIds();
    void (async () => {
      const list = await boardRepository.list();
      const known = new Set(list.map((b) => b.id));
      const toPush = legacy.filter((id) => known.has(id));
      for (const id of toPush) await boardRepository.setFavorite(id, true);
      setBoards(toPush.length > 0 ? await boardRepository.list() : list);
    })();
  }, [auth?.authenticated]);

  // An undo window still open when the page goes away is a delete the tutor
  // meant: send it rather than let the canvas come back next visit.
  useEffect(() => {
    const commitAll = () => {
      for (const commit of Array.from(pendingCommits.current)) commit();
    };
    window.addEventListener('pagehide', commitAll);
    return () => {
      window.removeEventListener('pagehide', commitAll);
      commitAll();
    };
  }, []);

  // Who is in a board right now. Polled while the tab is visible; a student
  // joining shows up within one tick, which is soon enough to glance at.
  useEffect(() => {
    if (!auth?.authenticated) return;
    const poll = () => {
      if (document.visibilityState === 'visible') {
        void fetchLiveBoardIds().then(setLiveIds);
      }
    };
    poll();
    const timer = setInterval(poll, 15_000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [auth?.authenticated]);

  // ⌘K finds, C creates — the two things people come to this page to do.
  // Plain C is skipped while typing or while a dialog owns the keyboard.
  // Escape drops a selection, unless it is closing a menu or dialog.
  const dialogOpen = titleDialog !== null;
  const selectionSize = selectedBoardIds.size;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        key === 'escape' &&
        selectionSize > 0 &&
        !dialogOpen &&
        !document.querySelector('[role="menu"]')
      ) {
        setSelectedBoardIds(new Set());
        return;
      }
      if (key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchRef.current?.select();
        return;
      }
      if (
        key === 'c' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !dialogOpen &&
        !isTypingTarget(event.target) &&
        auth?.authenticated
      ) {
        event.preventDefault();
        setTitleDialog({ mode: 'create' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, selectionSize, auth?.authenticated]);

  if (auth && !auth.authenticated) {
    return <Login onSuccess={() => void getAuth().then(setAuth)} />;
  }

  const accountName = auth?.name?.trim() || 'Tutor';
  const signOut = async () => {
    await logout();
    setAuth({ authenticated: false });
  };

  const loading = auth === null || boards === null;
  const allBoards = (boards ?? []).filter((b) => !pendingDeleteIds.has(b.id));
  const favoriteCount = allBoards.filter((b) => b.favorite).length;
  const liveCount = allBoards.filter((b) => liveIds.has(b.id)).length;
  const viewBoards =
    activeView === 'favorites'
      ? allBoards.filter((board) => board.favorite)
      : allBoards;
  const query = searchQuery.trim().toLocaleLowerCase();
  const filteredBoards = viewBoards
    .filter((board) => !query || board.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      return sortTime(b, sortMode) - sortTime(a, sortMode);
    });

  const isFiltered = query.length > 0;
  // Whoever is in a board right now comes first, whatever the sort — that is
  // the student the tutor is about to talk to. The rest is already sorted, so
  // each bucket (a day range, or a first letter by name) is one contiguous run.
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups: { label: string; boards: BoardMeta[] }[] = [];
  const liveBoards = filteredBoards.filter((b) => liveIds.has(b.id));
  if (liveBoards.length > 0) {
    groups.push({ label: LIVE_GROUP, boards: liveBoards });
  }
  for (const board of filteredBoards) {
    if (liveIds.has(board.id)) continue;
    const label =
      sortMode === 'name'
        ? letterGroup(board.name)
        : recencyGroup(sortTime(board, sortMode), startOfToday);
    const last = groups.at(-1);
    if (last && last.label === label && last.label !== LIVE_GROUP) {
      last.boards.push(board);
    } else {
      groups.push({ label, boards: [board] });
    }
  }
  const selecting = selectedBoardIds.size > 0;

  const setFavorites = (ids: string[], favorite: boolean) => {
    const target = new Set(ids);
    setBoards((previous) =>
      previous?.map((b) => (target.has(b.id) ? { ...b, favorite } : b)) ??
      previous,
    );
    void (async () => {
      for (const id of ids) await boardRepository.setFavorite(id, favorite);
    })();
  };

  const toggleFavorite = (board: BoardMeta) => {
    setFavorites([board.id], !board.favorite);
  };

  const toggleSelectBoard = (id: string) => {
    setSelectedBoardIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const favoriteSelected = () => {
    setFavorites(Array.from(selectedBoardIds), true);
    setSelectedBoardIds(new Set());
  };

  // Deleting hides the rows at once and holds the request for the undo
  // window, so a slip costs one click instead of a student's history.
  const remove = (ids: string[], title: string) => {
    const hide = (on: boolean) =>
      setPendingDeleteIds((previous) => {
        const next = new Set(previous);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    hide(true);
    setSelectedBoardIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) next.delete(id);
      return next;
    });

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      pendingCommits.current.delete(commit);
      void (async () => {
        try {
          for (const id of ids) await boardRepository.delete(id);
          // The fresh list goes in before the rows un-hide, or they flash back.
          setBoards(await boardRepository.list());
        } catch {
          toast.add({ title: 'Couldn’t delete. Try again.', type: 'error' });
        } finally {
          hide(false);
        }
      })();
    };
    pendingCommits.current.add(commit);

    const toastId = toast.add({
      title,
      timeout: UNDO_MS,
      onClose: commit,
      actionProps: {
        children: 'Undo',
        onClick: () => {
          if (settled) return;
          settled = true;
          pendingCommits.current.delete(commit);
          hide(false);
          toast.close(toastId);
        },
      },
    });
  };

  const removeSelected = () => {
    const ids = Array.from(selectedBoardIds);
    remove(
      ids,
      ids.length === 1 ? 'Canvas deleted' : `${ids.length} canvases deleted`,
    );
  };

  const commitTitle = async (title: string) => {
    if (!titleDialog) return;
    if (titleDialog.mode === 'create') {
      const board = await boardRepository.create(title);
      setTitleDialog(null);
      navigate(boardHref(board.id));
      return;
    }
    await boardRepository.rename(titleDialog.board.id, title);
    setTitleDialog(null);
    refresh();
  };

  // A `.board` file (exported from a board's ⋯ menu) becomes a new board.
  const importBoardFile = async (file: File) => {
    try {
      const res = await fetch('/api/boards/import', {
        method: 'POST',
        body: file,
        credentials: 'include',
      });
      const body = (await res.json().catch(() => null)) as
        | (BoardMeta & { error?: string })
        | null;
      if (!res.ok || !body) {
        toast.add({ title: body?.error ?? 'Could not import that file' });
        return;
      }
      navigate(boardHref(body.id));
    } catch {
      toast.add({ title: 'Could not import — you appear to be offline' });
    }
  };

  const changeLayout = (next: LibraryLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Private mode: the choice just lasts this visit.
    }
  };

  const visibleIds = filteredBoards.map((b) => b.id);
  const selectedVisible = visibleIds.filter((id) => selectedBoardIds.has(id));
  const toggleSelectAll = () => {
    setSelectedBoardIds(
      selectedVisible.length === visibleIds.length
        ? new Set()
        : new Set(visibleIds),
    );
  };

  const showView = (view: LibraryView) => {
    setActiveView(view);
    setSelectedBoardIds(new Set());
  };

  const boardMenu = (board: BoardMeta, triggerClassName: string) => {
    const selected = selectedBoardIds.has(board.id);
    const favorite = board.favorite === true;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${board.name}`}
              className={triggerClassName}
            >
              <MoreHorizontal />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={() => setTitleDialog({ mode: 'rename', board })}
          >
            <Pencil data-icon="inline-start" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleFavorite(board)}>
            <Star
              data-icon="inline-start"
              className={cn(favorite && 'fill-current')}
            />
            {favorite ? 'Unfavorite' : 'Favorite'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleSelectBoard(board.id)}>
            <SquareCheck data-icon="inline-start" />
            {selected ? 'Deselect' : 'Select'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => remove([board.id], `Deleted “${board.name}”`)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderCard = (board: BoardMeta, group: string) => {
    const selected = selectedBoardIds.has(board.id);
    const favorite = board.favorite === true;
    const live = liveIds.has(board.id);
    const shownAt = sortTime(board, sortMode);
    const { primary, secondary } = splitName(board.name);
    const stamp = stampInGroup(shownAt, group);

    return (
      <li
        key={board.id}
        data-selected={selected || undefined}
        className={cn(
          // Atlassian's raised card: raised surface, 1px border, raised shadow,
          // and a hovered/pressed surface step. Selection swaps in the selected
          // fill and border; it never changes the card's size.
          'group relative flex min-h-[72px] items-center gap-3 rounded-[var(--ds-radius-large)] border px-4 py-3 shadow-[var(--ds-shadow-raised)] transition-colors duration-100',
          selected
            ? 'border-[var(--ds-border-selected)] bg-[var(--ds-background-selected)]'
            : 'border-[var(--ds-border)] bg-[var(--ds-surface-raised)] hover:bg-[var(--ds-surface-raised-hovered)] has-[a:active]:bg-[var(--ds-surface-raised-pressed)]',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-(length:--d-fs-caption) font-semibold text-[var(--ds-text-inverse)]"
          style={{ backgroundColor: markerFor(primary) }}
        >
          {initials(primary, '?')}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <a
            href={boardHref(board.id)}
            onClick={(e) => openBoardLink(e, board.id)}
            title={board.name}
            className="truncate text-(length:--d-fs-body) leading-5 font-semibold text-[var(--ds-text)] outline-none after:absolute after:inset-0 after:rounded-[var(--ds-radius-large)] focus-visible:after:ring-2 focus-visible:after:ring-[var(--ds-border-focused)] focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-[var(--ds-surface)]"
          >
            <Highlight text={primary} query={query} />
          </a>
          <p className="flex min-w-0 items-center gap-1 text-(length:--d-fs-caption) leading-4 text-[var(--ds-text-subtle)]">
            {secondary ? (
              <>
                <span className="truncate">
                  <Highlight text={secondary} query={query} />
                </span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <time
              dateTime={new Date(shownAt).toISOString()}
              title={`Opened ${absoluteTimestamp(board.lastOpenedAt)}, created ${absoluteTimestamp(board.createdAt)}`}
              className="shrink-0 tabular-nums"
            >
              {stamp}
            </time>
          </p>
        </div>

        {/* What the card says at rest: who is on it now, and whether it is kept. */}
        {live && group !== LIVE_GROUP ? (
          <Lozenge tone="success">
            <span aria-hidden="true" className="d-pulse size-1.5 rounded-full bg-current" />
            Live
          </Lozenge>
        ) : null}
        {favorite ? (
          <Star
            aria-hidden="true"
            className="size-4 shrink-0 fill-current text-[var(--d-star)]"
          />
        ) : null}

        {/* Controls cover the right edge only when reached. */}
        <div
          className={cn(
            'absolute top-1/2 right-2 z-10 flex -translate-y-1/2 items-center rounded-[var(--ds-radius-medium)] bg-[var(--ds-surface-overlay)] shadow-[var(--ds-shadow-raised)]',
            !selecting &&
              'opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(any-pointer:coarse)]:opacity-100',
          )}
        >
          <div
            className={cn(
              'flex size-8 items-center justify-center',
              !selecting && 'hidden group-hover:flex [@media(any-pointer:coarse)]:hidden',
            )}
          >
            {/* On touch it takes no taps until selection has started from the
                card menu, so a stray thumb never selects. */}
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleSelectBoard(board.id)}
              aria-label={`Select ${board.name}`}
              className="size-4 rounded-[var(--ds-radius-xsmall)]"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            onClick={() => toggleFavorite(board)}
            className={cn(
              'text-[var(--ds-icon-subtle)] hover:text-[var(--ds-icon)] [@media(any-pointer:coarse)]:hidden',
              favorite && 'text-[var(--d-star)] hover:text-[var(--d-star)]',
            )}
          >
            <Star fill={favorite ? 'currentColor' : 'none'} />
          </Button>
          {boardMenu(board, 'text-[var(--ds-icon-subtle)] hover:text-[var(--ds-icon)]')}
        </div>
      </li>
    );
  };

  // The list is a register: one line per student, every date side by side,
  // for when the tutor is scanning for who hasn't been seen in a while.
  const renderRow = (board: BoardMeta) => {
    const selected = selectedBoardIds.has(board.id);
    const favorite = board.favorite === true;
    const { primary, secondary } = splitName(board.name);
    const dateCell = (ts: number, label: string) => (
      <time
        dateTime={new Date(ts).toISOString()}
        title={`${label} ${absoluteTimestamp(ts)}`}
      >
        {relativeTime(ts)}
      </time>
    );

    return (
      <TableRow
        key={board.id}
        data-state={selected ? 'selected' : undefined}
        className="group relative border-[var(--ds-border)] hover:bg-[var(--ds-background-neutral-subtle-hovered)] data-[state=selected]:bg-[var(--ds-background-selected)]"
      >
        <TableCell className="w-10 pr-0 pl-3">
          <Checkbox
            checked={selected}
            onCheckedChange={() => toggleSelectBoard(board.id)}
            aria-label={`Select ${board.name}`}
            className={cn(
              'relative z-10 size-4 rounded-[var(--ds-radius-xsmall)]',
              !selecting && REVEAL,
            )}
          />
        </TableCell>
        <TableCell className="w-full max-w-0 py-2">
          <a
            href={boardHref(board.id)}
            onClick={(e) => openBoardLink(e, board.id)}
            title={board.name}
            className="flex items-center gap-3 text-(length:--d-fs-body) font-semibold text-[var(--ds-text)] outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-[var(--ds-border-focused)] focus-visible:after:ring-inset"
          >
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-[var(--ds-text-inverse)]"
              style={{ backgroundColor: markerFor(primary) }}
            >
              {initials(primary, '?')}
            </span>
            <span className="truncate">
              <Highlight text={primary} query={query} />
            </span>
          </a>
        </TableCell>
        <TableCell className="hidden max-w-56 truncate sm:table-cell">
          {secondary ?? (
            <span className="text-[var(--ds-text-subtlest)]" aria-hidden="true">
              –
            </span>
          )}
        </TableCell>
        <TableCell className="tabular-nums">
          {dateCell(board.lastOpenedAt, 'Opened')}
        </TableCell>
        <TableCell className="hidden tabular-nums md:table-cell">
          {dateCell(board.updatedAt, 'Edited')}
        </TableCell>
        <TableCell className="hidden tabular-nums lg:table-cell">
          <time
            dateTime={new Date(board.createdAt).toISOString()}
            title={`Created ${absoluteTimestamp(board.createdAt)}`}
          >
            {absoluteDate(board.createdAt)}
          </time>
        </TableCell>
        <TableCell className="w-px pr-2 pl-0">
          <div className="relative z-10 flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={favorite}
              onClick={() => toggleFavorite(board)}
              className={cn(
                favorite
                  ? 'text-[var(--d-star)] hover:text-[var(--d-star)]'
                  : cn(REVEAL, 'text-[var(--ds-icon-subtle)] hover:text-[var(--ds-icon)]'),
              )}
            >
              <Star fill={favorite ? 'currentColor' : 'none'} />
            </Button>
            {boardMenu(
              board,
              cn('text-[var(--ds-icon-subtle)] hover:text-[var(--ds-icon)]', REVEAL),
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Clicking a column heading sorts by it. Dates run newest first and names
  // A to Z, so one arrow pointing down reads right for every column.
  const sortHead = (mode: SortMode, label: string, className?: string) => {
    const active = sortMode === mode;
    return (
      <TableHead
        aria-sort={
          active ? (mode === 'name' ? 'ascending' : 'descending') : undefined
        }
        className={cn('h-10 px-2', className)}
      >
        <button
          type="button"
          onClick={() => setSortMode(mode)}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-[var(--ds-radius-small)] px-1 transition-colors hover:bg-[var(--ds-background-neutral-subtle-hovered)] hover:text-[var(--ds-text)]',
            FOCUS,
            active && 'text-[var(--ds-text)]',
          )}
        >
          {label}
          <ArrowDown
            aria-hidden="true"
            className={cn('size-3.5', !active && 'opacity-0')}
          />
        </button>
      </TableHead>
    );
  };

  const COLUMN_COUNT = 7;
  const listView = (
    // Atlassian's dynamic table: a 2px rule under 12px semibold subtle heads,
    // a 1px rule between rows, and a hovered fill on the row under the pointer.
    <Table className="[&_td]:text-(length:--d-fs-body) [&_td]:text-[var(--ds-text)]">
      <TableHeader className="bg-transparent [&_th]:text-(length:--d-fs-caption) [&_th]:font-semibold [&_th]:text-[var(--ds-text-subtle)] [&_tr]:border-b-2 [&_tr]:border-[var(--ds-border)]">
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10 pr-0 pl-3">
            <Checkbox
              checked={
                visibleIds.length > 0 &&
                selectedVisible.length === visibleIds.length
              }
              indeterminate={
                selectedVisible.length > 0 &&
                selectedVisible.length < visibleIds.length
              }
              onCheckedChange={toggleSelectAll}
              aria-label="Select all canvases"
              className="size-4 rounded-[var(--ds-radius-xsmall)]"
            />
          </TableHead>
          {sortHead('name', 'Student')}
          <TableHead className="hidden h-10 sm:table-cell">Details</TableHead>
          {sortHead('activity', 'Last opened')}
          {sortHead('edited', 'Last edited', 'hidden md:table-cell')}
          {sortHead('created', 'Created', 'hidden lg:table-cell')}
          <TableHead className="w-px">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {groups.map((group) => (
        // One tbody per group: its heading row names the rows beneath it.
        <TableBody key={group.label}>
          <TableRow className="border-0 hover:bg-transparent">
            <th
              scope="rowgroup"
              colSpan={COLUMN_COUNT}
              className="pt-6 pr-4 pb-2 pl-3 text-left"
            >
              <GroupHeading label={group.label} count={group.boards.length} />
            </th>
          </TableRow>
          {group.boards.map(renderRow)}
        </TableBody>
      ))}
    </Table>
  );

  const emptyState = isFiltered
    ? {
        header: `No canvases match “${searchQuery.trim()}”`,
        body: 'Check the spelling, or try another name.',
        action: (
          <Button
            variant="subtle"
            className={NEUTRAL_BUTTON}
            onClick={() => {
              setSearchQuery('');
              searchRef.current?.focus();
            }}
          >
            Clear search
          </Button>
        ),
      }
    : activeView === 'favorites'
      ? {
          header: 'No favorites yet',
          body: 'Star a canvas to keep it close.',
          action: (
            <Button
              variant="subtle"
              className={NEUTRAL_BUTTON}
              onClick={() => showView('all')}
            >
              Browse canvases
            </Button>
          ),
        }
      : {
          header: 'Create your first canvas',
          body: 'Canvases you create appear here, ready to share with a student.',
          action: (
            <Button onClick={() => setTitleDialog({ mode: 'create' })}>
              <Plus data-icon="inline-start" />
              New canvas
            </Button>
          ),
        };

  const plural = (n: number, one: string, many: string) =>
    `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const liveNames = allBoards
    .filter((b) => liveIds.has(b.id))
    .map((b) => splitName(b.name).primary);
  const summary = loading
    ? ' '
    : isFiltered
      ? `${filteredBoards.length.toLocaleString()} of ${viewBoards.length.toLocaleString()} match`
    : activeView === 'favorites'
      ? plural(favoriteCount, 'canvas', 'canvases')
      : liveNames.length > 0
        ? `${plural(allBoards.length, 'canvas', 'canvases')}, and ${liveClause(liveNames)}`
        : plural(allBoards.length, 'canvas', 'canvases');

  const selectionBar = selecting ? (
    <div
      role="toolbar"
      aria-label="Selected canvases"
      className="flex items-center gap-2 rounded-[var(--ds-radius-large)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] p-2 shadow-[var(--ds-shadow-overlay)]"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Clear selection"
        onClick={() => setSelectedBoardIds(new Set())}
        className="text-[var(--ds-icon-subtle)] hover:text-[var(--ds-icon)]"
      >
        <X />
      </Button>
      <span className="mr-auto pr-2 text-(length:--d-fs-body) font-medium tabular-nums">
        {selectedBoardIds.size} selected
      </span>
      <Button variant="subtle" className={NEUTRAL_BUTTON} onClick={favoriteSelected}>
        <Star data-icon="inline-start" />
        Favorite
      </Button>
      <Button
        onClick={removeSelected}
        className="border-transparent bg-[var(--ds-background-danger-bold)] text-[var(--ds-text-inverse)] hover:border-transparent hover:bg-[var(--ds-background-danger-bold-hovered)] active:bg-[var(--ds-background-danger-bold-pressed)]"
      >
        <Trash2 data-icon="inline-start" />
        Delete
      </Button>
    </div>
  ) : null;

  const account = auth ? (
    <AccountMenu name={accountName} onLogout={signOut} />
  ) : null;

  return (
    <DashboardShell
      mainId="board-library"
      busy={loading}
      account={account}
      topNavMiddle={
        <>
          <BoardSearch
            inputRef={searchRef}
            value={searchQuery}
            onChange={setSearchQuery}
          />
          <Button
            onClick={() => setTitleDialog({ mode: 'create' })}
            aria-label="New canvas"
            aria-keyshortcuts="C"
            title="New canvas (C)"
            className="shrink-0 px-3 max-sm:w-8 max-sm:px-0"
          >
            <Plus data-icon="inline-start" className="max-sm:m-0" />
            <span className="max-sm:hidden">New canvas</span>
          </Button>
        </>
      }
      nav={
        <>
          <NavItem
            icon={<Library />}
            label="Canvases"
            live={liveCount}
            active={activeView === 'all'}
            onClick={() => showView('all')}
          />
          <NavItem
            icon={<Star />}
            label="Favorites"
            count={loading ? undefined : favoriteCount}
            active={activeView === 'favorites'}
            onClick={() => showView('favorites')}
          />
          <NavItem
            icon={<BarChart2 />}
            label="Attendance"
            onClick={() => navigate('/analytics')}
          />
        </>
      }
    >
      <a
        href="#canvas-list"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-[var(--ds-radius-medium)] focus:bg-[var(--ds-background-neutral-bold)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--ds-text-inverse)]"
      >
        Skip to canvases
      </a>

      <input
        ref={importRef}
        type="file"
        accept=".board"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importBoardFile(file);
        }}
      />

      <PageTitle
        breadcrumbs={['Library']}
        title={activeView === 'favorites' ? 'Favorites' : 'Canvases'}
        detail={summary}
        actions={
          <Button
            variant="subtle"
            onClick={() => importRef.current?.click()}
            className={NEUTRAL_BUTTON}
          >
            <Upload data-icon="inline-start" />
            Import
          </Button>
        }
      />

      {/* Tabs on the left, view controls on the right, one rule beneath. */}
      <div className="mx-6 mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[var(--ds-border)] md:mx-10">
        <div role="tablist" aria-label="Library" className="flex gap-1">
          {(
            [
              ['all', 'All canvases', undefined],
              ['favorites', 'Favorites', favoriteCount],
            ] as const
          ).map(([view, label, count]) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`tab-${view}`}
              aria-selected={activeView === view}
              aria-controls="canvas-list"
              onClick={() => showView(view)}
              className={cn(
                '-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-(length:--d-fs-body) font-medium transition-colors',
                FOCUS,
                activeView === view
                  ? 'border-[var(--ds-border-selected)] text-[var(--ds-text-selected)]'
                  : 'border-transparent text-[var(--ds-text-subtle)] hover:border-[var(--ds-border-bold)] hover:text-[var(--ds-text)]',
              )}
            >
              {label}
              {count && !loading ? (
                <span className="rounded-full bg-[var(--ds-background-neutral)] px-1.5 text-(length:--d-fs-caption) leading-4 font-medium tabular-nums text-[var(--ds-text)]">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 pb-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="subtle"
                  aria-label={`Sort by ${SORT_LABELS[sortMode].toLowerCase()}`}
                  className={cn(NEUTRAL_BUTTON, 'gap-1 pr-2')}
                >
                  <span className="font-normal text-[var(--ds-text-subtle)]">
                    Sort
                  </span>
                  {SORT_LABELS[sortMode]}
                  <ChevronDown data-icon="inline-end" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <DropdownMenuItem key={mode} onClick={() => setSortMode(mode)}>
                  {SORT_LABELS[mode]}
                  {sortMode === mode ? (
                    <Check className="ml-auto size-4 text-[var(--ds-icon-selected)]" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div
            role="group"
            aria-label="Layout"
            className="hidden items-center gap-px rounded-[var(--ds-radius-medium)] bg-[var(--ds-background-neutral)] p-px sm:flex"
          >
            {(
              [
                ['grid', 'Grid', LayoutGrid],
                ['list', 'List', List],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={layout === value}
                aria-label={`${label} view`}
                onClick={() => changeLayout(value)}
                className={cn(
                  'flex size-[30px] items-center justify-center rounded-[calc(var(--ds-radius-medium)-1px)] transition-colors',
                  FOCUS,
                  layout === value
                    ? 'bg-[var(--ds-background-selected-bold)] text-[var(--ds-text-inverse)] hover:bg-[var(--ds-background-selected-bold-hovered)]'
                    : 'text-[var(--ds-icon)] hover:bg-[var(--ds-background-neutral-hovered)]',
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        id="canvas-list"
        role="tabpanel"
        aria-labelledby={`tab-${activeView}`}
        className="flex w-full flex-1 flex-col px-6 pt-6 pb-20 md:px-10"
      >
        <section aria-label="Canvases" className="flex-1">
          {loading ? (
            <ul className={CARD_GRID}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li
                  key={i}
                  className="flex min-h-[72px] items-center gap-3 rounded-[var(--ds-radius-large)] border border-[var(--ds-border)] bg-[var(--ds-surface-raised)] px-4 py-3 shadow-[var(--ds-shadow-raised)]"
                >
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-2/3 rounded-[var(--ds-radius-small)]" />
                    <Skeleton className="h-3 w-1/3 rounded-[var(--ds-radius-small)]" />
                  </div>
                </li>
              ))}
            </ul>
          ) : filteredBoards.length === 0 ? (
            <div className="mx-auto flex max-w-sm flex-col items-center gap-2 py-16 text-center">
              <h2 className="text-xl leading-6 font-bold text-balance text-[var(--ds-text)]">
                {emptyState.header}
              </h2>
              <p className="text-(length:--d-fs-body) text-pretty text-[var(--ds-text-subtle)]">
                {emptyState.body}
              </p>
              <div className="mt-4 flex gap-2">{emptyState.action}</div>
            </div>
          ) : layout === 'list' ? (
            listView
          ) : (
            <div className="flex flex-col gap-8">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <div className="mb-3">
                    <GroupHeading
                      label={group.label}
                      count={group.boards.length}
                    />
                  </div>
                  <ul className={CARD_GRID}>
                    {group.boards.map((board) => renderCard(board, group.label))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>

        {selectionBar ? (
          <div className="sticky bottom-6 z-20 mx-auto mt-10 w-full max-w-md">
            {selectionBar}
          </div>
        ) : null}
      </div>

      <BoardTitleDialog
        open={titleDialog !== null}
        heading={titleDialog?.mode === 'rename' ? 'Rename canvas' : 'New canvas'}
        initialValue={
          titleDialog?.mode === 'rename' ? titleDialog.board.name : ''
        }
        submitLabel={titleDialog?.mode === 'rename' ? 'Save' : 'Create'}
        onOpenChange={(open) => {
          if (!open) setTitleDialog(null);
        }}
        onSubmit={commitTitle}
      />

      <Toaster />
    </DashboardShell>
  );
}
