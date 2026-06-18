import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  createPage,
  deletePage,
  movePage,
  renamePage,
  setCurrentPage,
  useDocumentStore,
} from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

/**
 * Page switcher for a board, docked in the top-left chrome. Lists every page
 * (create / switch / rename / reorder / delete). Both tutor and student have the
 * same powers. Page state lives in the shared Yjs doc via the document store.
 */
export function PageMenu() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const pageOrder = useDocumentStore((s) => s.doc.pageOrder);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const ordered = pageOrder
    .map((id) => pages[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const current = pages[currentPageId];

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setEditingId(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" data-ui-layer>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Pages"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-8 max-w-[180px] gap-1.5 rounded-lg px-2 font-semibold"
      >
        <span className="truncate">{current?.name ?? 'Page 1'}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </Button>

      {open ? (
        <Surface className="touch-targets absolute top-10 left-0 z-30 flex w-64 flex-col gap-0.5 p-1.5">
          <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
            Pages
          </div>
          <div className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
            {ordered.map((page, i) => {
              const active = page.id === currentPageId;
              if (editingId === page.id) {
                return (
                  <PageRenameRow
                    key={page.id}
                    initial={page.name}
                    onCommit={(name) => {
                      renamePage(page.id, name);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }
              return (
                <div
                  key={page.id}
                  className={cn(
                    'group flex items-center gap-0.5 rounded-md pl-1.5 pr-1',
                    active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPage(page.id);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm"
                  >
                    <Check
                      className={cn(
                        'size-3.5 shrink-0',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{page.name}</span>
                  </button>
                  <div className="touch-reveal flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Move page up"
                      disabled={i === 0}
                      onClick={() => movePage(page.id, 'up')}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Move page down"
                      disabled={i === ordered.length - 1}
                      onClick={() => movePage(page.id, 'down')}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Rename page"
                      onClick={() => setEditingId(page.id)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete page"
                      disabled={ordered.length <= 1}
                      onClick={() => deletePage(page.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="my-1 h-px bg-border" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              createPage();
              setOpen(false);
            }}
            className="justify-start gap-1.5"
          >
            <Plus className="size-4" />
            New page
          </Button>
        </Surface>
      ) : null}
    </div>
  );
}

function PageRenameRow({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCommit(value)}
      className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    />
  );
}
