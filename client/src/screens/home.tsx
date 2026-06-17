import { useEffect, useState } from 'react';
import { LogOut, Pencil, Plus, Shapes, Trash2 } from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { navigate } from '@/router';
import { Login } from './login';

/** Board management home — tutor-only (create / open / rename / delete). */
export function Home() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [renaming, setRenaming] = useState<BoardMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  const createBoard = async () => {
    const b = await boardRepository.create('Untitled board');
    navigate(`/board/${b.id}`);
  };

  const remove = async (b: BoardMeta) => {
    if (window.confirm(`Delete "${b.name}"? This cannot be undone.`)) {
      await boardRepository.delete(b.id);
      refresh();
    }
  };

  const commitRename = async () => {
    if (!renaming) return;
    await boardRepository.rename(renaming.id, renameValue);
    setRenaming(null);
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
            <Button onClick={createBoard}>
              <Plus className="size-4" />
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
                      setRenaming(b);
                      setRenameValue(b.name);
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

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={commitRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
