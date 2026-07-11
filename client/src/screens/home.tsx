import { useEffect, useState, type CSSProperties } from 'react';
import {
  CircleHelp,
  Clock3,
  LogOut,
  Pencil,
  Plus,
  Shapes,
  Trash2,
  UserCircle,
} from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BrandMark } from '@/components/brand-mark';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import { Login } from './login';

type TitleDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; board: BoardMeta };

const boardPreviewStyle: CSSProperties = {
  backgroundImage:
    'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
  backgroundSize: '18px 18px',
};

const ACTIVE_NAV_CLASS =
  'bg-bg-info text-content-info hover:bg-bg-info hover:text-content-info';

function BoardCard({
  board,
  onRename,
  onDelete,
}: {
  board: BoardMeta;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="group flex min-h-64 flex-col rounded-xl border border-border-subtle bg-bg-default p-4 transition-[background-color,border-color,box-shadow] hover:border-border-default hover:shadow-hover">
      <button
        type="button"
        onClick={() => navigate(`/board/${board.id}`)}
        className="flex flex-1 flex-col gap-4 text-left outline-none"
      >
        <div
          className="relative h-32 overflow-hidden rounded-lg border border-border-muted bg-bg-muted"
          style={boardPreviewStyle}
        >
          <div className="absolute left-5 top-5 grid grid-cols-2 gap-1">
            <span className="size-2 rounded-[3px] bg-content-emphasis" />
            <span className="size-2 rounded-[3px] bg-content-muted" />
            <span className="size-2 rounded-[3px] bg-content-subtle" />
            <span className="size-2 rounded-[3px] bg-content-emphasis" />
          </div>
          <div className="absolute bottom-4 left-5 h-2 w-24 rounded-full bg-bg-emphasis" />
          <div className="absolute bottom-8 left-5 h-2 w-36 rounded-full bg-bg-emphasis" />
        </div>

        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-content-emphasis">
            {board.name}
          </h2>
          <div className="mt-2 flex items-center gap-1.5 text-sm text-content-subtle">
            <Clock3 className="size-3.5" />
            <span>{new Date(board.updatedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </button>

      <div className="touch-reveal mt-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Rename" onClick={onRename}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete"
          onClick={onDelete}
          className="text-content-error hover:bg-bg-error hover:text-content-error"
        >
          <Trash2 />
        </Button>
      </div>
    </article>
  );
}

/** Board management home — tutor-only (create / open / rename / delete). */
export function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [titleDialog, setTitleDialog] = useState<TitleDialogState | null>(null);

  const refresh = () => {
    void boardRepository.list().then(setBoards);
  };

  useEffect(() => {
    void getAuth().then(setAuth);
  }, []);
  useEffect(() => {
    if (auth?.authenticated) refresh();
  }, [auth?.authenticated]);

  if (auth === null) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg-muted text-sm text-content-subtle">
        Loading…
      </div>
    );
  }
  if (!auth.authenticated) {
    return <Login onSuccess={() => void getAuth().then(setAuth)} />;
  }

  const remove = async (b: BoardMeta) => {
    if (window.confirm(`Delete "${b.name}"? This cannot be undone.`)) {
      await boardRepository.delete(b.id);
      refresh();
    }
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
    <div className="min-h-screen bg-bg-muted text-content-emphasis">
      <div className="flex min-h-screen">
        <aside className="hidden shrink-0 border-r border-border-subtle lg:flex">
          <div className="flex w-16 flex-col items-center border-r border-border-subtle bg-bg-default py-4">
            <BrandMark className="size-8" />
            <div className="mt-8 flex flex-col gap-2">
              <button
                type="button"
                aria-label="Boards"
                aria-current="page"
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg text-content-subtle transition-colors hover:bg-bg-muted hover:text-content-emphasis',
                  ACTIVE_NAV_CLASS,
                )}
              >
                <Shapes className="size-5" />
              </button>
            </div>
            <div className="mt-auto flex flex-col gap-2">
              <button
                type="button"
                aria-label="Help"
                className="flex size-10 items-center justify-center rounded-lg text-content-subtle transition-colors hover:bg-bg-muted hover:text-content-emphasis"
              >
                <CircleHelp className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Tutor profile"
                className="flex size-10 items-center justify-center rounded-full text-content-subtle transition-colors hover:bg-bg-muted hover:text-content-emphasis"
              >
                <UserCircle className="size-5" />
              </button>
            </div>
          </div>

          <div className="flex w-64 flex-col bg-bg-muted px-4 py-5">
            <div>
              <p className="text-sm font-semibold tracking-[-0.02em]">
                Best Whiteboard
              </p>
              <p className="mt-1 text-xs text-content-subtle">
                Tutor workspace
              </p>
            </div>

            <nav className="mt-8 flex flex-col gap-2">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                Workspace
              </p>
              <button
                type="button"
                aria-current="page"
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-content-default transition-colors hover:bg-bg-default hover:text-content-emphasis',
                  ACTIVE_NAV_CLASS,
                )}
              >
                <Shapes className="size-4" />
                Boards
              </button>
            </nav>

            <div className="mt-auto border-t border-border-subtle pt-5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-content-emphasis">Boards</span>
                <span className="font-mono tabular-nums text-content-subtle">
                  {boards.length}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-bg-inverted"
                  style={{ width: `${Math.min(100, boards.length * 12)}%` }}
                />
              </div>
              <p className="mt-3 max-w-[13rem] text-xs leading-5 text-content-subtle">
                Create boards before students join, then share a page-specific link.
              </p>
            </div>
          </div>
        </aside>

        <main className="flex-1 px-6 py-8 lg:px-12 lg:py-12">
          <div className="mx-auto flex max-w-[960px] flex-col gap-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 lg:hidden">
                  <BrandMark />
                  <p className="text-sm font-semibold tracking-[-0.02em]">
                    Best Whiteboard
                  </p>
                </div>
                <div>
                  <p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-content-muted">
                    Boards
                  </p>
                  <h1 className="mt-2 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-content-emphasis">
                    Welcome back
                  </h1>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-content-subtle">
                    Create a lesson board or reopen a recent session.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {boards.length > 0 ? (
                  <Button onClick={() => setTitleDialog({ mode: 'create' })}>
                    <Plus data-icon="inline-start" />
                    New board
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Log out"
                  onClick={async () => {
                    await logout();
                    setAuth({ authenticated: false });
                  }}
                >
                  <LogOut />
                </Button>
              </div>
            </div>

            {boards.length === 0 ? (
              <div className="rounded-xl border border-border-subtle bg-bg-default p-10 text-center sm:p-12">
                <div
                  aria-hidden="true"
                  className="mx-auto mb-8 flex max-w-sm flex-col gap-2 opacity-60"
                >
                  <div className="h-3 rounded-full bg-bg-subtle" />
                  <div className="h-3 w-10/12 rounded-full bg-bg-subtle" />
                  <div className="h-3 w-7/12 rounded-full bg-bg-subtle" />
                </div>
                <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg bg-bg-subtle">
                  <Plus className="size-5 text-content-emphasis" />
                </div>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-content-emphasis">
                  No boards yet
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-content-subtle">
                  Create the first board for this workspace.
                </p>
                <Button
                  className="mt-6"
                  onClick={() => setTitleDialog({ mode: 'create' })}
                >
                  <Plus data-icon="inline-start" />
                  New board
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {boards.map((b) => (
                  <BoardCard
                    key={b.id}
                    board={b}
                    onRename={() => {
                      setTitleDialog({ mode: 'rename', board: b });
                    }}
                    onDelete={() => remove(b)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <BoardTitleDialog
        open={titleDialog !== null}
        heading={
          titleDialog?.mode === 'create' ? 'Name whiteboard' : 'Rename board'
        }
        description={
          titleDialog?.mode === 'create'
            ? 'Choose a title before the whiteboard is created.'
            : undefined
        }
        initialValue={
          titleDialog?.mode === 'rename' ? titleDialog.board.name : ''
        }
        submitLabel={
          titleDialog?.mode === 'create' ? 'Create board' : 'Save changes'
        }
        onOpenChange={(open) => {
          if (!open) setTitleDialog(null);
        }}
        onSubmit={commitTitle}
      />
    </div>
  );
}
