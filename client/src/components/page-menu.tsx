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
import { Separator } from '@/components/ui/separator';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

const ACTIVE_PAGE_CLASS =
  'bg-bg-muted font-medium text-content-emphasis';

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
        // Commit any in-progress rename (via its onBlur handler) before the
        // click's re-render unmounts the input — unmounting alone would
        // silently discard the typed value.
        (document.activeElement as HTMLElement | null)?.blur();
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
        className="max-w-[clamp(4.5rem,18vw,11.25rem)] rounded-lg px-2 font-medium"
      >
        <span className="truncate">{current?.name ?? 'Page 1'}</span>
        <ChevronDown className="opacity-60" />
      </Button>

      {open ? (
        <Surface className="touch-targets absolute top-10 left-0 z-30 flex w-64 flex-col gap-1 p-2 shadow-hover">
          <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
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
                    'group flex items-center gap-1 rounded-md pl-2 pr-1',
                    active ? ACTIVE_PAGE_CLASS : 'hover:bg-bg-muted',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPage(page.id);
                      setOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
                  >
                    <Check
                      className={cn(
                        'size-3.5 shrink-0',
                        active
                          ? 'text-content-info opacity-100'
                          : 'opacity-0',
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
          <Separator className="my-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              createPage();
              setOpen(false);
            }}
            className="justify-start gap-2"
          >
            <Plus />
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
      className="h-8 w-full rounded-md border border-border-subtle bg-bg-default px-2 text-sm text-content-emphasis outline-none focus-visible:border-border-emphasis focus-visible:ring-4 focus-visible:ring-border-subtle"
    />
  );
}
