import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  EllipsisVertical,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAnimationStore } from '@/animation/use-animation-store';
import {
  createPage,
  deletePage,
  movePage,
  movePageToIndex,
  renamePage,
  setCurrentPage,
  useDocumentStore,
} from '@/canvas/use-document-store';
import {
  SortableList,
  type SortableHandleProps,
} from '@/components/sortable-list';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const PAGE_ROW_HEIGHT = 40;
const PAGE_LIST_HEIGHT_KEY = 'whiteboard:page-menu-height:v1';
const PAGE_LIST_MAX_HEIGHT = 800;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function storedPageListHeight(): number | null {
  try {
    const value = Number(window.localStorage.getItem(PAGE_LIST_HEIGHT_KEY));
    return Number.isFinite(value) && value >= PAGE_ROW_HEIGHT ? value : null;
  } catch {
    return null;
  }
}

/**
 * Page switcher for a board, docked in the top-left chrome. Page state lives in
 * the shared Yjs document, so changes appear immediately for every collaborator.
 */
export function PageMenu() {
  const pages = useDocumentStore((state) => state.doc.pages);
  const pageOrder = useDocumentStore((state) => state.doc.pageOrder);
  const currentPageId = useDocumentStore((state) => state.currentPageId);
  const pageLocked = useAnimationStore(
    (state) => state.playbackActive || state.recordingPageId !== null,
  );
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [userListHeight, setUserListHeight] = useState(storedPageListHeight);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

  const ordered = pageOrder
    .map((id) => pages[id])
    .filter((page): page is NonNullable<typeof page> => Boolean(page));
  const current = pages[currentPageId];
  const pageToDelete = deleteId ? pages[deleteId] : undefined;
  const pageBeingEdited = editingId ? pages[editingId] : undefined;
  const formOpen = creating || Boolean(pageBeingEdited);
  const footerHeight = formOpen ? 140 : 48;
  const listMaxHeight = Math.max(
    PAGE_ROW_HEIGHT,
    Math.min(PAGE_LIST_MAX_HEIGHT, viewportHeight * 0.62) - footerHeight - 12,
  );
  const autoListHeight = Math.max(PAGE_ROW_HEIGHT, ordered.length * PAGE_ROW_HEIGHT);
  const listHeight = Math.round(
    Math.min(userListHeight ?? autoListHeight, listMaxHeight),
  );

  const resetDraft = () => {
    setEditingId(null);
    setCreating(false);
  };

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetDraft();
  };

  useEffect(() => {
    if (!pageLocked) return;
    setOpen(false);
    setEditingId(null);
    setCreating(false);
  }, [pageLocked]);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (userListHeight === null) return;
    try {
      window.localStorage.setItem(PAGE_LIST_HEIGHT_KEY, String(userListHeight));
    } catch {
      // Resizing remains available when browser storage is blocked.
    }
  }, [userListHeight]);

  return (
    <>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Pages, current page: ${current?.name ?? 'Page 1'}`}
              disabled={pageLocked}
              className="max-w-[clamp(4.5rem,18vw,11.25rem)] px-2"
            />
          }
        >
          <span className="truncate">{current?.name ?? 'Page 1'}</span>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={10}
          className="touch-targets w-[min(15rem,calc(100vw-2rem))] gap-0 p-0"
        >


          <SortableList
            items={ordered}
            height={listHeight}
            rowHeight={PAGE_ROW_HEIGHT}
            label="Board pages"
            getItemLabel={(page) => page.name}
            disabled={pageLocked || formOpen}
            onReorder={movePageToIndex}
          >
            {(page, index, dragHandleProps, dragging) => {
              const active = page.id === currentPageId;

              return (
                <div
                  className={cn(
                    'flex w-full items-center gap-1 rounded-md',
                    dragging && 'bg-bg-default shadow-hover',
                  )}
                >
                  <PageDragHandle
                    dragHandleProps={dragHandleProps}
                    disabled={formOpen}
                  />
                  <Button
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      setCurrentPage(page.id);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      setCreating(false);
                      setEditingId(page.id);
                    }}
                    title="Double-click to rename"
                    className="min-w-0 flex-1 justify-start"
                  >
                    <span className="truncate">{page.name}</span>
                  </Button>
                  <PageActions
                    pageName={page.name}
                    canMoveUp={index > 0}
                    canMoveDown={index < ordered.length - 1}
                    canDelete={ordered.length > 1}
                    onRename={() => {
                      setCreating(false);
                      setEditingId(page.id);
                    }}
                    onMoveUp={() => movePage(page.id, 'up')}
                    onMoveDown={() => movePage(page.id, 'down')}
                    onDelete={() => {
                      changeOpen(false);
                      setDeleteId(page.id);
                    }}
                  />
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

          <div className="px-1 pb-1">
            {pageBeingEdited ? (
              <PageNameForm
                key={`rename-${pageBeingEdited.id}`}
                initialValue={pageBeingEdited.name}
                submitLabel="Save"
                label="Rename page"
                onSubmit={(name) => {
                  renamePage(pageBeingEdited.id, name);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : creating ? (
              <PageNameForm
                key={`create-${ordered.length}`}
                initialValue={`Page ${ordered.length + 1}`}
                submitLabel="Create"
                label="New page"
                onSubmit={(name) => {
                  const id = createPage(name);
                  if (id) changeOpen(false);
                }}
                onCancel={() => setCreating(false)}
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
                New page
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog
        open={Boolean(pageToDelete)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete page?</DialogTitle>
            <DialogDescription>
              {pageToDelete
                ? `“${pageToDelete.name}” and everything on it will be permanently deleted.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteId) deletePage(deleteId);
                setDeleteId(null);
              }}
            >
              Delete page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  pageName: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  onRename: () => void;
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
          <DropdownMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
            <ArrowDown />
            Move down
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

  const resize = (nextHeight: number) => onChange(clamp(nextHeight, min, max));

  return (
    <div
      role="separator"
      aria-label="Resize page list. Press Enter to fit content."
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={height}
      aria-valuetext={`${height} pixels`}
      tabIndex={0}
      title="Drag to resize. Double-click to fit content."
      className="flex h-3 touch-none cursor-row-resize items-center px-3 outline-none focus-visible:ring-4 focus-visible:ring-border-subtle"
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
      <Separator />
    </div>
  );
}

function PageNameForm({
  initialValue,
  submitLabel,
  label,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  submitLabel: 'Create' | 'Save';
  label: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const trimmed = value.trim();
  const invalid = touched && !trimmed;

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
      className="flex flex-col gap-2 rounded-lg bg-bg-muted p-2"
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
        <Field invalid={invalid} data-invalid={invalid || undefined}>
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          <Input
            ref={inputRef}
            id={inputId}
            value={value}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Page name"
            autoComplete="off"
            className="h-9"
          />
          {invalid ? (
            <FieldError id={errorId} match>
              Enter a page name.
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
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
