import { useEffect, useState } from 'react';
import { Grid2X2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BrandMark } from '@/components/brand-mark';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
    <article className="group flex min-h-16 items-center gap-2 border-b border-border-subtle transition-colors duration-150 hover:bg-bg-muted focus-within:bg-bg-muted">
      <button
        type="button"
        onClick={() => navigate(`/board/${board.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-3 text-left outline-none sm:gap-4"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-default text-content-subtle" aria-hidden="true">
          <Grid2X2 className="size-4" />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-6">
          <span className="truncate text-sm font-medium text-content-emphasis">
            {board.name}
          </span>
          <time
            dateTime={new Date(board.lastOpenedAt).toISOString()}
            className="text-xs tabular-nums text-content-subtle sm:text-sm"
          >
            Opened {new Date(board.lastOpenedAt).toLocaleDateString()}
          </time>
        </span>
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
  const [deleteTarget, setDeleteTarget] = useState<BoardMeta | null>(null);

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
      <div className="min-h-dvh bg-bg-default text-content-emphasis">
        <div className="mx-auto w-full max-w-[70rem] px-4 py-20 sm:px-8">
          <span className="sr-only" role="status">Loading Boards</span>
          <Skeleton className="h-8 w-32" />
          <div className="mt-8 border-t border-border-subtle" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex h-16 items-center gap-4 border-b border-border-subtle">
                <Skeleton className="size-10" />
                <Skeleton className="h-4 w-48 max-w-[50vw]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!auth.authenticated) {
    return <Login onSuccess={() => void getAuth().then(setAuth)} />;
  }

  const remove = async (b: BoardMeta) => {
    await boardRepository.delete(b.id);
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
    <div className="min-h-dvh bg-bg-default text-content-emphasis">
      <header className="border-b border-border-subtle bg-bg-default">
        <div className="mx-auto flex h-14 max-w-[70rem] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold tracking-[-0.01em]">
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
            Log Out
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[70rem] px-4 py-8 sm:px-8 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-balance text-3xl leading-10 font-semibold tracking-[-0.025em]">Boards</h1>
            <Badge variant="secondary" className="tabular-nums" aria-label={`${boards.length} boards`}>
              {boards.length}
            </Badge>
          </div>
          {boards.length > 0 ? (
            <Button onClick={() => setTitleDialog({ mode: 'create' })}>
              <Plus data-icon="inline-start" />
              New Board
            </Button>
          ) : null}
        </div>

        {boards.length === 0 ? (
          <Empty className="min-h-[50vh]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Grid2X2 /></EmptyMedia>
              <EmptyTitle>No Boards Yet</EmptyTitle>
              <EmptyDescription>
                Create a shared canvas for sketches, equations, notes, and live collaboration.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setTitleDialog({ mode: 'create' })}>
                <Plus data-icon="inline-start" />
                Create Board
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="mt-7 border-t border-border-subtle">
            {boards.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                onRename={() => {
                  setTitleDialog({ mode: 'rename', board: b });
                }}
                onDelete={() => setDeleteTarget(b)}
              />
            ))}
          </div>
        )}
      </main>

      <BoardTitleDialog
        open={titleDialog !== null}
        heading={
          titleDialog?.mode === 'create' ? 'Name Whiteboard' : 'Rename Board'
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
          titleDialog?.mode === 'create' ? 'Create Board' : 'Save Changes'
        }
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Whiteboard?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” and all of its pages will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              Delete Whiteboard
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
