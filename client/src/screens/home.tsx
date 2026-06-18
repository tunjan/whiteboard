import { useEffect, useState } from 'react';
import { LogOut, Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { navigate } from '@/router';
import { Login } from './login';

type TitleDialogState =
  | { mode: 'create' }
  | { mode: 'rename'; board: BoardMeta };

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
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
              <Shapes className="size-4" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Boards</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setTitleDialog({ mode: 'create' })}>
              <Plus data-icon="inline-start" />
              New board
            </Button>
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
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No boards yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((b) => (
              <div
                key={b.id}
                className="group relative flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/board/${b.id}`)}
                  className="flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">{b.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {new Date(b.updatedAt).toLocaleDateString()}
                  </div>
                </button>
                <div className="mt-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Rename"
                    onClick={() => {
                      setTitleDialog({ mode: 'rename', board: b });
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Delete"
                    onClick={() => remove(b)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        submitLabel={titleDialog?.mode === 'create' ? 'Create' : 'Save'}
        onOpenChange={(open) => {
          if (!open) setTitleDialog(null);
        }}
        onSubmit={commitTitle}
      />
    </div>
  );
}
