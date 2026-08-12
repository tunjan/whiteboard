import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Grid2x2,
  LogOut,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Search,
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
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
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
import { navigate } from '@/router';
import { useThemeStore } from '@/use-theme-store';
import { Login } from './login';

type TitleDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; board: BoardMeta };

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 days ago" — a bare date reads poorly for boards touched minutes ago. */
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

/** Whiteboard Dashboard Screen — Warm-Grey Instrument Panel UI */
export function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  // `null` until the first list() resolves, so the empty state never flashes.
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [titleDialog, setTitleDialog] = useState<TitleDialogState | null>(null);
  // A single board, or 'selected' for the bulk action — both get a confirm step.
  const [deleteTarget, setDeleteTarget] = useState<BoardMeta | 'selected' | null>(null);
  const [selectedBoardIds, setSelectedBoardIds] = useState<Set<string>>(new Set());
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

  // The ⌘K hint in the search field has to actually do something.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (auth === null) {
    return (
      <div className="h-screen w-screen bg-canvas p-3 md:p-4 flex items-center justify-center font-sans">
        <Skeleton className="h-full w-full max-w-[1440px] rounded-[28px]" />
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
  const query = searchQuery.trim().toLowerCase();
  const filteredBoards = query
    ? allBoards.filter((b) => b.name.toLowerCase().includes(query))
    : allBoards;
  const isFiltered = query.length > 0;

  const toggleSelectAll = () => {
    if (selectedBoardIds.size === filteredBoards.length) {
      setSelectedBoardIds(new Set());
    } else {
      setSelectedBoardIds(new Set(filteredBoards.map((b) => b.id)));
    }
  };

  const toggleSelectBoard = (id: string) => {
    const next = new Set(selectedBoardIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedBoardIds(next);
  };

  const remove = async (b: BoardMeta) => {
    await boardRepository.delete(b.id);
    setDeleteTarget(null);
    setSelectedBoardIds((prev) => {
      const next = new Set(prev);
      next.delete(b.id);
      return next;
    });
    refresh();
  };

  const removeSelected = async () => {
    for (const id of selectedBoardIds) {
      await boardRepository.delete(id);
    }
    setSelectedBoardIds(new Set());
    setDeleteTarget(null);
    refresh();
  };

  const commitTitle = async (title: string) => {
    if (!titleDialog) return;
    if (titleDialog.mode === 'create') {
      const b = await boardRepository.create(title);
      setTitleDialog(null);
      navigate(`/board/${b.id}`);
      return;
    }
    await boardRepository.rename(titleDialog.board.id, title);
    setTitleDialog(null);
    refresh();
  };

  return (
    <div className="h-screen w-screen bg-canvas p-3 md:p-4 overflow-hidden font-sans flex items-center justify-center">
      <div className="h-full w-full max-w-[1440px] rounded-[28px] border border-border bg-panel shadow-e2 overflow-hidden flex flex-col min-h-0">
        {/* Topbar Header & Global Search */}
        <header className="h-16 border-b border-border px-6 flex items-center justify-between gap-4 shrink-0 bg-surface">
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="size-7 rounded-lg bg-inverse text-fg-inverse flex items-center justify-center shadow-e1">
                <BrandMark className="size-4 stroke-[2.2]" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm tracking-tight text-fg">
                  Whiteboard
                </span>
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                  INSTRUMENT PANEL
                </span>
              </div>
            </div>
          </div>

          {/* Global Search Field */}
          <div className="relative w-full max-w-[560px] mx-auto min-w-0">
            <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.preventDefault();
                  setSearchQuery('');
                }
              }}
              placeholder="Search whiteboards..."
              aria-label="Search whiteboards"
              className="rounded-xl pl-10 pr-20"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-fg-subtle transition-colors duration-[80ms] hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={1.5} />
              </button>
            ) : (
              <kbd className="absolute right-3 top-1/2 flex -translate-y-1/2 gap-1 pointer-events-none">
                <span className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-panel px-1 font-mono text-2xs text-fg-muted">⌘</span>
                <span className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-panel px-1 font-mono text-2xs text-fg-muted">K</span>
              </kbd>
            )}
          </div>

          {/* Topbar Right Actions: Theme Toggle, User Account Dropdown, New Whiteboard */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              className="size-9 rounded-xl border border-border bg-surface flex items-center justify-center text-fg-muted hover:text-fg hover:border-border-strong transition-colors duration-[80ms] ease-out cursor-pointer"
              title="Toggle Light/Dark Theme"
              aria-label="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="flex items-center gap-2 p-1.5 px-2.5 rounded-xl border border-border bg-surface hover:bg-surface-hover transition-colors duration-[80ms] cursor-pointer text-left"
                  >
                    <div className="size-6 rounded-full bg-inverse text-fg-inverse font-mono font-medium text-xs flex items-center justify-center shrink-0">
                      {accountInitials}
                    </div>
                    <span className="text-xs font-medium text-fg hidden md:inline">{accountName}</span>
                    <ChevronDown size={14} strokeWidth={1.5} className="text-fg-subtle shrink-0" />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56 bg-surface border border-border shadow-e3 rounded-xl p-1.5">
                <div className="px-2 py-1.5 border-b border-border mb-1">
                  <p className="font-medium text-xs text-fg truncate">{accountName}</p>
                  <p className="text-2xs text-fg-muted truncate">Signed in</p>
                </div>
                <DropdownMenuItem
                  onClick={async () => {
                    await logout();
                    setAuth({ authenticated: false });
                  }}
                  className="text-danger-fg focus:bg-danger-bg focus:text-danger-fg rounded-lg cursor-pointer"
                >
                  <LogOut size={14} strokeWidth={1.5} className="mr-2" />
                  Log Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="primary"
              size="md"
              onClick={() => setTitleDialog({ mode: 'create' })}
            >
              <Plus size={16} strokeWidth={1.5} />
              New Whiteboard
            </Button>
          </div>
        </header>

        {/* Main Scrollable Content Panel */}
        <main className="flex-1 bg-surface p-6 space-y-6 overflow-y-auto">
          {/* Page Header Row */}
          <div>
            <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-fg-muted block">
              DASHBOARD OVERVIEW
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-fg">
              Whiteboards
            </h1>
          </div>

          {/* Table View Render */}
          {loading ? (
            /* Loading — mirrors the table card so the layout doesn't jump */
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
                <Skeleton className="h-3.5 w-28 rounded-sm" />
                <Skeleton className="h-3.5 w-24 rounded-sm" />
              </div>
              <div className="divide-y divide-border">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="size-4 shrink-0 rounded-xs" />
                    <Skeleton className="h-4 flex-1 max-w-[280px] rounded-sm" />
                    <Skeleton className="h-3.5 w-24 shrink-0 rounded-sm" />
                    <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ) : filteredBoards.length === 0 ? (
            /* Empty State — a search with no hits is not the same as no boards */
            <Empty className="min-h-[320px] rounded-2xl border border-border bg-surface">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {isFiltered ? (
                    <Search size={24} strokeWidth={1.5} className="text-fg-subtle" />
                  ) : (
                    <Grid2x2 size={24} strokeWidth={1.5} className="text-fg-subtle" />
                  )}
                </EmptyMedia>
                <EmptyTitle className="text-base font-medium text-fg">
                  {isFiltered ? 'No matching whiteboards' : 'No whiteboards yet'}
                </EmptyTitle>
                <EmptyDescription className="text-sm text-fg-muted">
                  {isFiltered
                    ? `Nothing matches “${searchQuery.trim()}”. Try a different search term.`
                    : 'Create your first whiteboard to open an interactive canvas.'}
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
                    <X size={16} strokeWidth={1.5} />
                    Clear search
                  </Button>
                ) : (
                  <Button variant="primary" size="md" onClick={() => setTitleDialog({ mode: 'create' })}>
                    <Plus size={16} strokeWidth={1.5} />
                    Create Whiteboard
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : (
            /* List View — Compound Table Card */
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              {/* Attached Toolbar Strip */}
              <div className="flex items-center justify-between border-b border-border bg-panel px-5 py-3">
                <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                  {isFiltered ? 'SEARCH RESULTS' : 'ALL SESSIONS'}
                </span>
                <span className="font-mono text-xs text-fg-muted tabular-nums">
                  {isFiltered
                    ? `${filteredBoards.length} of ${allBoards.length} sessions`
                    : `${allBoards.length} ${allBoards.length === 1 ? 'session' : 'sessions'}`}
                </span>
              </div>

              <Table>
                <TableHeader className="bg-panel border-b border-border">
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="w-10 pl-5">
                      <input
                        type="checkbox"
                        checked={
                          selectedBoardIds.size === filteredBoards.length &&
                          filteredBoards.length > 0
                        }
                        ref={(el) => {
                          if (el) {
                            el.indeterminate =
                              selectedBoardIds.size > 0 &&
                              selectedBoardIds.size < filteredBoards.length;
                          }
                        }}
                        onChange={toggleSelectAll}
                        aria-label="Select all whiteboards"
                        className="size-4 rounded-xs border border-border-strong accent-stone-900 dark:accent-stone-50 cursor-pointer"
                      />
                    </TableHead>
                    <TableHead className="w-full">WHITEBOARD NAME</TableHead>
                    <TableHead>CREATED</TableHead>
                    <TableHead>LAST OPENED</TableHead>
                    <TableHead className="text-right pr-5">ACTIONS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBoards.map((b) => {
                    const isSelected = selectedBoardIds.has(b.id);
                    return (
                      <TableRow
                        key={b.id}
                        className={`group border-b border-border transition-colors duration-[80ms] ${
                          isSelected ? 'bg-panel' : 'hover:bg-surface-hover'
                        }`}
                      >
                        {/* Checkbox */}
                        <TableCell className="w-10 pl-5 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectBoard(b.id)}
                            aria-label={`Select ${b.name}`}
                            className="size-4 rounded-xs border border-border-strong accent-stone-900 dark:accent-stone-50 cursor-pointer"
                          />
                        </TableCell>

                        {/* Title — absorbs the spare width so long names truncate
                            instead of forcing the table to scroll sideways. */}
                        <TableCell className="w-full max-w-0 py-3">
                          <button
                            type="button"
                            onClick={() => navigate(`/board/${b.id}`)}
                            className="block w-full truncate text-left font-medium text-sm text-fg hover:underline"
                            title={b.name}
                          >
                            {b.name}
                          </button>
                        </TableCell>

                        {/* Created */}
                        <TableCell className="py-3 font-mono text-xs tabular-nums text-fg-muted">
                          {absoluteDate(b.createdAt)}
                        </TableCell>

                        {/* Last Opened */}
                        <TableCell
                          className="py-3 font-mono text-xs tabular-nums text-fg-muted"
                          title={absoluteDate(b.lastOpenedAt)}
                        >
                          {relativeTime(b.lastOpenedAt)}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="py-3 text-right pr-5">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => navigate(`/board/${b.id}`)}
                              className="opacity-0 transition-opacity duration-[80ms] group-hover:opacity-100 focus-visible:opacity-100 touch-reveal"
                            >
                              Open
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="More options"
                                  >
                                    <MoreHorizontal size={16} strokeWidth={1.5} />
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end" className="w-44 bg-surface border border-border shadow-e3 rounded-xl">
                                <DropdownMenuItem
                                  onClick={() =>
                                    setTitleDialog({ mode: 'rename', board: b })
                                  }
                                >
                                  <Pencil size={14} strokeWidth={1.5} className="mr-2 text-fg-muted" />
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(b)}
                                  className="text-danger-fg focus:bg-danger-bg focus:text-danger-fg"
                                >
                                  <Trash2 size={14} strokeWidth={1.5} className="mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Attached Footer Strip */}
              <div className="flex items-center justify-between border-t border-border bg-panel px-5 py-3 text-xs text-fg-muted">
                <span className="font-mono tabular-nums">
                  Showing {filteredBoards.length} of {allBoards.length} sessions
                </span>
                <span className="font-mono text-2xs">
                  Press <kbd className="rounded-sm border border-border bg-surface px-1 py-0.5">⌘K</kbd> to search
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Selected Whiteboards Floating Action Pill */}
      {selectedBoardIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-border bg-inverse text-fg-inverse px-5 py-2.5 shadow-e4 flex items-center gap-4 text-xs font-medium animate-in slide-in-from-bottom-4 duration-[160ms]">
          <span className="font-mono tabular-nums text-fg-inverse font-medium">
            {selectedBoardIds.size} selected
          </span>
          <div className="h-4 w-px bg-stone-700 dark:bg-stone-300" />
          <button
            type="button"
            onClick={() => {
              const firstId = Array.from(selectedBoardIds)[0];
              if (firstId) navigate(`/board/${firstId}`);
            }}
            className="hover:underline transition-colors cursor-pointer"
          >
            Open selected
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget('selected')}
            className="text-danger-fg-on-inverse hover:underline transition-colors cursor-pointer font-medium"
          >
            Delete selected
          </button>
          <button
            type="button"
            onClick={() => setSelectedBoardIds(new Set())}
            className="size-5 rounded-full hover:bg-stone-800 dark:hover:bg-stone-200 flex items-center justify-center text-fg-inverse/60 hover:text-fg-inverse transition-colors"
            aria-label="Clear selection"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {/* Rename / Create Board Dialog */}
      <BoardTitleDialog
        open={titleDialog !== null}
        heading={
          titleDialog?.mode === 'create' ? 'Create Whiteboard' : 'Rename Whiteboard'
        }
        description={
          titleDialog?.mode === 'create'
            ? 'Enter a descriptive title for this whiteboard session.'
            : undefined
        }
        initialValue={
          titleDialog?.mode === 'rename' ? titleDialog.board.name : ''
        }
        submitLabel={
          titleDialog?.mode === 'create' ? 'Create Whiteboard' : 'Save Changes'
        }
        onOpenChange={(open) => {
          if (!open) setTitleDialog(null);
        }}
        onSubmit={commitTitle}
      />

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl border border-border bg-surface p-6 shadow-e4">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold text-fg">
              {deleteTarget === 'selected'
                ? `Delete ${selectedBoardIds.size} whiteboards?`
                : 'Delete Whiteboard?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-fg-secondary">
              {deleteTarget === 'selected'
                ? 'The selected whiteboards and all their canvas pages will be permanently deleted.'
                : `“${deleteTarget?.name}” and all associated canvas pages will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel variant="secondary" size="md">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              size="md"
              onClick={() => {
                if (deleteTarget === 'selected') void removeSelected();
                else if (deleteTarget) void remove(deleteTarget);
              }}
            >
              {deleteTarget === 'selected' ? 'Delete Whiteboards' : 'Delete Whiteboard'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
