import { useEffect, useRef, useState } from 'react';
import { Check, Send, Trash2, X } from 'lucide-react';
import type { Camera } from '@/canvas/camera';
import { worldToScreen } from '@/canvas/camera';
import { getLocalUser } from '@/collab/presence';
import {
  addComment,
  addCommentReply,
  deleteCommentThread,
  setThreadResolved,
  useDocumentStore,
} from '@/canvas/use-document-store';
import { type CommentMessage, useCommentsStore } from '@/canvas/use-comments-store';
import { buttonVariants } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

const FALLBACK_AUTHOR = { name: 'Anonymous', color: '#2563EB' };
const POPUP_WIDTH = 288;

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
const textareaClass =
  'w-full resize-none rounded-md border border-border bg-muted px-2 py-1.5 text-sm text-primary placeholder:text-faint-foreground focus-visible:border-strong';

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
        'pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-surface text-2xs font-semibold text-inverse shadow-hover transition-transform duration-200 ease-[var(--ease-out-expo)] hover:scale-110 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-50 motion-reduce:transition-none',
        open && 'scale-110 ring-2 ring-strong',
      )}
      style={{
        left: screen.x,
        top: screen.y,
        backgroundColor: message.authorColor,
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
    addComment({ pageId, x: point.x, y: point.y, text: trimmed, author: localAuthor() });
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
      <Surface className="flex w-64 flex-col gap-2 p-2 shadow-hover">
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
  screen,
  onClose,
}: {
  root: CommentMessage;
  replies: CommentMessage[];
  screen: { x: number; y: number };
  onClose: () => void;
}) {
  const [reply, setReply] = useState('');

  const submitReply = () => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    addCommentReply(root.id, trimmed, localAuthor());
    setReply('');
  };

  const left = Math.min(
    Math.max(screen.x + 20, 8),
    window.innerWidth - POPUP_WIDTH - 8,
  );
  const top = Math.min(Math.max(screen.y - 12, 8), window.innerHeight - 320);

  return (
    <div
      data-ui-layer
      className="pointer-events-auto absolute z-[var(--z-canvas-front)] flex origin-top-left flex-col overflow-hidden rounded-md border border-border bg-surface shadow-hover ease-[var(--ease-out-expo)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      style={{ left, top, width: POPUP_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-tertiary">Thread</span>
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

      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto px-3 py-2">
        {[root, ...replies].map((m) => (
          <div key={m.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className="flex size-4 shrink-0 items-center justify-center rounded-full text-2xs font-semibold text-inverse"
                style={{ backgroundColor: m.authorColor }}
              >
                {initial(m.authorName)}
              </span>
              <span className="text-xs font-medium text-primary">
                {m.authorName}
              </span>
              <span className="text-2xs text-tertiary">
                {relativeTime(m.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-primary">
              {m.text}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-1.5 border-t border-border p-2">
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
          className={iconButtonClass}
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Miro-style comment pins + thread popups. Modeled on CursorsLayer: pins are
 * anchored at a world position but positioned in screen space via
 * `worldToScreen`, so they pan/zoom with the canvas at constant screen size.
 * Comments live in the Yjs doc (see use-document-store.ts) and are mirrored
 * into useCommentsStore; this layer only reads that store and calls the
 * mutation functions — it never touches the doc directly.
 */
export function CommentsLayer({ camera }: { camera: Camera }) {
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
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
          // World-coord key: remounts (replaying the entrance) when a new spot
          // is clicked, but is untouched by camera pan/zoom.
          key={`${draft.x},${draft.y}`}
          point={draft}
          camera={camera}
          pageId={currentPageId}
          onDone={() => setDraft(null)}
        />
      )}

      {openRoot && (
        <ThreadPopup
          // Keyed by thread so switching pins remounts and replays the entrance.
          key={openRoot.id}
          root={openRoot}
          replies={openReplies}
          screen={worldToScreen(
            { x: openRoot.x ?? 0, y: openRoot.y ?? 0 },
            camera,
          )}
          onClose={() => setOpenThreadId(null)}
        />
      )}
    </div>
  );
}
