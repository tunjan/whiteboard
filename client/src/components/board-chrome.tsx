import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { type Identity } from '@/collab/identity';
import { BoardActionsMenu } from '@/components/board-actions-menu';
import { FollowFrame } from '@/components/follow-frame';
import { KeyboardShortcutsDialog } from '@/components/keyboard-shortcuts-dialog';
import { PageMenu } from '@/components/page-menu';
import { SessionRail } from '@/components/session-rail';
import { Button } from '@/components/ui/button';
import { INSTRUMENT, Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

// Its calendar pulls in react-day-picker and date-fns; only tutors open it.
const BoardNotesDialog = lazy(() =>
  import('@/components/board-notes-dialog').then((m) => ({
    default: m.BoardNotesDialog,
  })),
);
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * The board's chrome: two corners, and one band.
 *
 * Top-left is **where you are** — the board, and the page inside it. Top-right
 * is **who is here and what is running** ([[SessionRail]]). At rest both are
 * washes flush into the window frame, with no edge between them, so the top of
 * the screen reads as one strip of context rather than as two objects parked in
 * the corners. Reach for either and it takes the plate, because the board's one
 * material rule still holds: an edge means you can press it. It simply stops
 * claiming that from across the room, which is what let the corners outweigh
 * the drawing they frame.
 *
 * Nothing here is labelled except the board's own name and Share. The two
 * menus say they are menus with a caret, the page says it belongs to the board
 * by sitting recessed inside the same row, and the session rail says what is
 * running by putting it on the rail. Structure carries it; the words are in
 * tooltips and accessible names, where they cost nothing to anyone who does
 * not need them.
 */
export function BoardChrome({
  boardId,
  title,
  onBack,
  onRenameTitle,
  onEditIdentity,
  identity,
}: {
  boardId: string;
  title: string;
  onBack: () => void;
  onRenameTitle?: () => void;
  onEditIdentity?: () => void;
  identity: Identity | null;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  // Stays mounted after the first open so the close animation still plays.
  const [notesMounted, setNotesMounted] = useState(false);
  if (notesOpen && !notesMounted) setNotesMounted(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const isTutor = identity?.isTutor === true;
  // Students join by shared link and are not authenticated, so renaming — and
  // the boards list behind the back arrow — exist only for the tutor.
  const renameTitle = isTutor ? onRenameTitle : undefined;

  return (
    <>
      {/* First, so every instrument paints over the frame's edge. */}
      <FollowFrame identity={identity} />

      {/* ── Top-left: where you are ─────────────────────────────────────────
          Back │ Board ▾  Page ▾

          The board's name is the menu. Everything that menu holds is a thing
          you do *to this board* — rename it, export it, read its notes, set
          how it behaves — so hanging them off the board's own name costs the
          corner a key and tells the truth about what they belong to. The ⋯ it
          replaces said nothing about its own contents.

          The page then sits recessed inside that row: on this board a recess
          means "a value inside a group", which is exactly what a page is
          inside a board. That is the separator, and it needed no glyph. */}
      <Surface
        role="navigation"
        aria-label="Board"
        data-arrive="down"
        style={{ '--arrive-i': 0 } as React.CSSProperties}
        mode="docked"
        chrome
        className={cn(
          INSTRUMENT,
          'absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-[calc(0.75rem+env(safe-area-inset-left))] max-w-[calc(100vw-1.5rem)] gap-1 [--chrome-hover:var(--color-panel)] md:max-w-[50vw]',
        )}
      >
        {isTutor && (
          <TooltipProvider delay={300}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Back to boards"
                    onClick={onBack}
                  />
                }
              >
                <ArrowLeft />
              </TooltipTrigger>
              <TooltipContent side="bottom">Back to boards</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        <BoardActionsMenu
          boardId={boardId}
          title={title}
          isTutor={isTutor}
          onOpenNotes={() => setNotesOpen(true)}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onRenameTitle={renameTitle}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${title}, board menu`}
              className="max-w-[clamp(5rem,20vw,12.5rem)] rounded-control px-2 font-medium text-fg"
            />
          }
          triggerContent={
            <>
              <span className="truncate">{title}</span>
              <ChevronDown
                aria-hidden="true"
                className="-mr-0.5 size-3.5 shrink-0 text-fg-muted"
              />
            </>
          }
        />

        <PageMenu className="bg-tb-seg-chip" />
      </Surface>

      {/* ── Top-right: who is here, and what is running ─────────────────── */}
      <SessionRail identity={identity} onEditIdentity={onEditIdentity} />

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
      {isTutor && notesMounted && (
        <Suspense fallback={null}>
          <BoardNotesDialog
            boardId={boardId}
            open={notesOpen}
            onOpenChange={setNotesOpen}
          />
        </Suspense>
      )}
    </>
  );
}
