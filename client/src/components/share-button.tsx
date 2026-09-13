import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { useDocumentStore } from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';

/** Build the shareable URL for a board, pinned to the page being viewed. */
export function shareUrl(boardId: string, pageId: string): string {
  const url = new URL(`/board/${encodeURIComponent(boardId)}`, location.origin);
  url.searchParams.set('p', pageId);
  return url.toString();
}

/**
 * Share control for the top-right chrome. Copies a capability link to
 * the board that opens straight to the page the sharer is currently viewing.
 */
export function ShareButton() {
  const boardId = useDocumentStore((s) => s.boardId);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const pageName = useDocumentStore((s) => s.doc.pages[currentPageId]?.name);
  const pageCount = useDocumentStore((s) => s.doc.pageOrder.length);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const link = boardId ? shareUrl(boardId, currentPageId) : '';

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
      inputRef.current?.select();
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-toolbar-item
            tabIndex={-1}
            aria-label="Share board"
            className="rounded-md"
          />
        }
      >
        <Share2 data-icon="inline-start" />
        <span className="hidden md:inline">Share</span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        // Copying is the whole job, so Enter on open does it.
        initialFocus={copyRef}
        className={cn(CHROME_CONTROLS, 'w-[min(22rem,calc(100vw-2rem))] gap-4 p-4')}
      >
        <PopoverHeader>
          <PopoverTitle>Share board</PopoverTitle>
          <PopoverDescription className="text-pretty">
            Anyone with the link can view and edit.
          </PopoverDescription>
        </PopoverHeader>
        <InputGroup className="h-9 bg-panel">
          <InputGroupAddon>
            <Link2 aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            readOnly
            value={link}
            title={link}
            aria-label="Board link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-full py-0 font-mono text-xs text-fg-secondary"
          />
        </InputGroup>
        <div className="flex items-end gap-3">
          {/* A one-page board has nowhere else to open, so only name the
              page when the link could land somewhere unexpected. */}
          {pageCount > 1 && pageName ? (
            <p className="min-w-0 truncate text-xs text-fg-muted">
              Opens on <span className="font-medium text-fg-secondary">{pageName}</span>
            </p>
          ) : null}
          <Button ref={copyRef} variant="primary" size="sm" onClick={copy} className="ml-auto">
            {/* Both labels share one grid cell so the button keeps the
                width of the longer one and nothing beside it shifts. */}
            <span className="grid">
              <span
                className={cn(
                  'col-start-1 row-start-1 flex items-center justify-center gap-1.5',
                  copied && 'invisible',
                )}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Copy link
              </span>
              <span
                className={cn(
                  'col-start-1 row-start-1 flex items-center justify-center gap-1.5',
                  !copied && 'invisible',
                )}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Copied
              </span>
            </span>
          </Button>
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Link copied' : ''}
        </span>
      </PopoverContent>
    </Popover>
  );
}
