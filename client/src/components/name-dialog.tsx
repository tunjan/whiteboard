import { useEffect, useRef, useState } from 'react';
import { CursorIcon } from '@/collab/CursorsLayer';
import { STUDENT_COLORS } from '@/collab/identity';
import { type PeerPresence, usePresenceStore } from '@/collab/use-presence-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DOT_GRID_REST_PX, GROUND_FADE_MASK } from '@/canvas/grid';
import { cn, swatchBorder } from '@/lib/utils';

/** What an unnamed student is called, and what the field previews while empty. */
const DEFAULT_NAME = 'Guest';

/** Long enough for a full name, short enough that a cursor tag stays a tag. */
const MAX_NAME_LENGTH = 32;

/** How many faces the arrival line stacks before it lets the count speak. */
const MAX_FACES = 4;

/** The board's own paper under the preview, as the loading veil paints it. */
const PAPER: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)',
  backgroundSize: `${DOT_GRID_REST_PX}px ${DOT_GRID_REST_PX}px`,
  maskImage: GROUND_FADE_MASK,
  WebkitMaskImage: GROUND_FADE_MASK,
};

/** "Alberto", "Alberto and Marco", "Alberto, Marco and 3 others". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/**
 * Who is already on the board, tutor first. A link lands you in a room, and the
 * first thing worth knowing about a room is who is in it: it is what turns a
 * form into an arrival, and "first one here" is what keeps an empty board from
 * reading as a broken one.
 */
function WhoIsHere() {
  const peers = usePresenceStore((s) => s.peers);
  const people = [...peers].sort(
    (a, b) => Number(b.isTutor) - Number(a.isTutor),
  );
  const names = people.map((p: PeerPresence) => p.name);

  return (
    <div className="flex min-h-6 items-center gap-2.5">
      {people.length > 0 && (
        <div aria-hidden="true" className="flex -space-x-1.5">
          {people.slice(0, MAX_FACES).map((p) => (
            <span
              key={p.clientId}
              className="flex size-6 items-center justify-center rounded-full text-2xs font-medium text-white ring-2 ring-surface"
              style={{ backgroundColor: p.color }}
            >
              {p.name.trim().charAt(0).toUpperCase() || '?'}
            </span>
          ))}
        </div>
      )}
      <p className="flex items-center gap-2 text-sm text-fg-secondary">
        {people.length > 0 ? (
          <>
            {/* Live, not a count someone typed: the dot says so. */}
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-success-fg motion-safe:animate-pulse"
            />
            <span className="line-clamp-1">
              {listNames(names)} {names.length === 1 ? 'is' : 'are'} here
            </span>
          </>
        ) : (
          "You're the first one here"
        )}
      </p>
    </div>
  );
}

/**
 * How the board will label you to everyone else: the same cursor and name tag
 * CursorsLayer paints, at rest on a plate the colour of the canvas.
 *
 * It stands in for the labels and the explanatory line this dialog used to
 * carry — a name field and a row of colours need no caption once you can see
 * what they add up to.
 */
function IdentityPreview({ name, color }: { name: string; color: string }) {
  return (
    <div
      aria-hidden="true"
      className="relative flex h-24 items-center justify-center overflow-hidden rounded-overlay border border-border bg-canvas"
    >
      <div className="absolute inset-0" style={PAPER} />
      <div className="relative">
        <span className="absolute -top-3 -left-3">
          <CursorIcon color={color} />
        </span>
        {/* Same chrome as the live tag, so this is a preview and not a mockup. */}
        <span className="flex h-6 max-w-40 items-center gap-1.5 rounded-lg border border-border bg-surface/95 px-2 text-2xs leading-none font-medium text-fg shadow-e2">
          <span
            className="size-1.5 shrink-0 rounded-full transition-colors duration-fast motion-reduce:transition-none"
            style={{ backgroundColor: color }}
          />
          <span className="truncate">{name}</span>
        </span>
      </div>
    </div>
  );
}

/** One row of the identity palette. Arrow keys move and select, as elsewhere. */
function ColorRow({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + STUDENT_COLORS.length) % STUDENT_COLORS.length;
    const swatch = STUDENT_COLORS[next];
    if (!swatch) return;
    onChange(swatch);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Color"
      className="flex justify-between px-0.5"
    >
      {STUDENT_COLORS.map((swatch, index) => {
        const active = color === swatch;
        return (
          <button
            key={swatch}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={swatch}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(swatch)}
            onKeyDown={(event) => {
              const delta =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (!delta) return;
              event.preventDefault();
              move(index, delta);
            }}
            className="flex size-8 items-center justify-center rounded-full transition-colors duration-fast outline-none hover:bg-panel motion-reduce:transition-none"
          >
            <span
              className={cn(
                'size-5 rounded-full border',
                active && 'ring-2 ring-focus ring-offset-2 ring-offset-surface',
              )}
              style={{
                backgroundColor: swatch,
                borderColor: swatchBorder(swatch),
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Prompt for a student's display name and cursor color. Used both on first
 * visit and to edit an existing identity (prefilled via `initialName`/`initialColor`).
 *
 * The first visit is an arrival, not a form: it says where you are and who is
 * already there before it asks who you are, and its one button says what it
 * will do — "Join as Guest" makes the empty field's consequence plain instead
 * of leaving it to a placeholder.
 *
 * Dismissing means different things on the two paths. Editing follows the rest
 * of the app: Escape and the close button discard. On first visit there is
 * nothing to discard back to, so leaving joins as `DEFAULT_NAME` — the name the
 * button has been promising all along.
 */
export function NameDialog({
  open,
  initialName = '',
  initialColor,
  editing = false,
  colorEditable = true,
  boardTitle,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  initialName?: string;
  initialColor: string;
  editing?: boolean;
  colorEditable?: boolean;
  /** Named on the first visit, so the card says which board you are joining. */
  boardTitle?: string;
  onSubmit: (name: string, color: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const shownName = name.trim() || DEFAULT_NAME;
  const submit = () => onSubmit(shownName, color);

  // Sync internal state to the current identity each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
    }
  }, [open, initialName, initialColor]);

  const field = (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={MAX_NAME_LENGTH}
        autoComplete="given-name"
        enterKeyHint="go"
        autoFocus
        className={cn(!editing && 'h-10 px-3 text-base')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {colorEditable && <ColorRow color={color} onChange={setColor} />}
    </div>
  );

  return (
    <Dialog
      open={open}
      // A stray click on the backdrop should not settle someone's identity for
      // them on the way in.
      disablePointerDismissal={!editing}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        if (editing) onCancel?.();
        else submit();
      }}
    >
      {editing ? (
        <DialogContent className="gap-6 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Your identity</DialogTitle>
          </DialogHeader>
          <IdentityPreview name={shownName} color={color} />
          {field}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onCancel?.()}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        <DialogContent
          showCloseButton={false}
          className="gap-5 p-6 sm:max-w-sm sm:p-7"
        >
          <div className="flex flex-col gap-3">
            <WhoIsHere />
            <DialogTitle className="text-xl leading-7 text-balance">
              {boardTitle || 'Join the board'}
            </DialogTitle>
          </div>
          <IdentityPreview name={shownName} color={color} />
          {field}
          <Button
            variant="primary"
            className="h-10 w-full text-base"
            onClick={submit}
          >
            <span className="truncate">Join as {shownName}</span>
          </Button>
        </DialogContent>
      )}
    </Dialog>
  );
}
