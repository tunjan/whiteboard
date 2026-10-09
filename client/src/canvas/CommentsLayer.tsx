import { useEffect, useRef, useState } from 'react';
import { Check, Send, Trash2, X } from 'lucide-react';
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
import { CommentText } from '@/canvas/CommentText';
import { buttonVariants } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

const FALLBACK_AUTHOR = { name: 'Anonymous', color: '#2563EB' };
const POPUP_WIDTH = 320;
/** Roughly the popup at its tallest, used only to keep it inside the viewport. */
const POPUP_MAX_HEIGHT = 380;

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
      aria-label={`Comment thread by ${message.authorName}`}
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
        borderColor: message.authorColor,
        // The open halo is the pin's own colour at low alpha rather than a grey
        // `ring`, which read as a bullseye against the border.
        boxShadow: open
          ? `0 0 0 4px color-mix(in oklab, ${message.authorColor} 22%, transparent), var(--shadow-hover)`
          : 'var(--shadow-hover)',
      }}
    >
      {initial(message.authorName)}
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
  // Clamped to the window, so where it sits depends on the real camera, not
  // just the zoom, and it cannot ride the pins' follower. Placed against the
  // live camera directly instead, so a pan still moves it without a render.
  const place = useCameraPlacement<HTMLDivElement>((element, camera) => {
    const screen = worldToScreen(point, camera);
    const left = Math.min(
      Math.max(screen.x + 20, 8),
      window.innerWidth - POPUP_WIDTH - 8,
    );
    const top = Math.max(
      Math.min(
        Math.max(screen.y - 12, 8),
        window.innerHeight - POPUP_MAX_HEIGHT,
      ),
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
      className="pointer-events-auto absolute z-[var(--z-canvas-front)] flex origin-top-left flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-hover ease-[var(--ease-out-expo)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
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
        <span className="text-xs font-medium text-fg-muted">Thread</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Resolve thread"
            onClick={() => {
              setThreadResolved(root.id, true);
              onClose();
            }}
            className={iconButtonClass}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete thread"
            onClick={() => {
              deleteCommentThread(root.id);
              onClose();
            }}
            className={iconButtonClass}
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close thread"
            onClick={onClose}
            className={iconButtonClass}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex max-h-64 flex-col gap-4 overflow-y-auto px-4 py-3">
        {[root, ...replies].map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
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
          placeholder="Reply…"
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

  return (
    <div className="pointer-events-none absolute inset-0 z-[var(--z-canvas-front)] overflow-hidden">
      <div ref={follow} className="absolute top-0 left-0">
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
