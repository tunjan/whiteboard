import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Loader2, Mic, Sparkles, Square } from 'lucide-react';
import {
  dictateLatex,
  latexFromPrompt,
} from '@/board/latex-ai';
import { useFeature } from '@/board/features';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FIELD_SURFACE } from './equation-panel-styles';

/**
 * Plain-language description → LaTeX, typed or dictated, via the model.
 *
 * A hook rather than state inside the prompt row because the panel as a whole
 * answers its shortcuts — Escape cancels a recording before the source field's
 * own Escape sends focus to the canvas — so `onKeyDownCapture` goes on the
 * panel's surface, not on the row.
 */
export function useEquationDictation({
  updateLatex,
  focusInput,
}: {
  updateLatex: (latex: string) => void;
  focusInput: () => void;
}) {
  const aiEnabled = useFeature('ai');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const discardRecording = useRef(false);
  // The live recorder for the unmount cleanup, which must not re-run (and
  // flag the recording as discarded) every time `recorder` changes.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Spoken by screen readers as dictation moves along; the placeholder and
  // the spinner it replaces were only ever visible.
  const [dictationStatus, setDictationStatus] = useState('');


  /**
   * Ask the model to write LaTeX for a plain-language description.
   *
   * Written through `updateLatex` rather than `applyEdit`: the latter types
   * through the source field's own undo stack, which only works while that
   * field already has focus — here it's the prompt field that does.
   */
  const generateFromPrompt = async (spoken?: string) => {
    const text = (spoken ?? prompt).trim();
    if (!text || generating) return;
    setGenerating(true);
    setDictationStatus('Generating equation…');
    try {
      const latex = await latexFromPrompt(text);
      updateLatex(latex);
      setPrompt('');
      setDictationStatus('Equation written');
      focusInput();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      setDictationStatus(message);
      toast.add({ title: message, type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Dictate the description: first press records, second press stops. The
   * transcript lands in the description field — so the student sees what was
   * heard — and the server writes its LaTeX in the same request.
   */
  const toggleDictation = async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.add({ title: 'Microphone unavailable', type: 'error' });
      return;
    }
    // Speech needs a fraction of the browser's default bitrate, and every
    // byte of it crosses the tunnel before transcription can start.
    const next = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    next.ondataavailable = (event) => chunks.push(event.data);
    next.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecorder(null);
      if (discardRecording.current) {
        setDictationStatus('Dictation cancelled');
        return;
      }
      setGenerating(true);
      setDictationStatus('Transcribing…');
      const started = performance.now();
      try {
        const result = await dictateLatex(
          new Blob(chunks, { type: next.mimeType }),
        );
        console.debug(
          `[dictation] ${Math.round(performance.now() - started)}ms stop→LaTeX`,
        );
        if (result.latex) {
          updateLatex(result.latex);
          setDictationStatus(`Heard “${result.text}”. Equation written`);
          focusInput();
        } else {
          // The transcript stays in the field to be corrected and re-sent.
          setPrompt(result.text);
          const message = result.error ?? 'Generation failed';
          setDictationStatus(`Heard “${result.text}”. ${message}`);
          toast.add({ title: message, type: 'error' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transcription failed';
        setDictationStatus(message);
        toast.add({ title: message, type: 'error' });
      } finally {
        setGenerating(false);
      }
    };
    discardRecording.current = false;
    next.start();
    recorderRef.current = next;
    setRecorder(next);
    setDictationStatus('Listening. Press the dictate button again to finish, Escape to cancel');
  };

  /** Stop recording without transcribing. */
  const cancelDictation = () => {
    discardRecording.current = true;
    recorderRef.current?.stop();
  };

  // Closing the panel mid-recording releases the mic without transcribing.
  useEffect(
    () => () => {
      discardRecording.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    },
    [],
  );

  // Capture: Escape must cancel a recording before the source field's own
  // Escape sends focus to the canvas.
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (!aiEnabled) return;
    if (event.key === 'Escape' && recorder) {
      event.preventDefault();
      event.stopPropagation();
      cancelDictation();
    } else if (
      event.code === 'KeyD' &&
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      !generating
    ) {
      event.preventDefault();
      event.stopPropagation();
      void toggleDictation();
    }
  };

  return {
    aiEnabled,
    prompt,
    setPrompt,
    generating,
    recorder,
    dictationStatus,
    generateFromPrompt,
    toggleDictation,
    onKeyDownCapture,
  };
}

/**
 * The description field and its two actions, directly under the source field
 * it writes into. Only shown where the server is configured to answer it.
 */
export function EquationAiPrompt({
  dictation,
  spaced,
}: {
  dictation: ReturnType<typeof useEquationDictation>;
  /** A message bar sits above, so the row needs its own top padding. */
  spaced: boolean;
}) {
  const {
    aiEnabled,
    prompt,
    setPrompt,
    generating,
    recorder,
    dictationStatus,
    generateFromPrompt,
    toggleDictation,
  } = dictation;
  if (!aiEnabled) return null;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1 px-4 pb-3',
        spaced && 'pt-0',
      )}
    >
      <Textarea
        aria-label="Describe an equation to generate its LaTeX"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          void generateFromPrompt();
        }}
        placeholder={recorder ? 'Listening…' : 'Describe an equation…'}
        rows={1}
        // Read-only rather than disabled: disabling the focused field
        // would drop keyboard focus to the page mid-request.
        readOnly={generating || Boolean(recorder)}
        aria-busy={generating || undefined}
        className={cn(FIELD_SURFACE, 'min-h-8 flex-1 resize-none rounded-compact px-2 py-1.5 text-sm text-fg read-only:border-border read-only:bg-panel read-only:text-fg-subtle')}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant={recorder ? 'default' : 'ghost'}
              // A toggle keeps one name; aria-pressed carries the state.
              aria-label="Dictate an equation"
              aria-keyshortcuts="Meta+Shift+D Control+Shift+D"
              aria-pressed={Boolean(recorder)}
              disabled={generating}
              focusableWhenDisabled
              onClick={() => void toggleDictation()}
              className="shrink-0 data-disabled:pointer-events-none data-disabled:opacity-50"
            />
          }
        >
          {recorder ? (
            <Square className="size-3.5" aria-hidden="true" />
          ) : (
            <Mic className="size-3.5" aria-hidden="true" />
          )}
        </TooltipTrigger>
        <TooltipContent side="top">
          {recorder
            ? 'Stop dictating (Esc cancels)'
            : 'Dictate (⌘/Ctrl + Shift + D)'}
        </TooltipContent>
      </Tooltip>
      {/* Ghost until there is something to send: an idle filled button
          read as disabled and still drew the eye. */}
      <Button
        size="sm"
        variant={prompt.trim() || generating ? 'default' : 'ghost'}
        disabled={!prompt.trim() || generating || Boolean(recorder)}
        onClick={() => void generateFromPrompt()}
        className="shrink-0"
      >
        {generating ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        Generate
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {dictationStatus}
      </span>
    </div>
  );
}
