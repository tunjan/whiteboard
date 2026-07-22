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
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
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
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DocumentRow({
  meta,
  onDelete,
}: {
  meta: BoardDocumentMeta;
  onDelete: () => void;
}) {
  const href = documentUrl(meta);
  // Safe types render in a new tab; everything else the server sends as an
  // attachment, so the same click downloads it.
  const opensInTab = INLINE_DOCUMENT_EXTS.has(meta.ext);

  const download = () => {
    const a = document.createElement('a');
    a.href = href;
    a.download = meta.name;
    a.click();
  };

  const ExtIcon = EXT_ICON[meta.ext] ?? File;

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-muted">
      <a
        href={href}
        target={opensInTab ? '_blank' : undefined}
        rel="noreferrer"
        download={opensInTab ? undefined : meta.name}
        className="flex min-w-0 flex-1 items-center gap-2 outline-none"
      >
        <ExtIcon className="size-4 shrink-0 text-content-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-content-default">
            {meta.name}
          </span>
          <span className="block truncate text-xs text-content-muted">
            <span className="tabular-nums">{formatBytes(meta.size)}</span>
            {meta.uploadedBy ? ` · ${meta.uploadedBy}` : ''} ·{' '}
            {new Date(meta.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </span>
      </a>
      <div className="flex shrink-0 items-center">
        <RowAction label="Download" onClick={download}>
          <Download />
        </RowAction>
        <RowAction label="Delete" onClick={onDelete}>
          <Trash2 />
        </RowAction>
      </div>
    </div>
  );
}

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
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
      <Upload className="size-4 shrink-0 text-content-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-content-default">{name}</p>
        {error ? (
          <p className="truncate text-xs text-content-error">{error}</p>
        ) : (
          <>
            <p className="text-xs tabular-nums text-content-muted">
              {formatBytes(Math.round(size * progress))} of {formatBytes(size)}
            </p>
            <div
              className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-bg-muted"
              role="progressbar"
              aria-label={`Uploading ${name}`}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full rounded-full bg-content-default transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {error ? (
          <RowAction label="Retry Upload" onClick={onRetry}>
            <RefreshCw />
          </RowAction>
        ) : null}
        <RowAction
          label={error ? 'Dismiss' : 'Cancel Upload'}
          onClick={() => cancelUpload(uploadId)}
        >
          <X />
        </RowAction>
      </div>
    </div>
  );
}

/**
 * The board's shared document repository: a folder button in the top-right
 * chrome opening a list everyone on the board can add to and remove from.
 */
export function DocumentsPanel({ identity }: { identity: Identity | null }) {
  const documents = useDocumentsStore((s) => s.documents);
  const uploads = useDocumentsStore((s) => s.uploads);
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
  const totalBytes = list.reduce((sum, meta) => sum + meta.size, 0);

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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Documents${list.length ? ` (${list.length})` : ''}`}
              className="relative"
            />
          }
        >
          <Folder />
          {list.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-content-default px-1 text-[9px] font-semibold tabular-nums text-bg-default"
            >
              {list.length}
            </span>
          ) : null}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={10}
          className="w-80 gap-0 p-0"
          onDragOver={(e: DragEvent) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <PopoverHeader className="px-3 pt-3 pb-2">
            <PopoverTitle className="text-[13px]">Documents</PopoverTitle>
            <PopoverDescription className="text-xs tabular-nums">
              {list.length === 0
                ? 'Share files with everyone on this board'
                : `${list.length} ${list.length === 1 ? 'file' : 'files'} · ${formatBytes(totalBytes)}`}
            </PopoverDescription>
          </PopoverHeader>

          <div className="px-1 pb-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-content-default outline-hidden transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:bg-bg-muted focus-visible:text-content-emphasis"
            >
              <Upload className="size-4 shrink-0" />
              Add Files
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                add(Array.from(e.target.files ?? []));
                // Allow re-picking the same file after a failed attempt.
                e.target.value = '';
              }}
            />
          </div>

          <div
            className={`flex max-h-72 flex-col overflow-y-auto p-1 ${
              dragOver ? 'rounded-md ring-2 ring-inset ring-primary' : ''
            }`}
          >
            {dragOver ? (
              <p className="px-2 py-6 text-center text-xs text-content-muted">
                Drop to add
              </p>
            ) : (
              <>
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
                {list.length === 0 && uploadList.length === 0 ? (
                  <p className="text-pretty px-2 py-2 text-xs leading-5 text-content-muted">
                    No documents yet. Add a PDF, worksheet, or image to share it
                    with everyone on this board.
                  </p>
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
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.name}” will be removed for everyone on this
              board. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete Document
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
