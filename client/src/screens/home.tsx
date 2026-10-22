import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpDown,
  BarChart2,
  Check,
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
import { BrandMark } from '@/components/brand-mark';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toaster, toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import {
  AccountMenu,
  DashboardShell,
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

// The tutor's first name, in the tutor's own hand, with the right word for the
// hour. "Tutor" is the signed-out fallback, not a name, so it greets bare.
function greeting(name: string, hour: number): string {
  const part =
    hour < 5
      ? 'Burning the midnight oil'
      : hour < 12
        ? 'Good morning'
        : hour < 18
          ? 'Good afternoon'
          : 'Good evening';
  const first = name === 'Tutor' ? '' : name.split(/\s+/)[0]!;
  return first ? `${part}, ${first}` : part;
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

// The part of a name a search matched, set apart so it is clear why a tile is
// still here. Case-insensitive; only the first occurrence is marked.
function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLocaleLowerCase().indexOf(query) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-[color-mix(in_srgb,var(--d-blue)_20%,transparent)] text-inherit">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
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
    <search className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
      <Search
        className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[var(--d-pencil)]"
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
        placeholder="Find a student"
        aria-label="Search canvases"
        aria-keyshortcuts="Meta+K Control+K"
        className="h-11 w-full rounded-full bg-[var(--d-well)] pr-12 pl-11 text-[14px] text-[var(--d-ink)] ring-1 ring-transparent outline-none transition-[box-shadow,background-color] duration-150 placeholder:text-[var(--d-pencil)] hover:ring-[var(--d-rule)] focus-visible:bg-[var(--d-sheet)] focus-visible:ring-2 focus-visible:ring-[var(--d-blue)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--d-pencil)] transition-colors hover:bg-[var(--d-hover)] hover:text-[var(--d-ink)]"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <Kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 bg-[var(--d-sheet)] md:inline-flex">
          {FIND_KEYS}
        </Kbd>
      )}
    </search>
  );
}

const CARD_GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3';

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
  // True until the first library has been on screen long enough to have
  // settled in; only then do tiles stop carrying the entrance animation.
  const intro = useRef(true);
  const [hour] = useState(() => new Date().getHours());
  const ready = auth?.authenticated === true && boards !== null;

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      intro.current = false;
    }, 1200);
    return () => clearTimeout(timer);
  }, [ready]);

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

  const renderCard = (board: BoardMeta, group: string, index: number) => {
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
        style={{ '--i': index } as React.CSSProperties}
        className={cn(
          // No outline at rest: a soft fill is enough to read as a tile, and a
          // grid of hairline boxes is the noisiest thing a list can be. --tile
          // is the fill, so the floating controls can sit on the same colour.
          // Pressing the tile (not its star or menu) sinks it a hair.
          'group relative flex items-center rounded-[14px] bg-[var(--tile)] px-4 py-3.5 transition-[box-shadow,background-color,transform] duration-200 has-[a:active]:scale-[0.985]',
          intro.current && 'd-rise',
          selected
            ? '[--tile:var(--d-blue-wash)] ring-2 ring-[var(--d-blue)]'
            : live
              ? '[--tile:var(--d-live-wash)] hover:ring-1 hover:ring-[color-mix(in_srgb,var(--d-live)_35%,transparent)]'
              : '[--tile:var(--d-well)] hover:shadow-[var(--d-lift)] hover:ring-1 hover:ring-[var(--d-rule)] hover:[--tile:var(--d-sheet)]',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <a
            href={boardHref(board.id)}
            onClick={(e) => openBoardLink(e, board.id)}
            title={board.name}
            className="flex items-center gap-2 truncate text-[14.5px] leading-5 font-semibold text-[var(--d-ink)] outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:ring-2 focus-visible:after:ring-[var(--d-blue)] focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-[var(--d-sheet)]"
          >
            <span className="truncate">
              <Highlight text={primary} query={query} />
            </span>
          </a>
          <div className="mt-0.5 flex items-baseline gap-2 text-[13px] leading-5">
            {secondary ? (
              <span className="truncate text-[var(--d-graphite)]">
                <Highlight text={secondary} query={query} />
              </span>
            ) : null}
            <time
              dateTime={new Date(shownAt).toISOString()}
              title={`Opened ${absoluteTimestamp(board.lastOpenedAt)}, created ${absoluteTimestamp(board.createdAt)}`}
              className={cn(
                'ml-auto shrink-0 tabular-nums',
                live
                  ? 'inline-flex items-center gap-1 font-semibold text-[var(--d-live)]'
                  : 'text-[var(--d-pencil)]',
              )}
            >
              {live ? (
                <>
                  Join
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </>
              ) : (
                stamp
              )}
            </time>
          </div>
        </div>

        {/* Controls float over the card's right edge only when reached, so
            the resting tile is just the mark, the name and the time. */}
        <div
          className={cn(
            'absolute top-2 right-2 z-10 flex items-center rounded-full',
            (selecting || favorite) && 'bg-[var(--tile)]',
            'group-hover:bg-[var(--d-sheet)] group-hover:shadow-[var(--d-lift)] has-[[aria-expanded=true]]:bg-[var(--d-sheet)]',
          )}
        >
          <div
            className={cn(
              'flex size-7 items-center justify-center',
              !selecting && 'hidden group-hover:flex [@media(any-pointer:coarse)]:hidden',
            )}
          >
            {/* On touch it takes no taps until selection has started from the
                card menu, so a stray thumb never selects. */}
            <Checkbox
              checked={selected}
              onCheckedChange={() => toggleSelectBoard(board.id)}
              aria-label={`Select ${board.name}`}
              className="size-4 rounded-[5px]"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={favorite}
            onClick={() => toggleFavorite(board)}
            className={cn(
              'size-7 rounded-full',
              favorite
                ? 'text-[var(--d-star)]'
                : cn(
                    REVEAL,
                    'text-[var(--d-pencil)] hover:text-[var(--d-ink)] [@media(any-pointer:coarse)]:hidden',
                  ),
            )}
          >
            <Star
                fill={favorite ? 'currentColor' : 'none'}
                // Starring overshoots and settles; unstarring just relaxes.
                // A transition, not a keyframe, so it never replays on mount.
                className={cn(
                  'transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                  favorite ? 'scale-100' : 'scale-[0.85]',
                )}
              />
          </Button>
          {boardMenu(
            board,
            cn(
              'size-7 rounded-full text-[var(--d-pencil)] hover:text-[var(--d-ink)]',
              REVEAL,
            ),
          )}
        </div>
      </li>
    );
  };

  // The list is a register: one line per student, every date side by side,
  // for when the tutor is scanning for who hasn't been seen in a while.
  const renderRow = (board: BoardMeta) => {
    const selected = selectedBoardIds.has(board.id);
    const favorite = board.favorite === true;
    const live = liveIds.has(board.id);
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
        className="group relative border-[var(--d-rule-soft)] hover:bg-[var(--d-hover)] data-[state=selected]:bg-[var(--d-blue-wash)]"
      >
        <TableCell className="w-10 pr-0 pl-3">
          <Checkbox
            checked={selected}
            onCheckedChange={() => toggleSelectBoard(board.id)}
            aria-label={`Select ${board.name}`}
            className={cn(
              'relative z-10 size-4 rounded-[5px]',
              !selecting && REVEAL,
            )}
          />
        </TableCell>
        <TableCell className="w-full max-w-0 py-3">
          <a
            href={boardHref(board.id)}
            onClick={(e) => openBoardLink(e, board.id)}
            title={board.name}
            className="flex items-center gap-2.5 text-(length:--d-fs-body) font-semibold text-[var(--d-ink)] outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-[var(--d-blue)] focus-visible:after:ring-inset"
          >
            {live ? (
              <span
                aria-hidden="true"
                className="d-pulse size-2 shrink-0 rounded-full bg-[var(--d-live)] text-[var(--d-live)]"
              />
            ) : null}
            <span className="truncate">
              <Highlight text={primary} query={query} />
            </span>
          </a>
        </TableCell>
        <TableCell className="hidden max-w-56 truncate sm:table-cell">
          {secondary ?? (
            <span className="text-[var(--d-pencil)]" aria-hidden="true">
              –
            </span>
          )}
        </TableCell>
        <TableCell className="tabular-nums">
          {live ? (
            <span className="font-semibold text-[var(--d-live)]">Join</span>
          ) : (
            dateCell(board.lastOpenedAt, 'Opened')
          )}
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
                'size-7 rounded-full',
                favorite
                  ? 'text-[var(--d-star)]'
                  : cn(REVEAL, 'text-[var(--d-pencil)] hover:text-[var(--d-ink)]'),
              )}
            >
              <Star
                fill={favorite ? 'currentColor' : 'none'}
                // Starring overshoots and settles; unstarring just relaxes.
                // A transition, not a keyframe, so it never replays on mount.
                className={cn(
                  'transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                  favorite ? 'scale-100' : 'scale-[0.85]',
                )}
              />
            </Button>
            {boardMenu(
              board,
              cn(
                'size-7 rounded-full text-[var(--d-pencil)] hover:text-[var(--d-ink)]',
                REVEAL,
              ),
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
            'inline-flex h-7 items-center gap-1 rounded-full px-2 transition-colors hover:bg-[var(--d-hover)] hover:text-[var(--d-ink)] focus-visible:ring-2 focus-visible:ring-[var(--d-blue)] focus-visible:outline-none',
            active && 'text-[var(--d-ink)]',
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
    // The primitive's cells carry the board's own type and colour; on this page
    // they take the dashboard's, which needs the descendant selectors to win.
    <Table className="[&_td]:text-(length:--d-fs-meta) [&_td]:text-[var(--d-graphite)]">
      <TableHeader className="border-[var(--d-rule)] bg-transparent [&_th]:text-[var(--d-pencil)] [&_tr]:border-[var(--d-rule)]">
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
              className="size-4 rounded-[5px]"
            />
          </TableHead>
          {sortHead('name', 'Student')}
          <TableHead className="hidden h-10 sm:table-cell">
            Details
          </TableHead>
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
              className={cn(
                'pt-7 pr-4 pb-2 pl-3 text-left text-(length:--d-fs-meta) font-medium',
                group.label === LIVE_GROUP
                  ? 'font-semibold text-[var(--d-live)]'
                  : 'text-[var(--d-graphite)]',
              )}
            >
              <span className="flex items-center gap-2">
                {group.label === LIVE_GROUP ? (
                  <span
                    aria-hidden="true"
                    className="d-pulse size-2 rounded-full bg-current"
                  />
                ) : null}
                {group.label}
                {sortMode === 'name' && group.label !== LIVE_GROUP ? null : (
                  <span className="font-normal tabular-nums text-[var(--d-pencil)]">
                    {group.boards.length}
                  </span>
                )}
              </span>
            </th>
          </TableRow>
          {group.boards.map(renderRow)}
        </TableBody>
      ))}
    </Table>
  );

  const outlineButton =
    'h-11 rounded-full border-0 bg-[var(--d-sheet)] px-5 text-[14px] font-medium text-[var(--d-ink)] ring-1 ring-[var(--d-rule)] hover:bg-[var(--d-hover)]';

  const emptyState = isFiltered
    ? {
        line: `No one called “${searchQuery.trim()}”`,
        action: (
          <Button
            variant="outline"
            className={outlineButton}
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
          line: 'Star a canvas to keep it here',
          action: (
            <Button
              variant="outline"
              className={outlineButton}
              onClick={() => showView('all')}
            >
              Browse canvases
            </Button>
          ),
        }
      : {
          line: 'Your first student starts here',
          action: (
            <Button
              className="h-11 rounded-full bg-[var(--d-ink)] px-5 text-[14px] font-medium text-[var(--d-sheet)] hover:bg-[color-mix(in_srgb,var(--d-ink)_86%,var(--d-sheet))]"
              onClick={() => setTitleDialog({ mode: 'create' })}
            >
              <Plus data-icon="inline-start" className="size-4" />
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
    ? ' '
    : isFiltered
      ? `${filteredBoards.length.toLocaleString()} of ${viewBoards.length.toLocaleString()} match`
    : activeView === 'favorites'
      ? `${plural(favoriteCount, 'canvas', 'canvases')} you keep close`
      : liveNames.length > 0
        ? `${plural(allBoards.length, 'canvas', 'canvases')}, and ${liveClause(liveNames)}`
        : plural(allBoards.length, 'canvas', 'canvases');

  const selectionBar = selecting ? (
    <div
      role="toolbar"
      aria-label="Selected canvases"
      className="flex items-center gap-1 rounded-full bg-[var(--d-ink)] p-1.5 pl-2 text-[14px] text-[var(--d-sheet)] shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]"
    >
      <button
        type="button"
        aria-label="Clear selection"
        onClick={() => setSelectedBoardIds(new Set())}
        className="flex size-8 items-center justify-center rounded-full opacity-70 transition hover:bg-[color-mix(in_srgb,var(--d-sheet)_14%,transparent)] hover:opacity-100"
      >
        <X className="size-4" />
      </button>
      <span className="mr-auto pr-4 pl-1 tabular-nums">
        {selectedBoardIds.size} selected
      </span>
      <button
        type="button"
        onClick={favoriteSelected}
        className="flex h-8 items-center gap-2 rounded-full px-3.5 font-medium transition hover:bg-[color-mix(in_srgb,var(--d-sheet)_14%,transparent)]"
      >
        <Star className="size-4" />
        Favorite
      </button>
      <button
        type="button"
        onClick={removeSelected}
        className="flex h-8 items-center gap-2 rounded-full bg-[var(--d-danger)] px-3.5 font-medium text-white transition hover:brightness-110"
      >
        <Trash2 className="size-4" />
        Delete
      </button>
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
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-full focus:bg-[var(--d-ink)] focus:px-4 focus:py-2 focus:text-sm focus:text-[var(--d-sheet)]"
      >
        Skip to canvases
      </a>

      {/* The rail's job on a phone: brand and account, above the title. */}
      <div className="flex items-center justify-between px-5 pt-4 md:hidden">
        <BrandMark className="size-7 rounded-lg" />
        {auth ? (
          <AccountMenu name={accountName} onLogout={signOut} compact />
        ) : null}
      </div>

      <PageTitle
        title={activeView === 'favorites' ? 'Favorites' : 'Canvases'}
        eyebrow={auth ? greeting(accountName, hour) : undefined}
        detail={summary}
        actions={
          <div className="flex w-full items-center gap-2 xl:w-auto">
            <BoardSearch
              inputRef={searchRef}
              value={searchQuery}
              onChange={setSearchQuery}
            />
            <ToggleGroup
              aria-label="Layout"
              value={[layout]}
              onValueChange={(values) =>
                values[0] && changeLayout(values[0] as LibraryLayout)
              }
              className="hidden h-11 shrink-0 rounded-full bg-[var(--d-well)] p-1 sm:flex [&>span]:rounded-full [&>span]:bg-[var(--d-sheet)]"
            >
              {(
                [
                  ['grid', 'Grid', LayoutGrid],
                  ['list', 'List', List],
                ] as const
              ).map(([value, label, Icon]) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  aria-label={`${label} view`}
                  className="h-9 w-10 rounded-full text-[var(--d-pencil)] aria-pressed:text-[var(--d-ink)]"
                >
                  <Icon className="size-4" />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    aria-label={`Sort by ${SORT_LABELS[sortMode].toLowerCase()}`}
                    className="h-11 shrink-0 gap-2 rounded-full px-4 text-[14px] font-normal text-[var(--d-graphite)] hover:bg-[var(--d-hover)] hover:text-[var(--d-ink)] aria-expanded:bg-[var(--d-press)]"
                  >
                    <ArrowUpDown className="size-4" />
                    <span className="hidden xl:inline">
                      {SORT_LABELS[sortMode]}
                    </span>
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                  <DropdownMenuItem key={mode} onClick={() => setSortMode(mode)}>
                    {SORT_LABELS[mode]}
                    {sortMode === mode ? (
                      <Check className="ml-auto size-4 text-[var(--d-blue)]" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <Button
              variant="ghost"
              aria-label="Import board file"
              onClick={() => importRef.current?.click()}
              className="h-11 shrink-0 gap-2 rounded-full px-4 text-[14px] font-normal text-[var(--d-graphite)] hover:bg-[var(--d-hover)] hover:text-[var(--d-ink)]"
            >
              <Upload className="size-4" />
              <span className="hidden xl:inline">Import</span>
            </Button>
            <Button
              onClick={() => setTitleDialog({ mode: 'create' })}
              aria-label="New canvas"
              className="h-11 shrink-0 gap-2 rounded-full bg-[var(--d-ink)] px-4 text-[14px] font-medium text-[var(--d-sheet)] hover:bg-[color-mix(in_srgb,var(--d-ink)_86%,var(--d-sheet))] sm:pr-3 sm:pl-5"
            >
              <Plus className="size-4 sm:hidden" />
              <span className="hidden sm:inline">New canvas</span>
              <Kbd className="hidden rounded-full bg-[color-mix(in_srgb,var(--d-sheet)_16%,transparent)] px-2 text-[var(--d-sheet)] md:inline-flex">
                C
              </Kbd>
            </Button>
          </div>
        }
      />

      <div
        id="canvas-list"
        className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col px-5 pt-8 pb-20 md:px-12 md:pt-12"
      >
        {/* Library switch for widths without the rail. */}
        <div
          role="group"
          aria-label="Library"
          className="mb-8 flex w-fit items-center gap-1 rounded-full bg-[var(--d-tray)] p-1 md:hidden"
        >
          {(
            [
              ['all', 'All'],
              ['favorites', 'Favorites'],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              aria-pressed={activeView === view}
              onClick={() => showView(view)}
              className={cn(
                'flex h-8 items-center rounded-full px-4 text-[14px] font-medium transition-colors',
                activeView === view
                  ? 'bg-[var(--d-sheet)] text-[var(--d-ink)]'
                  : 'text-[var(--d-graphite)] hover:text-[var(--d-ink)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <section aria-label="Canvases" className="flex-1">
          {loading ? (
            <ul className={CARD_GRID}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li
                  key={i}
                  className="flex items-center rounded-[14px] bg-[var(--d-well)] px-4 py-4"
                >
                  <div className="flex flex-1 flex-col gap-2.5">
                    <Skeleton className="h-3.5 w-2/3 rounded-full" />
                    <Skeleton className="h-3 w-1/3 rounded-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : filteredBoards.length === 0 ? (
            <div className="d-dots flex min-h-72 flex-col items-center justify-center gap-5 rounded-[24px] px-6 py-12 text-center">
              <p className="d-hand max-w-md text-[40px] leading-[1.05] font-semibold text-balance text-[var(--d-graphite)]">
                {emptyState.line}
              </p>
              {emptyState.action}
            </div>
          ) : layout === 'list' ? (
            listView
          ) : (
            <div className="flex flex-col gap-10">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h2
                    className={cn(
                      'mb-3.5 flex items-center gap-2 px-1 text-[13px] font-medium',
                      group.label === LIVE_GROUP
                        ? 'font-semibold text-[var(--d-live)]'
                        : 'text-[var(--d-graphite)]',
                    )}
                  >
                    {group.label === LIVE_GROUP ? (
                      <span
                        aria-hidden="true"
                        className="d-pulse size-2 rounded-full bg-current"
                      />
                    ) : null}
                    {group.label}
                    {/* A letter's count is noise; a day's is a headcount. */}
                    {sortMode === 'name' && group.label !== LIVE_GROUP ? null : (
                      <span className="font-normal tabular-nums text-[var(--d-pencil)]">
                        {group.boards.length}
                      </span>
                    )}
                  </h2>
                  <ul className={CARD_GRID}>
                    {group.boards.map((board, i) =>
                      renderCard(board, group.label, i),
                    )}
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
