import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ExternalLink,
  Library,
  LogOut,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BrandMark } from '@/components/brand-mark';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import { useThemeStore } from '@/use-theme-store';
import { Login } from './login';

type TitleDialogState =
  { mode: 'create' } | { mode: 'rename'; board: BoardMeta };

type LibraryView = 'all' | 'favorites';
type SortMode = 'activity' | 'created' | 'name';

const FAVORITES_KEY = 'whiteboard:favorite-board-ids';

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const SORT_DETAILS: Record<SortMode, string> = {
  activity: 'Last opened',
  created: 'Date created',
  name: 'Board name',
};

function loadFavoriteIds(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(
      Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

function relativeTime(ts: number): string {
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = ts - Date.now();
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

function absoluteDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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
    <search
      className="relative block w-full max-w-md"
      aria-label="Search canvases"
    >
      <div className="relative flex h-9 w-full items-center rounded-lg border border-control-border bg-surface px-3 transition-colors hover:border-fg-muted focus-within:border-action">
        <Search
          className="mr-2.5 size-3.5 shrink-0 text-fg-muted"
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
          placeholder="Search canvases…"
          aria-label="Search canvases"
          aria-keyshortcuts="Meta+K Control+K"
          className="w-full flex-1 border-none bg-transparent text-sm font-normal text-fg shadow-none outline-none placeholder:text-fg-subtle focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            className="ml-1 flex size-5 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-panel hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <KbdGroup className="ml-1 hidden select-none opacity-60 sm:inline-flex">
            <Kbd className="text-2xs">⌘K</Kbd>
          </KbdGroup>
        )}
      </div>
    </search>
  );
}

export function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<LibraryView>('all');
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [titleDialog, setTitleDialog] = useState<TitleDialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    BoardMeta | 'selected' | null
  >(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(
    new Set(),
  );
  const [favoriteIds, setFavoriteIds] = useState(loadFavoriteIds);
  const searchRef = useRef<HTMLInputElement>(null);
  const { theme, toggle: toggleTheme } = useThemeStore();

  const refresh = () => {
    void boardRepository.list().then(setBoards);
  };

  useEffect(() => {
    void getAuth().then(setAuth);
  }, []);

  useEffect(() => {
    if (auth?.authenticated) refresh();
  }, [auth?.authenticated]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (auth === null) {
    return (
      <div className="mx-auto flex h-dvh w-full max-w-6xl flex-col gap-6 bg-canvas p-8 font-sans">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <div className="flex flex-col overflow-hidden rounded-xl border border-border">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border p-4 last:border-b-0"
            >
              <Skeleton className="size-5 rounded-md" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-48 rounded-md" />
                <Skeleton className="h-3 w-32 rounded-md" />
              </div>
              <Skeleton className="h-4 w-24 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return <Login onSuccess={() => void getAuth().then(setAuth)} />;
  }

  const accountName = auth.name?.trim() || 'Tutor Account';
  const accountInitials = accountName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  const loading = boards === null;
  const allBoards = boards ?? [];
  const favoriteCount = allBoards.filter((b) => favoriteIds.has(b.id)).length;
  const viewBoards =
    activeView === 'favorites'
      ? allBoards.filter((board) => favoriteIds.has(board.id))
      : allBoards;
  const query = searchQuery.trim().toLocaleLowerCase();
  const filteredBoards = viewBoards
    .filter((board) => !query || board.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'created') return b.createdAt - a.createdAt;
      return b.lastOpenedAt - a.lastOpenedAt;
    });

  const isFiltered = query.length > 0;
  const visibleSelectedCount = filteredBoards.filter((board) =>
    selectedBoardIds.has(board.id),
  ).length;
  const allVisibleSelected =
    filteredBoards.length > 0 && visibleSelectedCount === filteredBoards.length;

  const persistFavorites = (next: Set<string>) => {
    setFavoriteIds(next);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
  };

  const toggleFavorite = (id: string, e?: ReactMouseEvent) => {
    e?.stopPropagation();
    const next = new Set(favoriteIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    persistFavorites(next);
  };

  const toggleSelectAll = () => {
    setSelectedBoardIds((previous) => {
      const next = new Set(previous);
      for (const board of filteredBoards) {
        if (allVisibleSelected) next.delete(board.id);
        else next.add(board.id);
      }
      return next;
    });
  };

  const toggleSelectBoard = (id: string, e?: ReactMouseEvent) => {
    e?.stopPropagation();
    setSelectedBoardIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const favoriteSelected = () => {
    const next = new Set(favoriteIds);
    for (const id of selectedBoardIds) next.add(id);
    persistFavorites(next);
  };

  const remove = async (board: BoardMeta) => {
    await boardRepository.delete(board.id);
    setDeleteTarget(null);
    setSelectedBoardIds((previous) => {
      const next = new Set(previous);
      next.delete(board.id);
      return next;
    });
    const nextFavorites = new Set(favoriteIds);
    nextFavorites.delete(board.id);
    persistFavorites(nextFavorites);
    refresh();
  };

  const removeSelected = async () => {
    for (const id of selectedBoardIds) {
      await boardRepository.delete(id);
    }
    const nextFavorites = new Set(favoriteIds);
    for (const id of selectedBoardIds) nextFavorites.delete(id);
    persistFavorites(nextFavorites);
    setSelectedBoardIds(new Set());
    setDeleteTarget(null);
    refresh();
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

  const renderBoardMenu = (board: BoardMeta) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => e.stopPropagation()}
            aria-label={`More actions for ${board.name}`}
            className="size-8 rounded-lg text-fg-muted hover:text-fg hover:bg-sunken"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => toggleFavorite(board.id)}>
            <Star
              data-icon="inline-start"
              className={cn(favoriteIds.has(board.id) && 'fill-current')}
            />
            {favoriteIds.has(board.id)
              ? 'Remove from favorites'
              : 'Add to favorites'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setTitleDialog({ mode: 'rename', board })}
          >
            <Pencil data-icon="inline-start" />
            Rename
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteTarget(board)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-dvh w-full flex-col bg-canvas font-sans text-fg selection:bg-action/20">
      <a
        href="#board-library"
        className="sr-only focus:not-sr-only focus:absolute focus:left-6 focus:top-6 focus:z-50 focus:rounded-lg focus:bg-inverse focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-fg-inverse"
      >
        Skip to boards
      </a>

      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <BrandMark className="size-7" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-fg">Whiteboard</span>
              <span className="hidden text-2xs text-fg-muted sm:inline">
                Workspace
              </span>
            </div>
          </div>

          <div className="hidden flex-1 items-center justify-center px-4 sm:flex">
            <BoardSearch
              inputRef={searchRef}
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark'
                  ? 'Switch to light theme'
                  : 'Switch to dark theme'
              }
              aria-pressed={theme === 'dark'}
              className="text-fg-muted hover:text-fg"
            >
              {theme === 'dark' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Account menu for ${accountName}`}
                    className="gap-2 rounded-lg px-2 text-fg hover:bg-panel"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-inverse font-mono text-2xs font-semibold text-fg-inverse">
                      {accountInitials}
                    </span>
                    <span className="hidden max-w-28 truncate text-sm font-medium lg:inline">
                      {accountName}
                    </span>
                    <ChevronDown
                      data-icon="inline-end"
                      className="hidden size-3 opacity-60 sm:block"
                    />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
                  <div className="px-2 pb-2 text-sm font-medium text-fg">
                    <p className="truncate">{accountName}</p>
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="sm:hidden" onClick={toggleTheme}>
                    {theme === 'dark' ? (
                      <Sun data-icon="inline-start" />
                    ) : (
                      <Moon data-icon="inline-start" />
                    )}
                    {theme === 'dark'
                      ? 'Switch to light theme'
                      : 'Switch to dark theme'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      await logout();
                      setAuth({ authenticated: false });
                    }}
                  >
                    <LogOut data-icon="inline-start" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="default"
              size="sm"
              onClick={() => setTitleDialog({ mode: 'create' })}
            >
              <Plus data-icon="inline-start" className="size-3.5" />
              <span>New canvas</span>
            </Button>
          </div>
        </div>

        <div className="border-t border-border px-4 py-2 sm:hidden">
          <BoardSearch
            inputRef={searchRef}
            value={searchQuery}
            onChange={setSearchQuery}
          />
        </div>
      </header>

      <main
        id="board-library"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
        aria-busy={loading}
      >
        <section className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-balance text-2xl font-semibold text-fg">
              Canvases
            </h1>
            <p className="max-w-lg text-pretty text-base text-fg-muted">
              Spacious, interactive boards for sketching, diagrams, notes, and
              collaboration.
            </p>
          </div>

          <div className="flex items-center gap-1 self-start rounded-lg border border-border bg-panel p-1 sm:self-auto">
            <button
              type="button"
              onClick={() => setActiveView('all')}
              aria-pressed={activeView === 'all'}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeView === 'all'
                  ? 'bg-surface text-fg shadow-e1'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              <Library className="size-3.5" />
              <span>All Canvases</span>
              <span className="font-mono text-2xs opacity-60">
                {allBoards.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('favorites')}
              aria-pressed={activeView === 'favorites'}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                activeView === 'favorites'
                  ? 'bg-surface text-fg shadow-e1'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              <Star className="size-3.5" />
              <span>Favorites</span>
              {favoriteCount > 0 ? (
                <span className="font-mono text-2xs opacity-60">
                  {favoriteCount}
                </span>
              ) : null}
            </button>
          </div>
        </section>

        <section
          aria-label="Canvas controls"
          className="mb-3 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3 text-sm text-fg-muted"
        >
          <div className="flex items-center gap-3">
            <label className="flex size-6 items-center justify-center cursor-pointer">
              <span className="sr-only">Select all visible canvases</span>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(element) => {
                  if (element) {
                    element.indeterminate =
                      visibleSelectedCount > 0 && !allVisibleSelected;
                  }
                }}
                onChange={toggleSelectAll}
                className="size-4 rounded-xs accent-action"
              />
            </label>

            <span className="tabular-nums">
              {isFiltered
                ? `${filteredBoards.length} of ${viewBoards.length} shown`
                : `${filteredBoards.length} canvases`}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-10 font-mono text-xs text-fg-subtle sm:flex">
              <span className="w-36">Last opened</span>
              <span className="hidden md:inline w-28">Created</span>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-sm text-fg-muted hover:bg-panel hover:text-fg"
                  >
                    <ArrowUpDown className="size-3" />
                    <span>{SORT_DETAILS[sortMode]}</span>
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  {(Object.keys(SORT_DETAILS) as SortMode[]).map((mode) => (
                    <DropdownMenuItem
                      key={mode}
                      onClick={() => setSortMode(mode)}
                    >
                      {sortMode === mode ? (
                        <Check data-icon="inline-start" className="size-3.5" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      {SORT_DETAILS[mode]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </section>

        {/* Content Area */}
        <section aria-labelledby="canvases-heading" className="flex-1">
          <h2 id="canvases-heading" className="sr-only">
            {activeView === 'favorites' ? 'Favorite canvases' : 'All canvases'}
          </h2>

          {loading ? (
            <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-e2">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-border p-4 last:border-b-0"
                >
                  <Skeleton className="size-5 rounded-md" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-48 rounded-md" />
                    <Skeleton className="h-3 w-32 rounded-md" />
                  </div>
                  <Skeleton className="h-4 w-28 rounded-md hidden sm:block" />
                </div>
              ))}
            </div>
          ) : filteredBoards.length === 0 ? (
            <Empty className="min-h-[360px] rounded-xl border border-dashed border-border-strong bg-surface p-8 sm:p-10">
              <EmptyHeader>
                <EmptyMedia
                  variant="icon"
                  className="size-12 rounded-lg bg-panel text-fg-muted"
                >
                  {isFiltered ? (
                    <Search className="size-6" />
                  ) : activeView === 'favorites' ? (
                    <Star className="size-6" />
                  ) : (
                    <Library className="size-6" />
                  )}
                </EmptyMedia>
                <EmptyTitle className="mt-4 text-balance text-xl font-semibold text-fg">
                  {isFiltered
                    ? 'No canvases found'
                    : activeView === 'favorites'
                      ? 'No favorite canvases yet'
                      : 'No canvases in your workspace'}
                </EmptyTitle>
                <EmptyDescription className="mx-auto mt-1 max-w-md text-pretty text-base text-fg-muted">
                  {isFiltered
                    ? `No canvas matched "${searchQuery.trim()}". Try checking your spelling or clear the filter.`
                    : activeView === 'favorites'
                      ? 'Star important canvases to keep them easily accessible here.'
                      : 'Create your first canvas to start sketching, diagramming, and creating.'}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="mt-5">
                {isFiltered ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setSearchQuery('');
                      searchRef.current?.focus();
                    }}
                  >
                    <X data-icon="inline-start" className="size-4" />
                    Clear search
                  </Button>
                ) : activeView === 'favorites' ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => setActiveView('all')}
                  >
                    <Library data-icon="inline-start" className="size-4" />
                    Browse all canvases
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="md"
                    onClick={() => setTitleDialog({ mode: 'create' })}
                  >
                    <Plus data-icon="inline-start" className="size-4" />
                    Create your first canvas
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-e2">
              {filteredBoards.map((board) => {
                const selected = selectedBoardIds.has(board.id);
                const favorite = favoriteIds.has(board.id);

                return (
                  <article
                    key={board.id}
                    className={cn(
                      'group/row flex items-center gap-3 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-panel sm:gap-4',
                      selected && 'bg-panel',
                    )}
                  >
                    {/* Checkbox */}
                    <label className="flex size-7 shrink-0 items-center justify-center cursor-pointer">
                      <span className="sr-only">Select {board.name}</span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) =>
                          toggleSelectBoard(
                            board.id,
                            e as unknown as ReactMouseEvent,
                          )
                        }
                        className="size-4 rounded-xs accent-action"
                      />
                    </label>

                    {/* Title & Info */}
                    <div className="min-w-0 flex-1">
                      <a
                        href={boardHref(board.id)}
                        onClick={(e) => openBoardLink(e, board.id)}
                        className="block truncate text-base font-medium text-fg hover:underline"
                        title={board.name}
                      >
                        {board.name}
                      </a>
                      <p className="mt-0.5 truncate font-mono text-xs text-fg-muted sm:hidden">
                        Opened {relativeTime(board.lastOpenedAt)}
                      </p>
                    </div>

                    {/* Timestamps (Desktop) */}
                    <div className="hidden sm:block w-36 text-xs text-fg-muted font-mono tabular-nums">
                      <span title={absoluteTimestamp(board.lastOpenedAt)}>
                        {relativeTime(board.lastOpenedAt)}
                      </span>
                    </div>

                    <div className="hidden md:block w-28 text-xs text-fg-muted font-mono tabular-nums">
                      {absoluteDate(board.createdAt)}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          favorite
                            ? 'Remove from favorites'
                            : 'Add to favorites'
                        }
                        aria-pressed={favorite}
                        onClick={(e) => toggleFavorite(board.id, e)}
                        className={cn(
                          'size-8 rounded-lg text-fg-muted hover:text-fg',
                          favorite && 'text-fg',
                        )}
                      >
                        <Star
                          className="size-4"
                          fill={favorite ? 'currentColor' : 'none'}
                        />
                      </Button>
                      {renderBoardMenu(board)}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {selectedBoardIds.size > 0 && (
          <aside
            aria-label="Bulk canvas actions"
            className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 animate-in items-center gap-2 rounded-full border border-border-strong/20 bg-inverse px-3 py-2 text-fg-inverse shadow-e3 fade-in slide-in-from-bottom-4 duration-200"
          >
            <span className="border-r border-fg-inverse/20 pr-3 font-mono text-sm font-medium">
              {selectedBoardIds.size} selected
            </span>

            {selectedBoardIds.size === 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const id = Array.from(selectedBoardIds)[0];
                  if (id) navigate(boardHref(id));
                }}
                className="h-7 rounded-full px-2 text-sm text-fg-inverse hover:bg-inverse-hover hover:text-fg-inverse"
              >
                <ExternalLink data-icon="inline-start" className="size-3" />
                Open
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={favoriteSelected}
              className="h-7 rounded-full px-2 text-sm text-fg-inverse hover:bg-inverse-hover hover:text-fg-inverse"
            >
              <Star data-icon="inline-start" className="size-3" />
              Favorite
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget('selected')}
              className="h-7 rounded-full px-2 text-sm text-danger-fg-on-inverse hover:bg-inverse-hover"
            >
              <Trash2 data-icon="inline-start" className="size-3" />
              Delete
            </Button>

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSelectedBoardIds(new Set())}
              aria-label="Clear selection"
              className="ml-1 size-6 rounded-full text-fg-inverse/70 hover:bg-inverse-hover hover:text-fg-inverse"
            >
              <X className="size-3.5" />
            </Button>
          </aside>
        )}
      </main>

      <BoardTitleDialog
        open={titleDialog !== null}
        heading={
          titleDialog?.mode === 'create' ? 'Create Canvas' : 'Rename Canvas'
        }
        description={
          titleDialog?.mode === 'create'
            ? 'Give your new canvas a clear, descriptive title.'
            : undefined
        }
        initialValue={
          titleDialog?.mode === 'rename' ? titleDialog.board.name : ''
        }
        submitLabel={titleDialog?.mode === 'create' ? 'Create Canvas' : 'Save'}
        onOpenChange={(open) => {
          if (!open) setTitleDialog(null);
        }}
        onSubmit={commitTitle}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-lg font-semibold text-fg">
              {deleteTarget === 'selected'
                ? `Delete ${selectedBoardIds.size} canvases?`
                : 'Delete canvas?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-pretty text-base text-fg-muted">
              {deleteTarget === 'selected'
                ? 'The selected canvases and all associated drawings, equations, and notes will be permanently deleted.'
                : `“${deleteTarget?.name}” and all associated canvas pages will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-2">
            <AlertDialogCancel variant="secondary" size="md">
              Cancel
            </AlertDialogCancel>
            <Button
              variant="destructive"
              size="md"
              onClick={() => {
                if (deleteTarget === 'selected') void removeSelected();
                else if (deleteTarget) void remove(deleteTarget);
              }}
            >
              {deleteTarget === 'selected'
                ? 'Delete Canvases'
                : 'Delete Canvas'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
