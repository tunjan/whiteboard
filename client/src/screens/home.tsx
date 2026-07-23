import { useEffect, useState } from 'react';
import { Grid2x2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { BoardMeta } from '@whiteboard/shared';
import { type AuthState, getAuth, logout } from '@/board/auth';
import { boardRepository } from '@/board/server-board-repository';
import { BrandMark } from '@/components/brand-mark';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={() => navigate(`/board/${board.id}`)}
          className="flex min-w-0 items-center text-left outline-none hover:underline focus-visible:underline"
        >
          <span className="truncate font-medium text-foreground">
            {board.name}
          </span>
        </button>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <time dateTime={new Date(board.lastOpenedAt).toISOString()}>
          {new Date(board.lastOpenedAt).toLocaleDateString()}
        </time>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${board.name}`}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
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
      <div className="min-h-dvh">
        <div className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6">
          <span className="sr-only" role="status">Loading Boards</span>
          <Skeleton className="h-8 w-32" />
          <div className="mt-6 overflow-hidden rounded-md border">
            <Table>
              <TableBody>
                {[0, 1, 2].map((row) => (
                  <TableRow key={row}>
                    <TableCell>
                      <Skeleton className="h-4 w-48 max-w-[50vw]" />
                    </TableCell>
                    <TableCell className="w-32">
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    <TableCell className="w-12" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
    <div className="min-h-dvh">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <BrandMark className="size-7" />
            <span className="text-sm font-semibold">Best Whiteboard</span>
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

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Boards</h1>
            <Badge variant="secondary" aria-label={`${boards.length} boards`}>
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
          <Empty className="mt-6 min-h-[50vh] border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Grid2x2 /></EmptyMedia>
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
          <div className="mt-6 overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Last Opened</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
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
              </TableBody>
            </Table>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
