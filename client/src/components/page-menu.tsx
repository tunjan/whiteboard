import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Copy,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  createPage,
  deletePage,
  duplicatePage,
  movePage,
  movePageToIndex,
  renamePage,
} from '@/canvas/page-actions';
import { setCurrentPage, useDocumentStore } from '@/canvas/use-document-store';
import {
  LIST_VERTICAL_PADDING,
  SortableList,
  type SortableHandleProps,
} from '@/components/sortable-list';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import { useBoardAccessStore } from '@/board/board-access';

const PAGE_ROW_HEIGHT = 40;
/** Coarse pointers grow controls to 44px, so rows need extra room to not touch. */
const PAGE_ROW_HEIGHT_COARSE = 48;
const PAGE_LIST_HEIGHT_KEY = 'whiteboard:page-menu-height:v2';
const PAGE_LIST_MAX_HEIGHT = 800;
const HEADER_HEIGHT = 34;
/** Reserved for the footer at its resting size. Held constant so opening the
 *  create form grows the popover instead of resizing the list under the cursor. */
const FOOTER_HEIGHT = 48;
const RESIZE_HINT =
  'Drag to resize. Press Enter or double-click to fit the list to its pages.';
/** Holds the drag-handle / actions slots open while a row is renaming, so the
 *  name stays exactly where it was instead of sliding across the row. */
const ROW_SLOT_SPACER = 'size-6 shrink-0 [@media(pointer:coarse)]:size-11';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Scoped per board so a tall list on a 20-page board does not follow the user
 *  to a 2-page one. */
function pageListHeightKey(boardId: string): string {
  return `${PAGE_LIST_HEIGHT_KEY}:${boardId}`;
}

function storedPageListHeight(boardId: string): number | null {
  if (!boardId) return null;
  try {
    const value = Number(
      window.localStorage.getItem(pageListHeightKey(boardId)),
    );
    return Number.isFinite(value) && value >= PAGE_ROW_HEIGHT ? value : null;
  } catch {
    return null;
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Default name for a new page: when it was made, as `Mon 10 Aug 11:50`.
 *  Spelled out rather than formatted by locale so the shape stays the same
 *  for everyone on the board. */
function nextPageName(now = new Date()): string {
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${hours}:${minutes}`;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/**
 * Page switcher for a board, docked in the top-left chrome. Page state lives in
 * the shared Yjs document, so changes appear immediately for every collaborator.
 */
export function PageMenu() {
  const boardId = useDocumentStore((state) => state.boardId);
  const pages = useDocumentStore((state) => state.doc.pages);
  const pageOrder = useDocumentStore((state) => state.doc.pageOrder);
  const currentPageId = useDocumentStore((state) => state.currentPageId);
  const coarsePointer = useCoarsePointer();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [reopenAfterDelete, setReopenAfterDelete] = useState(false);
  const [userListHeight, setUserListHeight] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(
    () => window.innerHeight,
  );

  const ordered = pageOrder
    .map((id) => pages[id])
    .filter((page): page is NonNullable<typeof page> => Boolean(page));
  const current = pages[currentPageId];
  const pageToDelete = deleteId ? pages[deleteId] : undefined;
  const rowHeight = coarsePointer ? PAGE_ROW_HEIGHT_COARSE : PAGE_ROW_HEIGHT;
  const formOpen = creating || Boolean(editingId && pages[editingId]);
  // A view-only link can move between pages but not change them.
  const viewOnly = useBoardAccessStore((s) => s.access === 'view');
  const listMaxHeight = Math.max(
    rowHeight + LIST_VERTICAL_PADDING,
    Math.min(PAGE_LIST_MAX_HEIGHT, viewportHeight * 0.62) -
      HEADER_HEIGHT -
      FOOTER_HEIGHT -
      12,
  );
  const autoListHeight =
    Math.max(rowHeight, ordered.length * rowHeight) + LIST_VERTICAL_PADDING;
  const listHeight = Math.round(
    Math.min(userListHeight ?? autoListHeight, listMaxHeight),
  );

  const resetDraft = () => {
    setEditingId(null);
    setCreating(false);
    setCreateError(null);
  };

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetDraft();
  };

  // The confirm dialog is modal, so the popover has to yield to it. Restoring
  // it afterwards keeps the user's place in the list on both paths.
  const closeDeleteDialog = () => {
    setDeleteId(null);
    if (reopenAfterDelete) {
      setReopenAfterDelete(false);
      setOpen(true);
    }
  };

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setUserListHeight(storedPageListHeight(boardId));
  }, [boardId]);

  useEffect(() => {
    if (userListHeight === null || !boardId) return;
    try {
      window.localStorage.setItem(
        pageListHeightKey(boardId),
        String(userListHeight),
      );
    } catch {
      // Resizing remains available when browser storage is blocked.
    }
  }, [boardId, userListHeight]);

  return (
    <>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Pages, current page: ${current?.name ?? 'Page 1'}`}
              className="max-w-[clamp(4.5rem,18vw,11.25rem)] rounded-control px-2 text-fg-secondary"
            />
          }
        >
          <span className="truncate">{current?.name ?? 'Page 1'}</span>
          {/* Says "this opens a list", which a bare page name did not. */}
          <ChevronDown aria-hidden="true" className="-mr-0.5 size-3.5 text-fg-muted" />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={10}
          className={cn(
            CHROME_CONTROLS,
            'w-[min(16rem,calc(100vw-2rem))] gap-0 p-0',
          )}
        >
          <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
            <PopoverTitle className="text-xs font-medium text-fg-muted">
              Pages
            </PopoverTitle>
            <span className="text-xs text-fg-muted tabular-nums">
              {ordered.length}
            </span>
          </div>

          <SortableList
            items={ordered}
            height={listHeight}
            rowHeight={rowHeight}
            label="Board pages"
            revealId={currentPageId}
            getItemLabel={(page) => page.name}
            disabled={formOpen || viewOnly}
            onReorder={movePageToIndex}
          >
            {(page, index, dragHandleProps, dragging) => {
              const active = page.id === currentPageId;
              const renaming = editingId === page.id;

              return (
                <div
                  className={cn(
                    'flex w-full items-center gap-1 rounded-md pr-0.5',
                    dragging && 'bg-surface shadow-hover',
                  )}
                >
                  {/* Selection gets its own channel so it never reads as focus. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-5 w-[3px] shrink-0 rounded-full transition-colors',
                      active ? 'bg-selected' : 'bg-transparent',
                    )}
                  />
                  {renaming ? (
                    <>
                      <span aria-hidden="true" className={ROW_SLOT_SPACER} />
                      <PageInlineRename
                        initialValue={page.name}
                        onSubmit={(name) => {
                          renamePage(page.id, name);
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                      <span aria-hidden="true" className={ROW_SLOT_SPACER} />
                    </>
                  ) : (
                    <>
                      <PageDragHandle
                        dragHandleProps={dragHandleProps}
                        disabled={formOpen || viewOnly}
                      />
                      <Button
                        variant={active ? 'secondary' : 'ghost'}
                        size="sm"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setCurrentPage(page.id)}
                        onDoubleClick={() => {
                          if (viewOnly) return;
                          setCreating(false);
                          setEditingId(page.id);
                        }}
                        className={cn(
                          'min-w-0 flex-1 justify-start',
                          active && 'font-medium text-fg',
                        )}
                      >
                        <span className="truncate">{page.name}</span>
                      </Button>
                      {viewOnly ? null : (
                        <PageActions
                          pageName={page.name}
                          canMoveUp={index > 0}
                          canMoveDown={index < ordered.length - 1}
                          canDelete={ordered.length > 1}
                          onRename={() => {
                            setCreating(false);
                            // Let the menu finish closing first. It restores
                            // focus on the way out, which would otherwise blur
                            // the editor the moment the row swaps it in.
                            window.setTimeout(() => setEditingId(page.id), 0);
                          }}
                          // Duplicating waits on the source page's document when
                          // it is not the page on screen; nothing here depends on
                          // the result, and the switch to the copy is what shows.
                          onDuplicate={() => void duplicatePage(page.id)}
                          onMoveUp={() => movePage(page.id, 'up')}
                          onMoveDown={() => movePage(page.id, 'down')}
                          onDelete={() => {
                            setOpen(false);
                            setReopenAfterDelete(true);
                            setDeleteId(page.id);
                          }}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            }}
          </SortableList>

          <PageListResizeHandle
            height={listHeight}
            min={PAGE_ROW_HEIGHT}
            max={Math.round(listMaxHeight)}
            onChange={setUserListHeight}
            onReset={() => setUserListHeight(null)}
          />

          <div className={cn('px-1 pb-1', viewOnly && 'hidden')}>
            {creating ? (
              <PageNameForm
                key={`create-${ordered.length}`}
                initialValue={nextPageName()}
                label="New Page"
                error={createError}
                onSubmit={(name) => {
                  setCreateError(null);
                  if (!createPage(name)) {
                    setCreateError('Could not create the page. Try again.');
                    return;
                  }
                  setCreating(false);
                }}
                onCancel={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setCreating(true);
                }}
                className="w-full justify-start"
              >
                <Plus data-icon="inline-start" />
                New Page
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={Boolean(pageToDelete)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeDeleteDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Page?</AlertDialogTitle>
            <AlertDialogDescription>
              {pageToDelete
                ? `“${pageToDelete.name}” and everything on it will be permanently deleted.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) deletePage(deleteId);
                closeDeleteDialog();
              }}
            >
              Delete Page
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PageDragHandle({
  dragHandleProps,
  disabled,
}: {
  dragHandleProps: SortableHandleProps;
  disabled: boolean;
}) {
  return (
    <Button
      {...dragHandleProps}
      type="button"
      variant="ghost"
      size="icon-xs"
      disabled={disabled}
      className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
    >
      <GripVertical />
    </Button>
  );
}

function PageActions({
  pageName,
  canMoveUp,
  canMoveDown,
  canDelete,
  onRename,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  pageName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`More actions for ${pageName}`}
          />
        }
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
            <ArrowUp />
            Move Up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
            <ArrowDown />
            Move Down
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={!canDelete}
            onClick={onDelete}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PageListResizeHandle({
  height,
  min,
  max,
  onChange,
  onReset,
}: {
  height: number;
  min: number;
  max: number;
  onChange: (height: number) => void;
  onReset: () => void;
}) {
  const pointerRef = useRef<{
    pointerId: number;
    startHeight: number;
    startY: number;
  } | null>(null);

  const hintId = useId();
  const resize = (nextHeight: number) => onChange(clamp(nextHeight, min, max));

  return (
    <div
      role="separator"
      aria-label="Resize page list"
      aria-describedby={hintId}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={height}
      aria-valuetext={`${height} pixels`}
      tabIndex={0}
      title={RESIZE_HINT}
      className="group/resize flex h-3.5 touch-none cursor-row-resize items-center justify-center rounded-sm"
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          resize(height - PAGE_ROW_HEIGHT);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          resize(height + PAGE_ROW_HEIGHT);
        } else if (event.key === 'Home') {
          event.preventDefault();
          resize(min);
        } else if (event.key === 'End') {
          event.preventDefault();
          resize(max);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          onReset();
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerRef.current = {
          pointerId: event.pointerId,
          startHeight: height,
          startY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        resize(pointer.startHeight + event.clientY - pointer.startY);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current?.pointerId === event.pointerId) {
          pointerRef.current = null;
        }
      }}
      onPointerCancel={(event) => {
        if (pointerRef.current?.pointerId === event.pointerId) {
          pointerRef.current = null;
        }
      }}
      onLostPointerCapture={(event) => {
        if (pointerRef.current?.pointerId === event.pointerId) {
          pointerRef.current = null;
        }
      }}
    >
      <span
        aria-hidden="true"
        className="h-1 w-8 rounded-full bg-border transition-colors group-hover/resize:bg-strong group-focus-visible/resize:bg-strong motion-reduce:transition-none"
      />
      <span id={hintId} className="sr-only">
        {RESIZE_HINT}
      </span>
    </div>
  );
}

/**
 * Rename in place, in the row being renamed. Enter or blur commits, Escape
 * reverts; an empty name reverts rather than raising an error the row cannot fit.
 */
function PageInlineRename({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const settledRef = useRef(false);
  const armedRef = useRef(false);

  const settle = (commit: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = value.trim();
    if (commit && trimmed && trimmed !== initialValue) onSubmit(trimmed);
    else onCancel();
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // Blur only counts as "user left the field" once focus has actually
    // settled here for a frame; anything sooner is another popup's focus
    // restore landing after mount.
    const frame = requestAnimationFrame(() => {
      armedRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Input
      ref={inputRef}
      value={value}
      aria-label="Page name"
      autoComplete="off"
      // Sized and padded like the row's name button so the label is edited in
      // place. The app-wide focus outline is traded for a border and a soft
      // halo — a caret in a field this small needs no 2px ring around it —
      // but both are the accent, because that is what focus is everywhere
      // else in this chrome and a field is not the place to invent a second.
      className={cn(
        'h-8 min-w-0 flex-1 rounded-md border-transparent bg-panel px-3 font-medium text-fg',
        'text-base sm:text-sm [@media(pointer:coarse)]:h-11',
        'focus:border-focus focus:bg-surface focus:shadow-focus',
        'focus-visible:outline-none',
      )}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        if (!armedRef.current) {
          event.currentTarget.focus();
          return;
        }
        settle(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          settle(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
    />
  );
}

function PageNameForm({
  initialValue,
  label,
  error,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  label: string;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const invalid = (touched && !trimmed) || Boolean(error);

  const submit = () => {
    setTouched(true);
    if (!trimmed) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    onSubmit(trimmed);
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="flex flex-col gap-2.5 rounded-lg border border-border bg-panel p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === 'Enter' && event.target === inputRef.current) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <FieldGroup className="gap-2">
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          <Input
            ref={inputRef}
            id={inputId}
            value={value}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Page Name"
            autoComplete="off"
            className="h-9"
          />
          {invalid ? (
            <FieldError id={errorId}>
              {error ?? 'Enter a page name.'}
            </FieldError>
          ) : null}
        </Field>
      </FieldGroup>
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="xs"
          onPointerDown={(event) => event.preventDefault()}
        >
          Create Page
        </Button>
      </div>
    </form>
  );
}
