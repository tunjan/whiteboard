import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files,
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
import {
  addFilesToRepository,
  cancelUpload,
  documentUrl,
  retryUpload,
} from '@/board/documents';
import { removeBoardDocument } from '@/canvas/use-document-store';
import { useDocumentsStore } from '@/canvas/use-documents-store';
import type { Identity } from '@/collab/identity';
import { Button } from '@/components/ui/button';
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
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
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
              // 32×32 ghost icon — colour on hover only
              'size-8 rounded-md text-tertiary transition-[background-color,color] duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)]',
              danger
                ? 'hover:bg-danger-bg hover:text-danger'
                : 'hover:bg-subtle hover:text-primary',
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
// Completed document row
// ---------------------------------------------------------------------------

function DocumentRow({
  meta,
  onDelete,
}: {
  meta: BoardDocumentMeta;
  onDelete: () => void;
}) {
  const href = documentUrl(meta);
  const opensInTab = INLINE_DOCUMENT_EXTS.has(meta.ext);

  const download = () => {
    const a = document.createElement('a');
    a.href = href;
    a.download = meta.name;
    a.click();
  };

  const ExtIcon = EXT_ICON[meta.ext] ?? File;

  const dateLabel = new Date(meta.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div
      className={cn(
        // e0 in-flow card; hover changes surface only, no lift
        'group/row flex items-center gap-2.5 rounded-lg px-3 py-2',
        'transition-[background-color,border-color] duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'hover:bg-subtle',
      )}
    >
      {/* File-type icon */}
      <ExtIcon
        size={16}
        strokeWidth={1.5}
        className="shrink-0 text-tertiary transition-colors duration-[80ms] group-hover/row:text-secondary"
      />

      {/* Name + meta — the link covers both lines */}
      <a
        href={href}
        target={opensInTab ? '_blank' : undefined}
        rel="noreferrer"
        download={opensInTab ? undefined : meta.name}
        className="min-w-0 flex-1 rounded-sm"
        aria-label={`Open ${meta.name}`}
      >
        {/* Primary label — sentence-case filename */}
        <span className="block truncate text-sm font-medium text-primary leading-[20px]">
          {meta.name}
        </span>
        {/* Secondary meta — size · uploader · date in tabular mono */}
        <span className="block truncate text-xs leading-[16px] text-tertiary">
          <span className="font-mono tabular-nums">{formatBytes(meta.size)}</span>
          {meta.uploadedBy ? (
            <span className="mx-1 text-[10px]">·</span>
          ) : null}
          {meta.uploadedBy ? (
            <span>{meta.uploadedBy}</span>
          ) : null}
          <span className="mx-1 text-[10px]">·</span>
          <span className="font-mono tabular-nums">{dateLabel}</span>
        </span>
      </a>

      {/* Row actions — revealed on hover / always visible on focus inside */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          // Hide for mouse users until the row is hovered; always show on touch
          'opacity-0 transition-opacity duration-[80ms] group-hover/row:opacity-100 group-focus-within/row:opacity-100',
          'touch-reveal',
        )}
      >
        <RowAction label="Download" onClick={download}>
          <Download size={14} strokeWidth={1.5} />
        </RowAction>
        <RowAction label="Delete" onClick={onDelete} danger>
          <Trash2 size={14} strokeWidth={1.5} />
        </RowAction>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// In-progress upload row
// ---------------------------------------------------------------------------

function UploadRow({
  uploadId,
  name,
  size,
  progress,
  error,
  onRetry,
}: {
  uploadId: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  onRetry: () => void;
}) {
  const pct = Math.round(progress * 100);
  const uploaded = formatBytes(Math.round(size * progress));
  const total = formatBytes(size);

  return (
    <div
      className={cn(
        // Slightly sunken card — panel bg + border so it reads as an in-progress chip
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
        error
          ? 'border-danger-border bg-danger-bg'
          : 'border-border bg-subtle',
      )}
    >
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {error ? (
          <AlertTriangle
            size={14}
            strokeWidth={1.75}
            className="text-danger"
            aria-hidden
          />
        ) : (
          <Upload
            size={14}
            strokeWidth={1.5}
            className="text-tertiary"
            aria-hidden
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Filename */}
        <p className="truncate text-xs font-medium leading-[16px] text-primary">
          {name}
        </p>

        {error ? (
          /* Error message */
          <p className="mt-0.5 truncate text-xs leading-[16px] text-danger">
            {error}
          </p>
        ) : (
          /* Progress feedback */
          <>
            <p className="mt-0.5 font-mono text-xs tabular-nums leading-[16px] text-tertiary">
              {uploaded} of {total}
            </p>
            {/* Progress bar — inset radius = 0 (full pill) */}
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${name}: ${pct}%`}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5">
        {error ? (
          <RowAction label="Retry upload" onClick={onRetry}>
            <RefreshCw size={14} strokeWidth={1.5} />
          </RowAction>
        ) : null}
        <RowAction
          label={error ? 'Dismiss' : 'Cancel upload'}
          onClick={() => cancelUpload(uploadId)}
        >
          <X size={14} strokeWidth={1.5} />
        </RowAction>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <Files
        size={20}
        strokeWidth={1.5}
        className="mb-2 text-tertiary"
        aria-hidden
      />
      <p className="text-sm font-medium text-secondary">No documents yet</p>
      <p className="mt-1 max-w-[220px] text-xs leading-[18px] text-tertiary">
        Add a PDF, worksheet, or image to share it with everyone on this board.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drop-zone overlay (shown while dragging a file over the popover)
// ---------------------------------------------------------------------------

function DropZoneOverlay() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10">
      <Upload size={20} strokeWidth={1.5} className="text-secondary" aria-hidden />
      <p className="text-sm font-medium text-secondary">Drop to add</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * The board's shared document repository — a Files button in the chrome
 * opening a popover that everyone on the board can add to and remove from.
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
  const open = useDocumentsStore((s) => s.panelOpen);
  const setOpen = useDocumentsStore((s) => s.setPanelOpen);

  const [pendingDelete, setPendingDelete] = useState<BoardDocumentMeta | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploaderName = identity?.name ?? 'Someone';
  const list = Object.values(documents).sort((a, b) => b.createdAt - a.createdAt);
  const uploadList = Object.values(uploads);
  const totalBytes = list.reduce((sum, meta) => sum + meta.size, 0);
  const fileCount = list.length;

  const add = (files: File[]) => {
    if (files.length) addFilesToRepository(files, uploaderName);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    add(Array.from(e.dataTransfer.files));
  };

  const confirmDelete = () => {
    if (pendingDelete) removeBoardDocument(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Trigger + popover                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size={showLabel ? 'sm' : 'icon-sm'}
              data-toolbar-item={toolbarItem || undefined}
              tabIndex={toolbarItem ? -1 : undefined}
              aria-label={`Documents${fileCount ? ` (${fileCount})` : ''}`}
            />
          }
        >
          <Files />
          {showLabel ? <span>Documents</span> : null}
        </PopoverTrigger>

        {/*
         * Popover: w-80 (320 px), rounded-2xl (16 px) per §7 card radius.
         * p-0 so the internal layout can control its own padding precisely.
         */}
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={10}
          className={cn(
            CHROME_CONTROLS,
            'w-80 gap-0 overflow-hidden rounded-2xl border border-border bg-surface p-0',
            'shadow-md',
            // Enter: 160 ms out-quart zoom + slide; exit: 120 ms
            'data-[side=bottom]:origin-top-right',
          )}
          onDragOver={(e: DragEvent) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {/* -------- Header strip -------- */}
          {/*
           * compound-card toolbar strip: bg-subtle (panel-like), border-b,
           * padding-x = 20 (same as body's px-5).
           * Layout: title-group left, "Add files" action right.
           */}
          <div className="flex items-center gap-3 border-b border-border bg-subtle px-4 py-2.5">
            {/* Left: eyebrow + inline count — min-w-0 so it can compress */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              {/* Eyebrow — mono, uppercase, tracked, muted */}
              <span className="shrink-0 font-mono text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-tertiary">
                Files
              </span>
              {/* Count + size — inline, truncated, same mono weight */}
              {fileCount > 0 ? (
                <span className="truncate font-mono text-[11px] tabular-nums leading-4 text-tertiary">
                  · {fileCount} {fileCount === 1 ? 'file' : 'files'} · {formatBytes(totalBytes)}
                </span>
              ) : null}
            </div>

            {/* Right: "Add files" — shrink-0 so it never collapses */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              className={cn(
                'h-7 shrink-0 gap-1.5 rounded-md border-border bg-surface px-2.5 text-xs font-medium text-primary',
                'shadow-none hover:border-strong hover:bg-subtle',
                'transition-[background-color,border-color] duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)]',
              )}
            >
              <Upload size={12} strokeWidth={1.5} aria-hidden />
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
          </div>

          {/* -------- Scrollable body -------- */}
          {/*
           * Inner padding: px-3 py-2 so content aligns to a 12 px inset.
           * r_inner = 16 (card) − 4 (p-1 approx) = 12  → child rows get rounded-lg
           * Max-height capped so the popover never runs off-screen.
           */}
          <div
            className={cn(
              'flex max-h-72 flex-col gap-1 overflow-y-auto px-2 py-2',
              // Drag-over ring — inset so it doesn't push layout
              dragOver &&
                'ring-2 ring-inset ring-primary rounded-b-2xl',
            )}
          >
            {dragOver ? (
              <DropZoneOverlay />
            ) : (
              <>
                {/* Active uploads — rendered above completed files */}
                {uploadList.map((upload) => (
                  <UploadRow
                    key={upload.id}
                    uploadId={upload.id}
                    name={upload.name}
                    size={upload.size}
                    progress={upload.progress}
                    error={upload.error}
                    onRetry={() => retryUpload(upload.id, uploaderName)}
                  />
                ))}

                {/* Completed files list */}
                {list.length === 0 && uploadList.length === 0 ? (
                  <EmptyState />
                ) : (
                  list.map((meta) => (
                    <DocumentRow
                      key={meta.id}
                      meta={meta}
                      onDelete={() => setPendingDelete(meta)}
                    />
                  ))
                )}
              </>
            )}
          </div>

          {/* -------- Footer strip (shown only when there are files) -------- */}
          {fileCount > 0 ? (
            <div className="flex items-center justify-between border-t border-border bg-subtle px-5 py-2.5">
              <span className="text-xs leading-4 text-tertiary">
                Shared with everyone on the board
              </span>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {/* ------------------------------------------------------------------ */}
      {/* Delete confirmation dialog                                           */}
      {/* ------------------------------------------------------------------ */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-medium text-primary">
                "{pendingDelete?.name}"
              </strong>{' '}
              will be removed for everyone on this board. This can't be undone.
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
              Delete document
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
