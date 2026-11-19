import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import { ArrowUp, Check, CircleAlert, Loader2, Mic, Sparkles, Square, X } from 'lucide-react';
import { askBoardAgent } from '@/board/latex-ai';
import { useFeature } from '@/board/features';
import {
  MAX_AGENT_HISTORY,
  MAX_AGENT_REPLY_CHARS,
  describeActions,
  type AgentPrevious,
  type AgentProgress,
} from '@whiteboard/shared';
import {
  agentNeedsPicture,
  applyAgentActions,
  boardSummary,
  pictureForAgent,
} from '@/canvas/agent-actions';
import { isTypingTarget } from '@/canvas/canvas-shortcuts';
import { CommentText } from '@/canvas/CommentText';
import { useCommentsStore } from '@/canvas/use-comments-store';
import { useCustomStickersStore } from '@/canvas/use-custom-stickers-store';
import {
  openMistakes,
  showMistake,
  startAutoCheck,
  stopAutoCheck,
  useAutoCheckStore,
} from '@/canvas/work-checker';
import { editor, onLocalShapesChanged, undo, useDocumentStore } from '@/canvas/use-document-store';
import { playAgentSound } from '@/components/agent-sound';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// The same height as the corner instruments either side, so the top edge
// reads as one row.
const pillClass = cn(
  'flex h-10.5 items-center gap-2 rounded-panel px-3 text-sm whitespace-nowrap text-fg-muted',
  'transition-colors hover:text-fg focus-visible:shadow-focus focus-visible:outline-none',
);

/** Whether the bar is open and a request is running, shared with `AskBoardKey`. */
const useAgentBarStore = create<{ open: boolean; busy: boolean }>(() => ({
  open: false,
  busy: false,
}));

/**
 * The bar's key on the board's own row (top left), beside the board and page
 * it acts on. `/` opens the bar too. Only where the server has a model.
 */
export function AskBoardKey() {
  const enabled = useFeature('ai');
  const busy = useAgentBarStore((s) => s.busy);
  if (!enabled) return null;
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Ask the board"
              aria-keyshortcuts="/"
              onClick={() => useAgentBarStore.setState({ open: true })}
            />
          }
        >
          {busy ? <Loader2 className="animate-spin text-selected" /> : <Sparkles />}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>Ask the board</span>
          <Kbd>/</Kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const enterClass =
  'ease-[var(--ease-out-expo)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200';

/**
 * What the last instruction came to, shown under the bar where the eye is.
 * `id` replays the entrance for a repeat of the same text; `leaving` is the
 * short fade a timed or superseded outcome plays before it unmounts.
 */
type Outcome = {
  id: number;
  kind: 'done' | 'reply' | 'error';
  text: string;
  question?: string;
  /** The edits can still be undone from here (an answer may come with some). */
  undoable?: boolean;
  leaving?: boolean;
};

/** What each tool the model starts calling looks like as a step. */
const TOOL_STEPS: Record<string, string> = {
  look_at_board: 'Asking to see the board',
  say: 'Writing an explanation',
  create_text: 'Writing text',
  create_equation: 'Writing an equation',
  create_graph: 'Plotting a graph',
  create_sticker: 'Choosing a sticker',
  generate_sticker: 'Planning a sticker',
  create_shape: 'Drawing a shape',
  create_arrow: 'Drawing an arrow',
  update_shape: 'Editing',
  delete_shapes: 'Deleting',
  create_frame: 'Making a frame',
  align_shapes: 'Lining things up',
  group_shapes: 'Grouping',
};

/** One line of the progress list; a repeat of the last one counts up instead. */
type Step = { label: string; count: number };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The board agent's one control: say or type what should happen on the board,
 * and it happens as one undoable edit. Opens top centre, clear of the chrome in
 * the left corner and the session rail in the right, from `AskBoardKey` or `/`.
 * Only rendered where the server has a model to answer it.
 */
export function AgentBar() {
  const enabled = useFeature('ai');
  const open = useAgentBarStore((s) => s.open);
  const setOpen = (next: boolean) => useAgentBarStore.setState({ open: next });
  const [text, setText] = useState('');
  const busy = useAgentBarStore((s) => s.busy);
  const setBusy = (next: boolean) => useAgentBarStore.setState({ busy: next });
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recordedFor, setRecordedFor] = useState(0);
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // What this request has done so far; the last one is under way.
  const [steps, setSteps] = useState<Step[]>([]);
  // The answer as the model writes it, shown in the answer's own card until
  // the finished one takes its place (same `id`, so no second entrance).
  const [draft, setDraft] = useState<{ id: number; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const discard = useRef(false);
  const request = useRef<AbortController | null>(null);
  // The last instruction sent, for ↑ in the empty field: rephrasing one that
  // missed is the common next move.
  const lastInstruction = useRef('');
  // The last few exchanges that came to something, sent with the next one so
  // a follow-up ("why?", "now in red", "and the other root?") knows what it follows.
  const previous = useRef<AgentPrevious[]>([]);
  // The live recorder for the unmount cleanup, which must run once, not on
  // every recorder change (it would flag each new recording as discarded).
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Switched in the board menu; only the mistakes it finds show here.
  const autoCheck = useAutoCheckStore((s) => s.on);
  const messages = useCommentsStore((s) => s.messages);
  const openThreadId = useCommentsStore((s) => s.openThreadId);
  const pageId = useDocumentStore((s) => s.currentPageId);
  const mistakes = openMistakes(messages, pageId);

  useEffect(() => {
    if (!enabled || !autoCheck) return;
    startAutoCheck();
    return stopAutoCheck;
  }, [enabled, autoCheck]);

  /** Each press moves on to the mistake after the one open, top to bottom. */
  const nextMistake = () => {
    const at = mistakes.findIndex((m) => m.id === openThreadId);
    const next = mistakes[(at + 1) % mistakes.length];
    if (next) showMistake(next);
  };


  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  // Leaving the board mid-recording releases the mic without sending, and
  // mid-request drops the answer rather than applying it to the next board.
  useEffect(
    () => () => {
      discard.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      request.current?.abort();
      // Shared state outlives the bar; the next board starts closed.
      useAgentBarStore.setState({ open: false, busy: false });
    },
    [],
  );

  useEffect(() => {
    if (!recorder) return;
    setRecordedFor(0);
    const started = Date.now();
    const tick = setInterval(() => setRecordedFor(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(tick);
  }, [recorder]);

  // A confirmation and an error fade on their own. An answer is read, and no
  // timer knows how long that takes: it stays until it is closed, Escape, or a
  // press anywhere outside the bar — the way a popover goes. Undo is only
  // offered while it would undo the agent's edit: the user's next change to
  // the board takes the offer away.
  useEffect(() => {
    if (!outcome || outcome.leaving) return;
    if (outcome.kind === 'reply') {
      const onPointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) setOutcome(null);
      };
      window.addEventListener('pointerdown', onPointerDown, true);
      const off = outcome.undoable
        ? onLocalShapesChanged(() =>
            setOutcome((o) => (o?.id === outcome.id ? { ...o, undoable: false } : o)),
          )
        : undefined;
      return () => {
        window.removeEventListener('pointerdown', onPointerDown, true);
        off?.();
      };
    }
    // Nobody pressed anything, so it fades rather than blinks out at the
    // edge of the eye; the effect below unmounts it once `.agent-leave` ends.
    const leave = () => setOutcome((o) => (o?.id === outcome.id ? { ...o, leaving: true } : o));
    const timer = setTimeout(leave, outcome.kind === 'done' ? 6000 : 8000);
    const off = outcome.kind === 'done' ? onLocalShapesChanged(leave) : undefined;
    return () => {
      clearTimeout(timer);
      off?.();
    };
  }, [outcome]);

  // A timer, not `animationend`: that never fires in a tab that isn't
  // painting, which would leave the faded chip mounted for good.
  useEffect(() => {
    if (!outcome?.leaving) return;
    const timer = setTimeout(() => setOutcome((o) => (o?.id === outcome.id ? null : o)), 160);
    return () => clearTimeout(timer);
  }, [outcome]);

  // Escape anywhere closes an answer — including with focus on the canvas,
  // where the bar's own Escape handler never hears it.
  useEffect(() => {
    if (outcome?.kind !== 'reply') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || rootRef.current?.contains(event.target as Node)) return;
      setOutcome(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [outcome]);

  const run = async (instruction: string | Blob) => {
    const id = Date.now();
    const controller = new AbortController();
    request.current = controller;
    // A step for the progress list and, as words, for the screen reader.
    const step = (label: string) => {
      if (controller.signal.aborted) return;
      setStatus(label);
      setSteps((list) => {
        const last = list.at(-1);
        return last?.label === label
          ? [...list.slice(0, -1), { label, count: last.count + 1 }]
          : [...list, { label, count: 1 }];
      });
    };
    setBusy(true);
    setOutcome(null);
    setSteps([]);
    setDraft(null);
    step(typeof instruction === 'string' ? 'Reading the board' : 'Listening back');
    if (typeof instruction === 'string') lastInstruction.current = instruction;
    // Once per answer, not once per piece of it.
    let writing = false;
    const onProgress = (progress: AgentProgress) => {
      if (progress.step === 'draft') {
        if (controller.signal.aborted) return;
        const { text, reset } = progress;
        if (!writing && text) step('Writing the answer');
        writing = !reset || Boolean(text);
        setDraft((d) => ({ id, text: reset ? text : (d?.text ?? '') + text }));
      } else if (progress.step === 'heard') {
        setText(progress.transcript);
        step(`Heard “${progress.transcript}”`);
        step('Reading the board');
      } else if (progress.step === 'thinking') step('Thinking');
      else step(TOOL_STEPS[progress.name] ?? 'Working');
    };
    try {
      const result = await askBoardAgent(
        instruction,
        boardSummary(editor),
        () => {
          step('Looking at the board');
          return pictureForAgent(editor);
        },
        controller.signal,
        {
          previous: previous.current.length ? previous.current : undefined,
          pictureFirst: agentNeedsPicture(editor),
          onProgress,
        },
      );
      if (controller.signal.aborted) return;
      if (result.transcript) {
        setText(result.transcript);
        lastInstruction.current = result.transcript;
      }
      if (result.actions.length) step('Putting it on the board');
      const applied = await applyAgentActions(editor, result.actions, {
        onStep: (s) => step(s.kind === 'typeset' ? 'Typesetting' : `Drawing “${s.prompt}”`),
      });
      // A generated sticker that failed says why in the sticker store, which
      // only the closed toolbar strip would otherwise show.
      const stickerError = result.actions.some((a) => a.type === 'generate_sticker')
        ? (useCustomStickersStore.getState().error ?? 'Sticker not added')
        : null;
      const note =
        result.reply ?? (applied ? describeActions(result.actions) : (stickerError ?? 'Nothing to change'));
      setStatus(note);
      // An answer is read even when edits came with it; Undo rides along.
      const kind = result.reply ? 'reply' : applied ? 'done' : 'error';
      // An answer carries its question, so the field can clear for the next
      // one (↑ brings it back) without the answer losing what it answers.
      setDraft(null);
      setOutcome({
        id,
        kind,
        text: note,
        question: kind === 'reply' ? lastInstruction.current : undefined,
        undoable: applied > 0,
      });
      if (kind !== 'error') {
        const done = applied ? describeActions(result.actions) : '';
        previous.current = [
          ...previous.current,
          {
            instruction: lastInstruction.current,
            answer: [done, result.reply].filter(Boolean).join('. ').slice(0, MAX_AGENT_REPLY_CHARS),
          },
        ].slice(-MAX_AGENT_HISTORY);
      }
      playAgentSound(kind === 'error' ? 'error' : 'done');
      if (kind !== 'error') setText('');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'The assistant failed';
      setStatus(message);
      setDraft(null);
      setOutcome({ id, kind: 'error', text: message });
      playAgentSound('error');
    } finally {
      if (request.current === controller) request.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const cancel = () => {
    request.current?.abort();
    setStatus('Cancelled');
  };

  const submit = () => {
    const instruction = text.trim();
    if (instruction && !busy) void run(instruction);
  };

  /** First press records, second sends; Escape discards. */
  const toggleRecording = async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setOutcome({ id: Date.now(), kind: 'error', text: 'Microphone unavailable' });
      return;
    }
    // Speech needs a fraction of the default bitrate, and it crosses the tunnel.
    const next = new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
    const chunks: Blob[] = [];
    next.ondataavailable = (event) => chunks.push(event.data);
    next.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      setRecorder(null);
      if (discard.current) {
        setStatus('Recording cancelled');
        return;
      }
      void run(new Blob(chunks, { type: next.mimeType }));
    };
    discard.current = false;
    next.start();
    recorderRef.current = next;
    setRecorder(next);
    setOutcome(null);
    setStatus('Listening. Press the microphone again to send, Escape to cancel');
  };

  /**
   * Closing keeps a request running: its outcome still lands under the pills.
   * A finished answer or error goes with the bar, whose X is now its close;
   * a confirmation stays for its Undo.
   */
  const close = () => {
    if (recorder) {
      discard.current = true;
      recorder.stop();
    }
    if (!busy) setOutcome((o) => (o?.kind === 'done' ? o : null));
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  if (!enabled) return null;

  // While the answer is still being written it is a read-only answer card.
  const drafting = !outcome && busy && Boolean(draft?.text.trim());
  const shown: Outcome | null =
    outcome ?? (drafting && draft ? { id: draft.id, kind: 'reply', text: draft.text, question: lastInstruction.current } : null);

  // Open, the progress and the answer are sections of the bar's own panel:
  // one surface, one close, text on the bar's icon column. Closed, they float
  // under the pills as cards of their own.
  const attached = open;
  const cardClass = 'rounded-panel border border-border bg-surface shadow-float';

  const progress = busy && !outcome && steps.length > 0 && (
    // Where the request is up to, step by step as the server reports
    // them: done ones ticked, the one under way in full ink. The
    // screen reader hears each through the live status below.
    // Shown only once the wait is long enough to need saying.
    <ol
      aria-hidden="true"
      className={cn(
        'agent-drop-in-late relative flex max-w-full flex-col gap-0.5 px-2.5 py-1.5 text-xs text-fg-muted',
        attached ? 'border-t border-border' : cardClass,
      )}
    >
      {/* The last few: a long answer's early steps stop mattering. */}
      {steps.slice(-4).map((s, i, list) => {
        const current = i === list.length - 1;
        return (
          <li
            key={steps.length - list.length + i}
            className={cn('flex min-w-0 items-center gap-1.5', current && 'agent-drop-in text-fg')}
          >
            {current ? (
              <Loader2 className="size-3 shrink-0 animate-spin text-selected" aria-hidden="true" />
            ) : (
              <Check className="size-3 shrink-0 text-success" aria-hidden="true" />
            )}
            <span className="truncate">{s.label}</span>
            {s.count > 1 && <span className="shrink-0 tabular-nums">×{s.count}</span>}
          </li>
        );
      })}
    </ol>
  );

  const undoButton = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="-my-0.5 h-6 shrink-0 px-2 text-xs"
      onClick={() => {
        undo();
        setOutcome(null);
        setStatus('Undone');
      }}
    >
      Undo
    </Button>
  );

  const answer = shown && (
    <div
      key={shown.id}
      // Positioned like the bar above it, so it paints over the bar's
      // shadow rather than under it: static, it sat beneath the shadow's
      // 40px blur, which greyed its first lines.
      className={cn(
        'touch-targets relative flex max-w-full items-center gap-2 py-1 pr-1 pl-2.5 text-xs',
        attached ? 'w-full border-t border-border' : cardClass,
        shown.kind === 'error' ? 'text-danger' : 'text-fg-secondary',
        // An answer is the one outcome with something to read: it gets
        // the bar's full width and body-size type instead of a chip.
        shown.kind === 'reply' && 'w-full items-start py-2 text-sm text-fg',
        shown.leaving ? 'agent-leave' : 'agent-drop-in',
      )}
    >
      {shown.kind === 'done' && (
        <Check className="tick-draw size-3.5 shrink-0 text-success" aria-hidden="true" />
      )}
      {/* Not by colour alone: a failure carries its own mark. */}
      {shown.kind === 'error' && <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
      {/* Markdown and `$…$` maths, through the renderer comments use. */}
      {shown.kind === 'reply' ? (
        <div className="flex max-h-64 min-w-0 flex-1 flex-col gap-1 overflow-y-auto pr-2">
          {shown.question && <p className="truncate text-xs text-fg-muted">{shown.question}</p>}
          <CommentText text={shown.text} className="min-w-0 text-pretty" />
        </div>
      ) : (
        <CommentText text={shown.text} className="min-w-0 flex-1 text-pretty" />
      )}
      {(shown.kind === 'done' || (shown.kind === 'reply' && shown.undoable && !drafting)) && undoButton}
      {/* Attached, the bar's X right above closes it. */}
      {!attached && shown.kind !== 'done' && !drafting && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={shown.kind === 'reply' ? 'Close answer' : 'Dismiss'}
          className="-my-0.5 size-6 shrink-0 text-fg-muted"
          onClick={() => setOutcome(null)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-arrive="down"
      style={{ '--arrive-i': 0.5 } as CSSProperties}
      // In the top row only where it fits between the corner clusters, open
      // as well as closed; narrower, it drops under them.
      className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 flex w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col items-center gap-1.5 max-lg:top-[calc(4.5rem+env(safe-area-inset-top))] lg:w-[clamp(20rem,calc(100vw-44rem),32rem)]"
      // Clicking away from an empty bar puts it back to the pill, the way a
      // command palette does; one holding a draft or a request stays put.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (open && !text.trim() && !busy && !recorder) setOpen(false);
      }}
    >
      {open ? (
        // The pills' radius, so the pill and the bar it unfurls into are one
        // shape.
        <div
          className={cn('agent-unfurl flex w-full flex-col overflow-hidden', cardClass)}
          // On the panel, so Escape works from the answer's Undo too.
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            // The first Escape stops the request or closes an answer; the next
            // one closes the bar.
            if (busy) cancel();
            else if (outcome && outcome.kind !== 'done') setOutcome(null);
            else close();
          }}
        >
          <form
            // `touch-targets` gives a finger 44px keys.
            className="touch-targets relative flex w-full items-center gap-1 p-1"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <span className="ml-1.5 flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              {recorder ? (
                <span className="follow-live-dot size-2 text-danger" />
              ) : (
                <Sparkles className={cn('size-4 text-fg-muted transition-colors', busy && 'text-selected')} />
              )}
            </span>
            <Input
              ref={inputRef}
              // Opening is always a request to type: `/` or a click on the pill.
              autoFocus
              aria-label="Tell the board what to do"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                if (outcome?.kind !== 'done') setOutcome(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' || text || !lastInstruction.current) return;
                event.preventDefault();
                setText(lastInstruction.current);
              }}
              // The last few exchanges go with the next one, so say so while
              // one is on screen.
              placeholder={recorder ? 'Listening…' : shown?.kind === 'reply' ? 'Ask a follow-up…' : 'Plot y = x², or ask…'}
              // Read-only rather than disabled, so focus stays here mid-request.
              readOnly={busy || Boolean(recorder)}
              aria-busy={busy || undefined}
              maxLength={1000}
              // A variant, not a plain class: the base `text-fg` comes later in
              // the sheet and would win.
              className="flex-1 border-transparent bg-transparent shadow-none transition-colors hover:border-transparent focus:border-transparent focus:shadow-none aria-busy:text-fg-muted"
            />
            {recorder && (
              <span className="shrink-0 px-1 text-xs text-fg-muted tabular-nums" aria-hidden="true">
                {clock(recordedFor)}
              </span>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant={recorder ? 'default' : 'ghost'}
              aria-label={recorder ? 'Send recording' : 'Speak an instruction'}
              disabled={busy}
              onClick={() => void toggleRecording()}
            >
              {recorder ? (
                <ArrowUp className="size-3.5" aria-hidden="true" />
              ) : (
                <Mic className="size-3.5" aria-hidden="true" />
              )}
            </Button>
            {busy ? (
              <Button type="button" size="icon-sm" variant="secondary" aria-label="Stop" onClick={cancel}>
                <Square className="size-3 fill-current" aria-hidden="true" />
              </Button>
            ) : recorder ? null : (
              <Button
                type="submit"
                size="icon-sm"
                variant={text.trim() ? 'default' : 'ghost'}
                aria-label="Send"
                disabled={!text.trim()}
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Close" onClick={close}>
              <X className="size-3.5" aria-hidden="true" />
            </Button>
            {busy && (
              // The bar's own edge carries the wait, so the field stays readable.
              <span
                aria-hidden="true"
                className="conversion-sweep pointer-events-none absolute bottom-0 left-0 h-0.5 w-1/3 rounded-full bg-selected [--sweep-from:-100%] [--sweep-to:300%] motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40"
              />
            )}
          </form>
          {progress}
          {answer}
        </div>
      ) : (
        <TooltipProvider delay={300}>
          {/* Closed, top centre is empty board unless the checker has
              something to show: the bar's key lives in the top-left row. */}
          <div className="relative flex justify-center gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150">
            {mistakes.length > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-comment-ui
                      onClick={nextMistake}
                      // Flat like the chrome: the red is the signal.
                      className={cn(
                        pillClass,
                        enterClass,
                        'border border-danger-border bg-danger-bg text-danger tabular-nums hover:bg-[var(--ds-background-danger-hovered)] hover:text-danger active:bg-[var(--ds-background-danger-pressed)]',
                      )}
                    />
                  }
                >
                  <CircleAlert className="size-4" aria-hidden="true" />
                  <span>
                    {/* Keyed, so a new mistake rolls the number in. */}
                    <span key={mistakes.length} className="count-roll">
                      {mistakes.length}
                    </span>{' '}
                    {mistakes.length === 1 ? 'mistake' : 'mistakes'}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {mistakes.length === 1 ? 'Show it' : 'Show the next one'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      )}
      {!open && progress}
      {!open && answer}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  );
}
