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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  | { mode: 'create' }
  | { mode: 'rename'; board: BoardMeta };

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

const VIEW_DETAILS: Record<
  LibraryView,
  { label: string; description: string; icon: typeof Library }
> = {
  all: {
    label: 'All',
    description: 'Every canvas in your workspace.',
    icon: Library,
  },
  favorites: {
    label: 'Favorites',
    description: 'The canvases you keep close at hand.',
    icon: Star,
  },
};

const SORT_DETAILS: Record<SortMode, string> = {
  activity: 'Last opened',
  created: 'Date created',
  name: 'Board name',
};

function loadFavoriteIds(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
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
    <search className="block w-full" aria-label="Board search">
      <InputGroup className="h-10 bg-sunken">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
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
          placeholder="Search boards"
          aria-label="Search boards"
          aria-keyshortcuts="Meta+K Control+K"
        />
        <InputGroupAddon align="inline-end">
          {value ? (
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                onChange('');
                inputRef.current?.focus();
              }}
            >
              <X />
            </InputGroupButton>
          ) : (
            <KbdGroup className="hidden sm:inline-flex">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          )}
        </InputGroupAddon>
      </InputGroup>
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
  const [deleteTarget, setDeleteTarget] = useState<BoardMeta | 'selected' | null>(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(new Set());
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
      <div className="h-dvh w-full bg-surface font-sans">
        <Skeleton className="size-full rounded-none" />
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

  const toggleFavorite = (id: string) => {
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

  const toggleSelectBoard = (id: string) => {
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

  const viewCounts: Record<LibraryView, number> = {
    all: allBoards.length,
    favorites: allBoards.filter((board) => favoriteIds.has(board.id)).length,
  };

  const renderBoardMenu = (board: BoardMeta) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-md"
            aria-label={`More actions for ${board.name}, created ${absoluteDate(board.createdAt)}`}
          >
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => toggleFavorite(board.id)}>
            <Star data-icon="inline-start" />
            {favoriteIds.has(board.id) ? 'Remove from favorites' : 'Add to favorites'}
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

  const renderBoardActions = (board: BoardMeta) => {
    const favorite = favoriteIds.has(board.id);
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-md"
          aria-label={
            favorite
              ? `Remove ${board.name}, created ${absoluteDate(board.createdAt)}, from favorites`
              : `Add ${board.name}, created ${absoluteDate(board.createdAt)}, to favorites`
          }
          aria-pressed={favorite}
          onClick={() => toggleFavorite(board.id)}
          className={cn(favorite && 'text-info-fg')}
        >
          <Star fill={favorite ? 'currentColor' : 'none'} />
        </Button>
        {renderBoardMenu(board)}
      </div>
    );
  };

  return (
    <div className="flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-surface font-sans">
      <a
        href="#board-library"
        className="absolute left-4 top-4 -translate-y-20 rounded-md bg-inverse px-3 py-2 text-sm font-medium text-fg-inverse focus-visible:translate-y-0"
      >
        Skip to boards
      </a>

      <header className="shrink-0 border-b border-border bg-surface">
          <div className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-3 px-4 lg:grid-cols-[auto_minmax(320px,560px)_auto] lg:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-inverse text-fg-inverse shadow-e1">
                <BrandMark className="size-4 stroke-[2.2]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">Whiteboard</p>
                <p className="hidden text-xs text-fg-muted sm:block">
                  Canvas workspace
                </p>
              </div>
            </div>

            <div className="hidden min-w-0 lg:block">
              <BoardSearch
                inputRef={searchRef}
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>

            <div className="flex items-center justify-end gap-1.5 sm:gap-2">
              <Button
                variant="outline"
                size="icon-md"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                aria-pressed={theme === 'dark'}
                className="hidden sm:inline-flex"
              >
                {theme === 'dark' ? <Sun /> : <Moon />}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="md"
                      aria-label={`Account menu for ${accountName}`}
                      className="px-2.5"
                    >
                      <span className="flex size-6 items-center justify-center rounded-full bg-inverse font-mono text-xs font-medium text-fg-inverse">
                        {accountInitials}
                      </span>
                      <span className="hidden max-w-28 truncate xl:inline">{accountName}</span>
                      <ChevronDown data-icon="inline-end" className="hidden sm:block" />
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
                      {theme === 'dark' ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
                      {theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
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
                variant="primary"
                size="md"
                onClick={() => setTitleDialog({ mode: 'create' })}
              >
                <Plus data-icon="inline-start" />
                <span className="hidden min-[360px]:inline">New board</span>
                <span className="min-[360px]:hidden">New</span>
              </Button>
            </div>
          </div>

          <div className="px-4 pb-3 lg:hidden">
            <BoardSearch
              inputRef={searchRef}
              value={searchQuery}
              onChange={setSearchQuery}
            />
          </div>
      </header>

      <main
          id="board-library"
          className="min-h-0 flex-1 overflow-y-auto bg-surface"
          aria-busy={loading}
        >
          <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5 px-4 py-6 md:px-8 md:py-9 xl:py-10">
            <section className="flex flex-col gap-1">
              <h1 className="text-balance text-2xl font-semibold tracking-tight text-fg md:text-3xl">
                Boards
              </h1>
              <p className="max-w-[55ch] text-pretty text-sm text-fg-secondary">
                {VIEW_DETAILS[activeView].description}
              </p>
            </section>

            <section aria-label="Board library controls" className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <ToggleGroup
                  aria-label="Filter boards"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={[activeView]}
                  onValueChange={(value) => {
                    const nextView = value[0] as LibraryView | undefined;
                    if (nextView) setActiveView(nextView);
                  }}
                >
                  {(Object.keys(VIEW_DETAILS) as LibraryView[]).map((view) => {
                    const { icon: Icon, label } = VIEW_DETAILS[view];
                    return (
                      <ToggleGroupItem
                        key={view}
                        value={view}
                        aria-label={`${label}, ${viewCounts[view]} board${viewCounts[view] === 1 ? '' : 's'}`}
                        className="data-[state=on]:border-info-border data-[state=on]:bg-info-bg data-[state=on]:text-info-fg"
                      >
                        <Icon data-icon="inline-start" />
                        {label}
                      </ToggleGroupItem>
                    );
                  })}
                </ToggleGroup>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <p className="mr-auto text-sm tabular-nums text-fg-muted sm:mr-1">
                    {isFiltered
                      ? `${filteredBoards.length} result${filteredBoards.length === 1 ? '' : 's'}`
                      : `${viewBoards.length} board${viewBoards.length === 1 ? '' : 's'}`}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="secondary" size="sm">
                          <ArrowUpDown data-icon="inline-start" />
                          {SORT_DETAILS[sortMode]}
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>Sort boards by</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {(Object.keys(SORT_DETAILS) as SortMode[]).map((mode) => (
                          <DropdownMenuItem key={mode} onClick={() => setSortMode(mode)}>
                            {sortMode === mode ? (
                              <Check data-icon="inline-start" />
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
              </div>

              <p className="sr-only" role="status" aria-live="polite">
                {filteredBoards.length} board{filteredBoards.length === 1 ? '' : 's'} shown.
              </p>

              {selectedBoardIds.size > 0 ? (
                <>
                  <p className="sr-only" role="status" aria-live="polite">
                    {selectedBoardIds.size} board{selectedBoardIds.size === 1 ? '' : 's'} selected. Bulk actions are available.
                  </p>
                  <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-lg border border-info-border bg-info-bg px-3 py-1.5 sm:px-4">
                    <span className="mr-1 text-sm font-medium tabular-nums text-info-fg">
                      {selectedBoardIds.size} selected
                    </span>
                    {selectedBoardIds.size === 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const id = Array.from(selectedBoardIds)[0];
                          if (id) navigate(boardHref(id));
                        }}
                      >
                        Open
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={favoriteSelected}>
                      <Star data-icon="inline-start" />
                      Favorite
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget('selected')}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      aria-label="Clear board selection"
                      onClick={() => setSelectedBoardIds(new Set())}
                    >
                      <X />
                    </Button>
                  </div>
                </>
              ) : null}
            </section>

            <section aria-labelledby="collection-heading">
              <h2 id="collection-heading" className="sr-only">
                {activeView === 'favorites' ? 'Favorite boards' : 'All boards'}
              </h2>

              {loading ? (
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="flex flex-col divide-y divide-border">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <div key={index} className="flex h-16 items-center gap-3 px-4">
                        <Skeleton className="size-4 shrink-0 rounded-xs" />
                        <Skeleton className="h-4 w-48 max-w-[40%] rounded-sm" />
                        <Skeleton className="ml-auto h-4 w-24 rounded-sm" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : filteredBoards.length === 0 ? (
                <Empty className="min-h-[320px] rounded-xl border border-border bg-surface">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      {isFiltered ? <Search /> : activeView === 'favorites' ? <Star /> : <Library />}
                    </EmptyMedia>
                    <EmptyTitle>
                      {isFiltered
                        ? 'No boards match your search'
                        : activeView === 'favorites'
                          ? 'No favorite boards yet'
                          : 'No boards yet'}
                    </EmptyTitle>
                    <EmptyDescription>
                      {isFiltered
                        ? `Nothing matches “${searchQuery.trim()}”. Clear the search and try again.`
                        : activeView === 'favorites'
                          ? 'Add a board to favorites to keep it close at hand.'
                          : 'Create your first board to open a new interactive canvas.'}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    {isFiltered ? (
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setSearchQuery('');
                          searchRef.current?.focus();
                        }}
                      >
                        <X data-icon="inline-start" />
                        Clear search
                      </Button>
                    ) : activeView === 'favorites' ? (
                      <Button variant="secondary" size="md" onClick={() => setActiveView('all')}>
                        <Library data-icon="inline-start" />
                        Browse all boards
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => setTitleDialog({ mode: 'create' })}
                      >
                        <Plus data-icon="inline-start" />
                        Create board
                      </Button>
                    )}
                  </EmptyContent>
                </Empty>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  <div className="hidden lg:block">
                    <Table className="min-w-[760px]">
                      <TableCaption className="sr-only">
                        Boards in the current library view
                      </TableCaption>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-12 px-1 text-center" scope="col">
                            <label className="mx-auto flex size-10 items-center justify-center">
                              <span className="sr-only">Select all visible boards</span>
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
                          </TableHead>
                          <TableHead scope="col">Board</TableHead>
                          <TableHead className="w-36" scope="col">Created</TableHead>
                          <TableHead className="w-40" scope="col">Last opened</TableHead>
                          <TableHead className="w-28 text-right" scope="col">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredBoards.map((board) => {
                          const selected = selectedBoardIds.has(board.id);
                          return (
                            <TableRow
                              key={board.id}
                              data-state={selected ? 'selected' : undefined}
                              className={cn('h-16', selected && 'bg-info-bg hover:bg-info-bg')}
                            >
                              <TableCell className="w-12 px-1 py-0">
                                <label className="mx-auto flex size-10 items-center justify-center">
                                  <span className="sr-only">
                                    Select {board.name}, created {absoluteDate(board.createdAt)}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => toggleSelectBoard(board.id)}
                                    className="size-4 rounded-xs accent-action"
                                  />
                                </label>
                              </TableCell>
                              <TableCell className="max-w-0 py-2">
                                <div className="flex min-w-0 items-center">
                                  <a
                                    href={boardHref(board.id)}
                                    onClick={(event) => openBoardLink(event, board.id)}
                                    className="truncate text-sm font-semibold text-fg hover:underline"
                                    title={board.name}
                                  >
                                    {board.name}
                                  </a>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs tabular-nums text-fg-muted">
                                {absoluteDate(board.createdAt)}
                              </TableCell>
                              <TableCell
                                className="font-mono text-xs tabular-nums text-fg-muted"
                                title={absoluteTimestamp(board.lastOpenedAt)}
                              >
                                {relativeTime(board.lastOpenedAt)}
                              </TableCell>
                              <TableCell className="pr-3 text-right">
                                <div className="flex justify-end">
                                  {renderBoardActions(board)}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <ul className="divide-y divide-border lg:hidden" aria-label="Boards">
                    {filteredBoards.map((board) => {
                      const selected = selectedBoardIds.has(board.id);
                      return (
                        <li key={board.id} className={cn('p-3', selected && 'bg-info-bg')}>
                          <article className="flex items-center gap-2">
                            <label className="flex size-10 shrink-0 items-center justify-center">
                              <span className="sr-only">
                                Select {board.name}, created {absoluteDate(board.createdAt)}
                              </span>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => toggleSelectBoard(board.id)}
                                className="size-4 rounded-xs accent-action"
                              />
                            </label>
                            <div className="min-w-0 flex-1">
                              <a
                                href={boardHref(board.id)}
                                onClick={(event) => openBoardLink(event, board.id)}
                                className="block truncate text-sm font-semibold text-fg hover:underline"
                                title={board.name}
                              >
                                {board.name}
                              </a>
                              <p
                                className="truncate text-xs tabular-nums text-fg-muted"
                                title={absoluteTimestamp(board.lastOpenedAt)}
                              >
                                Opened {relativeTime(board.lastOpenedAt)} · Created {absoluteDate(board.createdAt)}
                              </p>
                            </div>
                            {renderBoardActions(board)}
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          </div>
      </main>

      <BoardTitleDialog
        open={titleDialog !== null}
        heading={titleDialog?.mode === 'create' ? 'Create board' : 'Rename board'}
        description={
          titleDialog?.mode === 'create'
            ? 'Give this canvas a name you will recognize later.'
            : undefined
        }
        initialValue={titleDialog?.mode === 'rename' ? titleDialog.board.name : ''}
        submitLabel={titleDialog?.mode === 'create' ? 'Create board' : 'Save changes'}
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
        <AlertDialogContent className="rounded-2xl border border-border bg-surface p-6 shadow-e4">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget === 'selected'
                ? `Delete ${selectedBoardIds.size} boards?`
                : 'Delete board?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === 'selected'
                ? 'The selected boards and all of their canvas pages will be permanently deleted.'
                : `“${deleteTarget?.name}” and all of its canvas pages will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
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
              {deleteTarget === 'selected' ? 'Delete boards' : 'Delete board'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
