import { useEffect, useState, type ReactNode } from 'react';
import { Play, Radio, Trash2 } from 'lucide-react';
import type { RecordingMeta } from '@whiteboard/shared';
import {
  deleteRecording,
  refreshRecordingsLibrary,
} from '@/animation/recordings-api';
import {
  playRecordingForEveryone,
  playRecordingLocally,
} from '@/animation/runtime';
import { useAnimationStore } from '@/animation/use-animation-store';
import { useDocumentStore } from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

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

/** Board-wide list of saved recordings; rendered inside the animation popover. */
export function RecordingsLibrary({
  boardId,
  isTutor,
}: {
  boardId: string;
  isTutor: boolean;
}) {
  const library = useAnimationStore((s) => s.library);
  const pages = useDocumentStore((s) => s.doc.pages);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecordingMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshRecordingsLibrary(boardId)
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteRecording(boardId, pendingDelete.id);
      await refreshRecordingsLibrary(boardId);
    } catch {
      // Leave the row in place; the next refresh reflects reality.
    }
    setPendingDelete(null);
  };

  return (
    <>
      <div className="flex max-h-72 flex-col overflow-y-auto p-1">
        {!loaded ? (
          <p className="px-2 py-2 text-xs text-content-muted">Loading…</p>
        ) : loadError ? (
          <p className="px-2 py-2 text-xs text-content-muted">
            Couldn’t load recordings.
          </p>
        ) : library.length === 0 ? (
          <p className="px-2 py-2 text-xs text-content-muted">
            No recordings yet.
          </p>
        ) : (
          library.map((meta) => (
            <div
              key={meta.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-muted"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-content-default">
                  {meta.name}
                </p>
                <p className="text-[11px] text-content-muted tabular-nums">
                  {formatTime(meta.durationMs)} ·{' '}
                  {new Date(meta.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {pages[meta.pageId] ? '' : ' · deleted page'}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <RowAction
                  label="Play"
                  onClick={() => playRecordingLocally(meta.id)}
                >
                  <Play />
                </RowAction>
                {isTutor ? (
                  <>
                    <RowAction
                      label="Play for everyone"
                      onClick={() => playRecordingForEveryone(meta.id)}
                    >
                      <Radio />
                    </RowAction>
                    <RowAction
                      label="Delete"
                      onClick={() => setPendingDelete(meta)}
                    >
                      <Trash2 />
                    </RowAction>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recording?</DialogTitle>
            <DialogDescription>
              “{pendingDelete?.name}” will be removed for everyone on this
              board. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
