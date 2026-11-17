import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, Send, Trash2, X } from 'lucide-react';
import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import {
  useCameraFollow,
  useCameraPlacement,
} from '@/canvas/use-camera-interaction';
import { getLocalUser } from '@/collab/presence';
import {
  addComment,
  addCommentReply,
  deleteCommentThread,
  setThreadResolved,
} from '@/canvas/board-records';
import { useDocumentStore } from '@/canvas/use-document-store';
import {
  type CommentMessage,
  useCommentsStore,
} from '@/canvas/use-comments-store';
import { colorOf } from '@/canvas/agent-actions';
import { CommentText } from '@/canvas/CommentText';
import { addCorrection, openMistakes, showMistake } from '@/canvas/work-checker';
import { buttonVariants } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const FALLBACK_AUTHOR = { name: 'Anonymous', color: '#2563EB' };
const POPUP_WIDTH = 320;

function localAuthor(): { name: string; color: string } {
  const user = getLocalUser();
  return user ? { name: user.name, color: user.color } : FALLBACK_AUTHOR;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

const iconButtonClass = cn(
  buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
);
// The reply row's primary action, sized against the 34px field rather than the
// 24px header controls.
const sendButtonClass = cn(
  buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
);
/** A thread header icon button, named by an app tooltip. */
function HeaderAction({
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
        render={<button type="button" aria-label={label} onClick={onClick} className={iconButtonClass} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

const textareaClass =
  'w-full resize-none rounded-control border border-border bg-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-strong';

function CommentPin({
  message,
  screen,
  open,
  onToggle,
}: {
  message: CommentMessage;
  screen: { x: number; y: number };
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-ui-layer
      data-comment-ui
      aria-label={
        message.box ? `Mistake: ${message.text}` : `Comment thread by ${message.authorName}`
      }
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onToggle}
      className={cn(
        // The centering -translate-* compiles to the independent CSS `translate`
        // property, and the tw-animate-css entrance animates `transform`, so the
        // pop-in zoom composes with (never overrides) the centering. The pin
        // stays mounted across camera pans (keyed by message id; only left/top
        // change), so the entrance plays once on mount, not per frame.
        'pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-surface text-2xs font-semibold text-fg transition-[transform,box-shadow] duration-200 ease-[var(--ease-out-expo)] hover:scale-110 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-reduce:transition-none',
        open && 'scale-110',
        // A mistake the checker has only just found rings twice, since an
        // always-on check reports nowhere else. Only while fresh, so a board
        // opened later doesn't ring every old pin.
        message.box && Date.now() - message.createdAt < 10_000 && 'pin-ring',
        // The checker's pin is the exception to the ring below: a mistake is
        // exactly the hazard a solid red dot says, and the surface-coloured
        // border cuts it cleanly out of the box corner it sits on.
        message.box && 'border-surface text-white',
      )}
      style={{
        left: screen.x,
        top: screen.y,
        // The identity colour rings a surface-coloured disc instead of filling
        // it. A solid fill spends the pin's whole area on the hue, and the one
        // saturated entry in the palette — TUTOR_COLOR — reads as a hazard dot
        // against the dark canvas at that size. Same treatment as the cursor
        // name tag: neutral chip, colour as the accent. It also keeps the
        // initial on `text-fg`, which is legible in both themes, where ink
        // reversed out of the raw colour was not.
        borderColor: message.box ? undefined : message.authorColor,
        // The checker's red is the theme's danger, not the colour stored on
        // the thread, so pin, box and count pill are one red.
        backgroundColor: message.box ? 'var(--ds-background-danger-bold)' : undefined,
        // The open halo is the pin's own colour at low alpha rather than a grey
        // `ring`, which read as a bullseye against the border.
        // The checker's open mark is the box round its line; a halo on top of
        // that reads as a target.
        boxShadow: open && !message.box
          ?`0 0 0 4px color-mix(in oklab, ${message.authorColor} 22%, transparent), var(--shadow-pin)`
          : 'var(--shadow-pin)',
      }}
    >
      {/* The checker is not a person: its pins say what they mark. */}
      {message.box ? (
        // Drawn rather than typed: a text "!" sits on the font's baseline and
        // never lands in the disc's optical centre.
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
          <rect x="5" y="1.5" width="2" height="6" rx="1" fill="currentColor" />
          <circle cx="6" cy="9.75" r="1.15" fill="currentColor" />
        </svg>
      ) : (
        initial(message.authorName)
      )}
    </button>
  );
}

function CommentComposer({
  point,
  camera,
  pageId,
  onDone,
}: {
  point: { x: number; y: number };
  camera: Camera;
  pageId: string;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addComment({
      pageId,
      x: point.x,
      y: point.y,
      text: trimmed,
      author: localAuthor(),
    });
    onDone();
  };

  const screen = worldToScreen(point, camera);

  return (
    <div
      data-ui-layer
      className="pointer-events-auto absolute z-[var(--z-canvas-front)] origin-top-left ease-[var(--ease-out-expo)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      style={{ left: screen.x, top: screen.y + 16 }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <Surface className="flex w-72 flex-col gap-2.5 p-3 shadow-hover">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Add a comment…"
          rows={2}
          className={textareaClass}
        />
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onDone}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
          >
            <Send className="size-3.5" />
            Send
          </button>
        </div>
      </Surface>
    </div>
  );
}

function ThreadPopup({
  root,
  replies,
  point,
  onClose,
}: {
  root: CommentMessage;
  replies: CommentMessage[];
  point: { x: number; y: number };
  onClose: () => void;
}) {
  const [reply, setReply] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const messages = useCommentsStore((s) => s.messages);
  const pageId = useDocumentStore((s) => s.currentPageId);
  const mistakes = root.box ? openMistakes(messages, pageId) : [];
  const mistakeAt = mistakes.findIndex((m) => m.id === root.id);
  // Clamped to the window, so where it sits depends on the real camera, not
  // just the zoom, and it cannot ride the pins' follower. Placed against the
  // live camera directly instead, so a pan still moves it without a render.
  // A press anywhere else on the board puts the thread away, the way a
  // popover does. Captured, because the canvas handles its own presses
  // without letting them bubble; pins and the mistake pill are exempt, since
  // they switch threads rather than leave them.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.('[data-comment-ui]')) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const place = useCameraPlacement<HTMLDivElement>((element, camera) => {
    const screen = worldToScreen(point, camera);
    let x = screen.x + 20;
    let y = screen.y - 12;
    // A mistake's popup must not cover the line it is about: right of the
    // line, else left of it, else under it, else over it.
    if (root.box && x + POPUP_WIDTH > window.innerWidth - 8) {
      const a = worldToScreen({ x: root.box.minX, y: root.box.minY }, camera);
      const b = worldToScreen({ x: root.box.maxX, y: root.box.maxY }, camera);
      const h = element.offsetHeight;
      if (a.x - 20 - POPUP_WIDTH >= 8) x = a.x - 20 - POPUP_WIDTH;
      else if (b.y + 12 + h <= window.innerHeight - 8) y = b.y + 12;
      else if (a.y - 12 - h >= 8) y = a.y - 12 - h;
    }
    const left = Math.min(Math.max(x, 8), window.innerWidth - POPUP_WIDTH - 8);
    const top = Math.max(
      Math.min(Math.max(y, 8), window.innerHeight - element.offsetHeight - 8),
      8,
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  const submitReply = () => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    addCommentReply(root.id, trimmed, localAuthor());
    setReply('');
  };

  return (
    <div
      ref={place}
      data-ui-layer
      data-comment-ui
      className="pointer-events-auto absolute z-[var(--z-canvas-front)] flex origin-top-left flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-float ease-[var(--ease-out-expo)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      style={{ width: POPUP_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-1 px-4 pt-4 pb-1">
        <span className="text-xs font-medium text-fg-muted tabular-nums">
          {root.box
            ? mistakes.length > 1 && mistakeAt >= 0
              ? `Mistake ${mistakeAt + 1} of ${mistakes.length}`
              : 'Mistake'
            : 'Thread'}
        </span>
        {/* Coarse pointers get full-size targets; the mouse keeps the
            compact row. */}
        <TooltipProvider delay={300}>
          <div className="touch-targets flex items-center gap-1">
            {mistakes.length > 1 && mistakeAt >= 0 && (
              <HeaderAction
                label="Next mistake"
                onClick={() => showMistake(mistakes[(mistakeAt + 1) % mistakes.length]!)}
              >
                <ChevronDown className="size-3.5" />
              </HeaderAction>
            )}
            <HeaderAction
              label={root.box ? 'Dismiss mistake' : 'Resolve thread'}
              onClick={() => {
                setThreadResolved(root.id, true, true);
                onClose();
              }}
            >
              <Check className="size-3.5" />
            </HeaderAction>
            <HeaderAction
              label="Delete thread"
              onClick={() => {
                deleteCommentThread(root.id);
                onClose();
              }}
            >
              <Trash2 className="size-3.5" />
            </HeaderAction>
            <HeaderAction label="Close thread" onClick={onClose}>
              <X className="size-3.5" />
            </HeaderAction>
          </div>
        </TooltipProvider>
      </div>

      <div className="flex max-h-64 flex-col gap-4 overflow-y-auto px-4 py-3">
        {[root, ...replies].map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            {/* The header already says "Mistake": a byline from a
                "Checker" that is not a person adds nothing. */}
            <div className={cn('flex items-center gap-2', m.box && 'hidden')}>
              {/* The name is right next to it, so the disc has no work to do
                  beyond identifying the author by colour — same 6px dot the
                  cursor name tag uses. */}
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: m.authorColor }}
              />
              <span className="text-xs font-medium text-fg">
                {m.authorName}
              </span>
              <span className="text-2xs text-fg-muted">
                {relativeTime(m.createdAt)}
              </span>
            </div>
            <CommentText text={m.text} className="text-sm text-fg" />
          </div>
        ))}
      </div>

      {root.correction && (
        <div className="flex flex-col gap-2 px-4 pb-2">
          {/* What the button will write, so adding it is a decision, not a
              leap: the same green the correction lands in on the board. */}
          <div style={{ color: colorOf('green', 'currentColor') }}>
            <CommentText
              text={`$$${root.correction}$$`}
              className="rounded-control bg-panel px-3 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            disabled={correcting}
            onClick={() => {
              setCorrecting(true);
              void addCorrection(root).finally(onClose);
            }}
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
          >
            {correcting && <Loader2 className="size-3.5 animate-spin" />}
            Add correction
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 pt-1 pb-4">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitReply();
            }
          }}
          // Nobody answers on the checker's behalf: what goes here is a note
          // for the people on the board.
          placeholder={root.box ? 'Add a note…' : 'Reply…'}
          rows={1}
          className={textareaClass}
        />
        <button
          type="button"
          aria-label="Send reply"
          onClick={submitReply}
          className={sendButtonClass}
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Miro-style comment pins + thread popups. Pins are anchored at a world
 * position and placed with `worldToScreen` against the zoom inside a camera
 * follower (`useCameraFollow`), so they keep a constant screen size and a pan
 * moves them without re-rendering.
 * Comments live in the Yjs doc (see use-document-store.ts) and are mirrored
 * into useCommentsStore; this layer only reads that store and calls the
 * mutation functions — it never touches the doc directly.
 */
export function CommentsLayer() {
  const [camera, follow] = useCameraFollow<HTMLDivElement>();
  const messages = useCommentsStore((s) => s.messages);
  const openThreadId = useCommentsStore((s) => s.openThreadId);
  const setOpenThreadId = useCommentsStore((s) => s.setOpenThreadId);
  const draft = useCommentsStore((s) => s.draft);
  const setDraft = useCommentsStore((s) => s.setDraft);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  const roots = Object.values(messages).filter(
    (m) => m.pageId === currentPageId && m.id === m.threadId && !m.resolved,
  );

  const openRoot = openThreadId ? messages[openThreadId] : undefined;
  const openReplies = openThreadId
    ? Object.values(messages)
        .filter((m) => m.threadId === openThreadId && m.id !== openThreadId)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];
  const boxAt = openRoot?.box
    ? worldToScreen({ x: openRoot.box.minX, y: openRoot.box.minY }, camera)
    : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[var(--z-canvas-front)] overflow-hidden">
      <div ref={follow} className="absolute top-0 left-0">
        {openRoot?.box && boxAt && (
          // The work checker's mark: the line its open thread is about. Before
          // the pins, so its border runs under the pin on its corner.
          <div
            // Keyed by thread, so moving to the next mistake lands again.
            key={openRoot.id}
            aria-hidden="true"
            className="mistake-land pointer-events-none absolute rounded-md border-2 border-dashed border-[var(--ds-border-danger)] bg-[color-mix(in_srgb,var(--ds-border-danger)_8%,transparent)]"
            style={{
              left: boxAt.x,
              top: boxAt.y,
              width: (openRoot.box.maxX - openRoot.box.minX) * camera.z,
              height: (openRoot.box.maxY - openRoot.box.minY) * camera.z,
            }}
          />
        )}
        {roots.map((root) => (
          <CommentPin
            key={root.id}
            message={root}
            screen={worldToScreen({ x: root.x ?? 0, y: root.y ?? 0 }, camera)}
            open={openThreadId === root.id}
            onToggle={() =>
              setOpenThreadId(openThreadId === root.id ? null : root.id)
            }
          />
        ))}


        {draft && (
          <CommentComposer
            // World-coord key: remounts (replaying the entrance) when a new
            // spot is clicked, but is untouched by camera pan/zoom.
            key={`${draft.x},${draft.y}`}
            point={draft}
            camera={camera}
            pageId={currentPageId}
            onDone={() => setDraft(null)}
          />
        )}
      </div>

      {openRoot && (
        <ThreadPopup
          // Keyed by thread so switching pins remounts and replays the entrance.
          key={openRoot.id}
          root={openRoot}
          replies={openReplies}
          point={{ x: openRoot.x ?? 0, y: openRoot.y ?? 0 }}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </div>
  );
}
