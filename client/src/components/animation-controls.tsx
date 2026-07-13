import { useEffect, useState, type ReactNode } from 'react';
import {
  Clapperboard,
  Pause,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';
import { genId, type AnimationRecordingV1 } from '@whiteboard/shared';
import type { Identity } from '@/collab/identity';
import {
  setLegacyAnimationsListener,
  useDocumentStore,
} from '@/canvas/use-document-store';
import { migrateLegacyRecordings } from '@/animation/legacy-migration';
import {
  refreshRecordingsLibrary,
  uploadRecording,
} from '@/animation/recordings-api';
import {
  beginRecordingCountdown,
  bindAnimationRuntime,
  cancelRecordingCountdown,
  pauseAnimation,
  pauseLocalPlayback,
  restartAnimation,
  restartLocalPlayback,
  resumeAnimation,
  resumeLocalPlayback,
  seekAnimation,
  seekLocalPlayback,
  setAnimationController,
  stopAnimationRecording,
  stopLocalPlayback,
  stopSharedAnimationPlayback,
} from '@/animation/runtime';
import { useAnimationStore } from '@/animation/use-animation-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
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
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  RecordingsLibrary,
  formatTime,
} from '@/components/recordings-library';

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
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
            disabled={disabled}
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

export function AnimationControls({ identity }: { identity: Identity | null }) {
  const boardId = useDocumentStore((s) => s.boardId);
  const pages = useDocumentStore((s) => s.doc.pages);
  const library = useAnimationStore((s) => s.library);
  const payloads = useAnimationStore((s) => s.payloads);
  const playback = useAnimationStore((s) => s.playback);
  const localPlayback = useAnimationStore((s) => s.localPlayback);
  const playbackActive = useAnimationStore((s) => s.playbackActive);
  const isLocalPlayback = useAnimationStore((s) => s.isLocalPlayback);
  const playbackPositionMs = useAnimationStore((s) => s.playbackPositionMs);
  const recordingPageId = useAnimationStore((s) => s.recordingPageId);
  const recordingElapsedMs = useAnimationStore((s) => s.recordingElapsedMs);
  const recordingCountdown = useAnimationStore((s) => s.recordingCountdown);
  const [seekingTo, setSeekingTo] = useState<number | null>(null);
  const [pendingSave, setPendingSave] = useState<{
    id: string;
    recording: AnimationRecordingV1;
  } | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const isTutor = identity?.isTutor ?? false;

  const activeRecordingId = isLocalPlayback
    ? localPlayback.recordingId
    : playback.recordingId;
  const activeRecording = activeRecordingId
    ? payloads[activeRecordingId]
    : null;
  const transportStatus = isLocalPlayback
    ? localPlayback.status
    : playback.status;
  const canControl = isLocalPlayback || isTutor;

  useEffect(() => bindAnimationRuntime(), []);
  useEffect(() => setAnimationController(isTutor), [isTutor]);

  // Migrate recordings that older clients stored inside the Yjs doc.
  useEffect(() => {
    if (!isTutor || !boardId) return;
    setLegacyAnimationsListener(() => void migrateLegacyRecordings(boardId));
    return () => setLegacyAnimationsListener(null);
  }, [isTutor, boardId]);

  const finishRecording = () => {
    const recording = stopAnimationRecording();
    if (!recording) return;
    const pageName = pages[recording.pageId]?.name ?? 'Page';
    const stamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    setSaveName(`${pageName} · ${stamp}`);
    setSaveError(false);
    // Mint the id once so a retried upload is idempotent.
    setPendingSave({ id: genId(), recording });
  };

  const saveRecording = async () => {
    if (!pendingSave || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await uploadRecording(boardId, {
        id: pendingSave.id,
        name: saveName.trim() || 'Untitled recording',
        recording: pendingSave.recording,
      });
      // Cache the payload locally so playing it back needs no refetch.
      useAnimationStore
        .getState()
        .addPayload(pendingSave.id, pendingSave.recording);
      setPendingSave(null);
      void refreshRecordingsLibrary(boardId);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const countdownPanel =
    recordingCountdown !== null ? (
      <div
        data-ui-layer
        role="status"
        aria-label={`Recording starts in ${recordingCountdown}`}
        className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-6"
      >
        <div
          key={recordingCountdown}
          className="relative flex size-40 items-center justify-center motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:duration-300"
        >
          <span className="absolute inset-0 rounded-full border-2 border-content-error/30 motion-safe:animate-ping" />
          <span className="absolute inset-0 rounded-full bg-bg-default/80 shadow-floating backdrop-blur-sm" />
          <span className="relative font-mono text-7xl font-bold text-content-error tabular-nums">
            {recordingCountdown}
          </span>
        </div>
        <div className="pointer-events-auto flex flex-col items-center gap-3">
          <span className="text-sm font-medium text-content-subtle">
            Recording starts in…
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full shadow-floating"
            onClick={() => cancelRecordingCountdown()}
          >
            Cancel
          </Button>
        </div>
      </div>
    ) : null;

  const recordingPanel = recordingPageId ? (
    <Surface
      shape="pill"
      data-ui-layer
      role="status"
      aria-label="Recording whiteboard animation"
      className="touch-targets fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 py-1.5 pr-1.5 pl-3.5 shadow-floating"
    >
      <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full rounded-full bg-content-error opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2.5 rounded-full bg-content-error" />
      </span>
      <span className="text-xs font-semibold tracking-wide text-content-error uppercase">
        Rec
      </span>
      <span className="font-mono text-xs text-content-subtle tabular-nums">
        {formatTime(recordingElapsedMs)}
      </span>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={finishRecording}
      >
        <Square data-icon="inline-start" />
        Stop
      </Button>
    </Surface>
  ) : null;

  const playbackPanel = playbackActive && activeRecording ? (
    <Surface
      shape="pill"
      data-ui-layer
      role="region"
      aria-label="Whiteboard animation playback"
      className="touch-targets fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-30 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 py-1.5 pr-3 pl-2 opacity-30 shadow-floating transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none"
    >
      {isLocalPlayback ? (
        <span className="shrink-0 pl-1 text-[10px] font-semibold tracking-wide text-content-subtle uppercase">
          Preview
        </span>
      ) : null}
      {canControl ? (
        <IconAction
          label={transportStatus === 'playing' ? 'Pause' : 'Play'}
          onClick={
            transportStatus === 'playing'
              ? isLocalPlayback
                ? pauseLocalPlayback
                : pauseAnimation
              : isLocalPlayback
                ? resumeLocalPlayback
                : resumeAnimation
          }
        >
          {transportStatus === 'playing' ? <Pause /> : <Play />}
        </IconAction>
      ) : null}
      <Slider
        aria-label="Animation position"
        className="min-w-0 flex-1"
        min={0}
        max={Math.max(1, activeRecording.durationMs)}
        step={100}
        disabled={!canControl}
        value={seekingTo ?? playbackPositionMs}
        onValueChange={(value) =>
          setSeekingTo(Array.isArray(value) ? value[0]! : value)
        }
        onValueCommitted={(value) => {
          const position = Array.isArray(value) ? value[0]! : value;
          if (isLocalPlayback) seekLocalPlayback(position);
          else seekAnimation(position);
          setSeekingTo(null);
        }}
      />
      <span className="shrink-0 font-mono text-[11px] text-content-subtle tabular-nums">
        {formatTime(seekingTo ?? playbackPositionMs)} /{' '}
        {formatTime(activeRecording.durationMs)}
      </span>
      {canControl ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconAction
            label="Restart"
            onClick={isLocalPlayback ? restartLocalPlayback : restartAnimation}
          >
            <RotateCcw />
          </IconAction>
          <IconAction
            label="Stop"
            onClick={
              isLocalPlayback ? stopLocalPlayback : stopSharedAnimationPlayback
            }
          >
            <Square />
          </IconAction>
        </div>
      ) : null}
    </Surface>
  ) : null;

  return (
    <>
      <TooltipProvider delay={300}>
        {countdownPanel}
        {recordingPanel}
        {playbackPanel}
        {!recordingPageId && recordingCountdown === null && !playbackActive ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Recordings"
                />
              }
            >
              <Clapperboard />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={10}
              className="w-72 gap-0 p-0"
            >
              <PopoverHeader className="px-3 pt-3 pb-2">
                <PopoverTitle className="text-[13px]">Recordings</PopoverTitle>
                <PopoverDescription className="text-xs tabular-nums">
                  {library.length === 0
                    ? 'Record a page to replay it later'
                    : `${library.length} saved`}
                </PopoverDescription>
              </PopoverHeader>
              {isTutor ? (
                <div className="px-1 pb-1">
                  <button
                    type="button"
                    onClick={() => beginRecordingCountdown()}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-content-default outline-hidden transition-colors hover:bg-bg-muted hover:text-content-emphasis focus-visible:bg-bg-muted focus-visible:text-content-emphasis"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full bg-content-error"
                    />
                    Record this page
                  </button>
                </div>
              ) : null}
              <RecordingsLibrary boardId={boardId} isTutor={isTutor} />
            </PopoverContent>
          </Popover>
        ) : null}
      </TooltipProvider>

      <Dialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingSave(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save recording</DialogTitle>
            <DialogDescription>
              {pendingSave
                ? `${formatTime(pendingSave.recording.durationMs)} recording — give it a name so it's easy to find later.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            maxLength={120}
            aria-label="Recording name"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveRecording();
            }}
          />
          {saveError ? (
            <p className="text-sm text-content-error">
              Couldn’t save the recording. Check your connection and retry.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setPendingSave(null)}
            >
              Discard
            </Button>
            <Button disabled={saving} onClick={() => void saveRecording()}>
              {saveError ? 'Retry' : saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
