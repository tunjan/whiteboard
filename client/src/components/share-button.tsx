import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { useDocumentStore } from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';

/** Build the shareable URL for a board, pinned to the page being viewed. */
export function shareUrl(boardId: string, pageId: string): string {
  const url = new URL(`/board/${encodeURIComponent(boardId)}`, location.origin);
  url.searchParams.set('p', pageId);
  return url.toString();
}

/**
 * Share control (top-right chrome, tldraw-style). Copies a capability link to
 * the board that opens straight to the page the sharer is currently viewing.
 */
export function ShareButton() {
  const boardId = useDocumentStore((s) => s.boardId);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardId ? shareUrl(boardId, currentPageId) : '';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — fall back to select.
      rootRef.current?.querySelector('input')?.select();
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div ref={rootRef} className="relative" data-ui-layer>
      <Button
        variant="default"
        size="sm"
        aria-label="Share board"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-8 rounded-lg"
      >
        <Share2 data-icon="inline-start" />
        <span className="hidden sm:inline">Share</span>
      </Button>

      {open ? (
        <Surface className="absolute top-10 right-0 z-30 flex w-80 flex-col gap-2 p-3">
          <div className="text-sm font-semibold text-foreground">
            Share this board
          </div>
          <p className="text-xs text-muted-foreground">
            Anyone with the link can view and edit. It opens to the page you're
            on now.
          </p>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            />
            <Button
              variant={copied ? 'outline' : 'default'}
              size="sm"
              onClick={copy}
              className="h-8 shrink-0 rounded-md"
            >
              {copied ? (
                <Check data-icon="inline-start" />
              ) : (
                <Copy data-icon="inline-start" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Surface>
      ) : null}
    </div>
  );
}
