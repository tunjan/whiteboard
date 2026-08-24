import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { useDocumentStore } from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      <PopoverContent side="bottom" align="end" sideOffset={8} className={cn(CHROME_CONTROLS, 'w-80')}>
        <PopoverHeader>
          <PopoverTitle>Share board</PopoverTitle>
          <PopoverDescription className="text-pretty text-xs leading-5">
            Anyone with the link can view and edit. It opens to the page you're
            on now.
          </PopoverDescription>
        </PopoverHeader>
        <div className="grid gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={link}
            title={link}
            aria-label="Share link"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full font-mono text-sm text-fg"
          />
          <Button
            variant={copied ? 'outline' : 'default'}
            onClick={copy}
            className="w-full"
          >
            {copied ? (
              <Check data-icon="inline-start" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Link copied' : ''}
        </span>
      </PopoverContent>
    </Popover>
  );
}
