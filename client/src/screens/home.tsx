import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BrandMark } from '@/components/brand-mark';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { navigate } from '@/router';
import { Login } from './login';

type TitleDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; board: BoardMeta };

function BoardRow({
  board,
  onRename,
  onDelete,
}: {
  board: BoardMeta;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="group flex min-h-16 items-center gap-2 border-b border-border-subtle">
      <button
        type="button"
        onClick={() => navigate(`/board/${board.id}`)}
        className="grid min-w-0 flex-1 gap-1 py-4 text-left outline-none transition-opacity hover:opacity-70 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-6"
      >
        <h2 className="truncate text-sm font-medium text-content-emphasis">
          {board.name}
        </h2>
        <time
          dateTime={new Date(board.updatedAt).toISOString()}
          className="text-xs text-content-subtle sm:text-sm"
        >
          Updated {new Date(board.updatedAt).toLocaleDateString()}
        </time>
      </button>

      <div className="touch-reveal touch-targets flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button variant="ghost" size="icon-sm" aria-label="Rename" onClick={onRename}>
          <Pencil />
        </Button>
        <Button
          variant="danger-outline"
          size="icon-sm"
          aria-label="Delete"
          onClick={onDelete}
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
    <div className="min-h-dvh bg-bg-default text-content-emphasis">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-[1040px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold tracking-[-0.02em]">
              Best Whiteboard
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await logout();
              setAuth({ authenticated: false });
            }}
          >
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1040px] px-5 py-8 sm:px-8 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">Boards</h1>
            <span className="text-sm tabular-nums text-content-subtle">
              {boards.length}
            </span>
          </div>
          {boards.length > 0 ? (
            <Button onClick={() => setTitleDialog({ mode: 'create' })}>
              <Plus data-icon="inline-start" />
              New board
            </Button>
          ) : null}
        </div>

        {boards.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
            <h2 className="text-lg font-semibold tracking-[-0.02em]">
              Create your first board
            </h2>
            <p className="mt-2 text-sm text-content-subtle">
              Start with a blank whiteboard.
            </p>
            <Button
              className="mt-5"
              onClick={() => setTitleDialog({ mode: 'create' })}
            >
              <Plus data-icon="inline-start" />
              New board
            </Button>
          </div>
        ) : (
          <div className="mt-7 border-t border-border-subtle">
            {boards.map((b) => (
              <BoardRow
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
      </main>

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
