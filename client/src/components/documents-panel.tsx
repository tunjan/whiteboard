import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Presentation,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  INLINE_DOCUMENT_EXTS,
  type BoardDocumentMeta,
} from '@whiteboard/shared';
import { markDocumentOpened } from '@/board/document-notifications';
import {
  addFilesToRepository,
  cancelUpload,
  documentUrl,
  retryUpload,
} from '@/board/documents';
import { removeBoardDocument } from '@/canvas/use-document-store';
import { useDocumentsStore } from '@/canvas/use-documents-store';
import type { Identity } from '@/collab/identity';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact file size — whole numbers under 10 units, else one decimal. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Accessible name for the trigger — the dot's meaning, spelled out. */
function filesLabel(fileCount: number, unreadCount: number): string {
  const count = fileCount ? ` (${fileCount})` : '';
  const unread = unreadCount ? `, ${unreadCount} unread` : '';
  return `Files${count}${unread}`;
}

const EXT_ICON: Record<string, typeof File> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  ppt: Presentation,
  pptx: Presentation,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  txt: FileText,
  md: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  webp: FileImage,
  gif: FileImage,
  zip: FileArchive,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * The unread mark: a filled disc notched out of whatever it sits on, so it
 * reads as a badge pinned to the icon rather than as part of it.
 *
 * `ring-*` is the cutaway colour — it has to be whatever actually paints
 * behind the dot (the chrome's `surface`, or the row's `panel` on hover), the
 * same trick the avatar stack uses for overlapping discs.
 */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute size-2 rounded-full bg-danger ring-2',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-safe:duration-200 motion-safe:ease-[var(--ease-out-expo)]',
        className,
      )}
    />
  );
}

/** Ghost icon-button with tooltip — used for row-level actions. */
function RowAction({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            onClick={onClick}
            className={cn(
              'text-fg-muted',
              danger && 'hover:bg-danger-bg hover:text-danger',
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function DocumentRow({
  meta,
  unread,
  onDelete,
}: {
  meta: BoardDocumentMeta;
  unread: boolean;
  onDelete: () => void;
}) {
  const href = documentUrl(meta);
  const opensInTab = INLINE_DOCUMENT_EXTS.has(meta.ext);
  const ExtIcon = EXT_ICON[meta.ext] ?? File;

  const download = () => {
    markDocumentOpened(meta.id);
    const a = document.createElement('a');
    a.href = href;
    a.download = meta.name;
    a.click();
  };

  return (
    <div
      className={cn(
        'group/row flex items-center gap-2.5 rounded-md px-2 py-1.5',
        'transition-colors duration-instant ease-out-quart',
        'hover:bg-[var(--chrome-hover,var(--color-panel))]',
      )}
    >
      {/* File-type icon, with the unread mark pinned to its top-right */}
      <span className="relative shrink-0">
        <ExtIcon className="size-4 text-fg-muted" strokeWidth={1.5} />
        {unread ? (
          <UnreadDot className="-top-1 -right-1 ring-surface group-hover/row:ring-panel" />
        ) : null}
      </span>

      {/* The link covers both lines: name, then who brought it and how big */}
      <a
        href={href}
        target={opensInTab ? '_blank' : undefined}
        rel="noreferrer"
        download={opensInTab ? undefined : meta.name}
        className="min-w-0 flex-1 rounded-sm"
        aria-label={`Open ${meta.name}${unread ? ' (unread)' : ''}`}
        onClick={() => markDocumentOpened(meta.id)}
      >
        <span
          className={cn(
            'block truncate text-sm text-fg',
            unread ? 'font-semibold' : 'font-medium',
          )}
        >
          {meta.name}
        </span>
        <span className="block truncate text-xs text-fg-muted">
          {meta.uploadedBy ? `${meta.uploadedBy} · ` : null}
          <span className="font-mono tabular-nums">
            {formatBytes(meta.size)}
          </span>
        </span>
      </a>

      {/* Row actions — revealed on hover, always visible on touch and on focus */}
      <div
        className={cn(
          'touch-reveal flex shrink-0 items-center',
          'opacity-0 transition-opacity duration-instant group-hover/row:opacity-100 group-focus-within/row:opacity-100',
        )}
      >
        <RowAction label="Download" onClick={download}>
          <Download className="size-3.5" />
        </RowAction>
        <RowAction label="Delete" onClick={onDelete} danger>
          <Trash2 className="size-3.5" />
        </RowAction>
      </div>
    </div>
  );
}

function UploadRow({
  uploadId,
  name,
  progress,
  error,
  onRetry,
}: {
  uploadId: string;
  name: string;
  progress: number;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <Upload className="size-4 shrink-0 text-fg-muted" strokeWidth={1.5} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{name}</p>
        {error ? (
          <p className="truncate text-xs text-danger">{error}</p>
        ) : (
          // The bar is the progress readout — a percentage beside it says the
          // same thing twice.
          <Progress
            className="mt-1.5"
            value={Math.round(progress * 100)}
            aria-label={`Uploading ${name}`}
          />
        )}
      </div>

      <div className="flex shrink-0 items-center">
        {error ? (
          <RowAction label="Retry" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
          </RowAction>
        ) : null}
        <RowAction
          label={error ? 'Dismiss' : 'Cancel'}
          onClick={() => cancelUpload(uploadId)}
        >
          <X className="size-3.5" />
        </RowAction>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * The board's shared file repository — a Files button in the chrome opening a
 * popover everyone on the board can add to and remove from.
 *
 * One flat surface: header, list, one way in. The list is newest-first, so a
 * row carries who added it and how big it is and leaves the date to the order.
 */
export function DocumentsPanel({
  identity,
  showLabel = false,
  toolbarItem = false,
}: {
  identity: Identity | null;
  showLabel?: boolean;
  toolbarItem?: boolean;
}) {
  const documents = useDocumentsStore((s) => s.documents);
  const uploads = useDocumentsStore((s) => s.uploads);
  const unread = useDocumentsStore((s) => s.unread);
  const open = useDocumentsStore((s) => s.panelOpen);
  const setOpen = useDocumentsStore((s) => s.setPanelOpen);

  const [pendingDelete, setPendingDelete] = useState<BoardDocumentMeta | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploaderName = identity?.name ?? 'Someone';
  const list = Object.values(documents).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  const uploadList = Object.values(uploads);
  const fileCount = list.length;
  const unreadCount = list.filter((meta) => unread.has(meta.id)).length;
  const triggerLabel = filesLabel(fileCount, unreadCount);

  const add = (files: File[]) => {
    if (files.length) addFilesToRepository(files, uploaderName);
  };

  const confirmDelete = () => {
    if (pendingDelete) removeBoardDocument(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  data-toolbar-item={toolbarItem || undefined}
                  tabIndex={toolbarItem ? -1 : undefined}
                  aria-label={triggerLabel}
                  className={cn(
                    buttonVariants({
                      variant: 'ghost',
                      size: showLabel ? 'sm' : 'icon-sm',
                    }),
                    toolbarItem && 'bg-surface',
                  )}
                />
              }
            >
              {/*
               * The icon is wrapped so the dot can hang off *it* rather than
               * off the button — in the labelled layout the button's own
               * top-right corner is a whole label away from the icon. Wrapping
               * costs the icon its automatic size, so it comes back here.
               */}
              <span className="relative flex shrink-0 items-center">
                <Folder
                  aria-hidden="true"
                  className={showLabel ? 'size-3.5' : 'size-4'}
                />
                {unreadCount > 0 ? (
                  <UnreadDot className="-top-1 -right-1 ring-surface group-hover/button:ring-[var(--chrome-hover,var(--color-panel))]" />
                ) : null}
              </span>
              {showLabel ? <span>Files</span> : null}
            </TooltipTrigger>
            <TooltipContent side="bottom">{triggerLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={10}
          className={cn(
            CHROME_CONTROLS,
            'relative w-[min(20rem,calc(100vw-2rem))] gap-4 p-4',
            'data-[side=bottom]:origin-top-right',
          )}
          onDragOver={(e: DragEvent) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e: DragEvent) => {
            // Crossing between rows fires a leave on the way out of each child;
            // only a pointer that has actually left the panel counts.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDragOver(false);
            }
          }}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            add(Array.from(e.dataTransfer.files));
          }}
        >
          <PopoverHeader className="flex-row items-center justify-between gap-3">
            <PopoverTitle>Files</PopoverTitle>
            {fileCount > 0 ? (
              <span className="shrink-0 text-xs text-fg-muted">
                <span className="font-mono tabular-nums">{fileCount}</span>{' '}
                {fileCount === 1 ? 'file' : 'files'}
              </span>
            ) : null}
          </PopoverHeader>

          {fileCount === 0 && uploadList.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <Folder
                className="size-5 text-fg-subtle"
                strokeWidth={1.5}
                aria-hidden
              />
              <p className="text-sm text-fg-muted">Drop files here</p>
            </div>
          ) : (
            <div className="scrollbar-none -mx-2 flex max-h-72 flex-col overflow-y-auto px-2">
              {/* Uploads in flight sit above the settled list */}
              {uploadList.map((upload) => (
                <UploadRow
                  key={upload.id}
                  uploadId={upload.id}
                  name={upload.name}
                  progress={upload.progress}
                  error={upload.error}
                  onRetry={() => retryUpload(upload.id, uploaderName)}
                />
              ))}
              {list.map((meta) => (
                <DocumentRow
                  key={meta.id}
                  meta={meta}
                  unread={unread.has(meta.id)}
                  onDelete={() => setPendingDelete(meta)}
                />
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 w-full"
            onClick={() => inputRef.current?.click()}
          >
            <Upload aria-hidden="true" />
            Add files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />

          {/* Drag feedback covers the panel rather than replacing its contents,
              so the list doesn't vanish out from under the cursor. */}
          {dragOver ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-overlay border-2 border-dashed border-border-strong bg-surface/95"
            >
              <Upload className="size-5 text-fg-secondary" strokeWidth={1.5} />
              <p className="text-sm text-fg-secondary">Drop to add</p>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-medium text-fg">
                {pendingDelete?.name}
              </strong>{' '}
              will be removed for everyone. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Cancel is focused by default — the safe path */}
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
