import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Link2, RotateCw, Share2, UserX } from 'lucide-react';
import type { BoardShare, ShareMode } from '@whiteboard/shared';
import {
  boardKey,
  fetchBoardShare,
  removeStudent,
  resetShareLink,
  setShareMode,
  useBoardAccessStore,
} from '@/board/board-access';
import { usePresenceStore } from '@/collab/use-presence-store';
import { useDocumentStore } from '@/canvas/use-document-store';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
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

/**
 * Build the shareable URL for a board, pinned to the page being viewed. `key`
 * is what makes it open for someone who is not the tutor.
 */
export function shareUrl(boardId: string, pageId: string, key: string): string {
  const url = new URL(`/board/${encodeURIComponent(boardId)}`, location.origin);
  if (key) url.searchParams.set('k', key);
  url.searchParams.set('p', pageId);
  return url.toString();
}

const MODE_LABELS: Record<ShareMode, string> = {
  edit: 'Can edit',
  view: 'View only',
  off: 'Off',
};

const MODE_DESCRIPTIONS: Record<ShareMode, string> = {
  edit: 'Anyone with the link can view and edit.',
  view: 'Anyone with the link can view.',
  off: 'The link is off. Only you can open this board.',
};

/**
 * Share control for the top-right chrome. Copies a link to the board that
 * opens straight to the page the sharer is currently viewing.
 *
 * For the tutor it is also where the link is governed: what it grants, a new
 * one to replace every copy handed out so far, and who is in the room.
 */
export function ShareButton({ isTutor }: { isTutor: boolean }) {
  const boardId = useDocumentStore((s) => s.boardId);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const pageName = useDocumentStore((s) => s.doc.pages[currentPageId]?.name);
  const pageCount = useDocumentStore((s) => s.doc.pageOrder.length);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [share, setShare] = useState<BoardShare | null>(null);
  const access = useBoardAccessStore((s) => s.access);
  const students = usePresenceStore((s) => s.peers).filter((p) => !p.isTutor);

  // A student passes on the link they came in by; the tutor's own URL has no
  // key, so theirs is asked for each time the popover opens.
  const key = isTutor ? share?.key : boardKey();
  const link = boardId && key ? shareUrl(boardId, currentPageId, key) : '';
  const mode: ShareMode = isTutor
    ? (share?.mode ?? 'edit')
    : access === 'view'
      ? 'view'
      : 'edit';

  // Another board's key must never be shown or copied here.
  const [shareBoardId, setShareBoardId] = useState(boardId);
  if (shareBoardId !== boardId) {
    setShareBoardId(boardId);
    setShare(null);
  }

  useEffect(() => {
    if (!open || !isTutor || !boardId) return;
    let cancelled = false;
    void fetchBoardShare(boardId).then(
      (next) => {
        if (!cancelled) setShare(next);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [open, isTutor, boardId]);

  const update = (request: Promise<BoardShare>) =>
    void request.then(setShare, () => {});

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
      {/* A key like its neighbours on the rail: an icon, a tooltip, no fill. */}
      <TooltipProvider delay={300}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    data-toolbar-item
                    tabIndex={-1}
                    aria-label="Share board"
                  />
                }
              />
            }
          >
            <Share2 aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="bottom">Share board</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
            {MODE_DESCRIPTIONS[mode]}
          </PopoverDescription>
        </PopoverHeader>
        {isTutor && boardId ? (
          <ToggleGroup
            className="w-full"
            aria-label="What the link allows"
            value={[mode]}
            onValueChange={(values) =>
              values[0] &&
              values[0] !== mode &&
              update(setShareMode(boardId, values[0] as ShareMode))
            }
          >
            {(Object.keys(MODE_LABELS) as ShareMode[]).map((m) => (
              <ToggleGroupItem key={m} value={m} className="grow basis-0 text-xs">
                {MODE_LABELS[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
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
          {/* Replacing the link is how every copy already handed out stops
              working, so it sits on the link it replaces. */}
          {isTutor && boardId ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Replace link"
                title="New link — every copy of this one stops working"
                onClick={() => update(resetShareLink(boardId))}
              >
                <RotateCw aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <div className="flex items-end gap-3">
          {/* A one-page board has nowhere else to open, so only name the
              page when the link could land somewhere unexpected. */}
          {pageCount > 1 && pageName ? (
            <p className="min-w-0 truncate text-xs text-fg-muted">
              Opens on <span className="font-medium text-fg-secondary">{pageName}</span>
            </p>
          ) : null}
          <Button
            ref={copyRef}
            variant="primary"
            size="sm"
            onClick={copy}
            disabled={!link}
            className="ml-auto"
          >
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
        {isTutor && boardId && students.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border pt-3">
            {students.map((student) => (
              <li key={student.clientId} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: student.color }}
                />
                <span className="min-w-0 flex-1 truncate">{student.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${student.name}`}
                  title={`Remove ${student.name}`}
                  onClick={() => void removeStudent(boardId, student.clientId)}
                >
                  <UserX aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {copied ? 'Link copied' : ''}
        </span>
      </PopoverContent>
    </Popover>
  );
}
