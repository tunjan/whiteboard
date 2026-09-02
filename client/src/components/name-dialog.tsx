import { useEffect, useRef, useState } from 'react';
import { CursorIcon } from '@/collab/CursorsLayer';
import { STUDENT_COLORS } from '@/collab/identity';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn, swatchBorder } from '@/lib/utils';

/** What an unnamed student is called, and what the field previews while empty. */
const DEFAULT_NAME = 'Guest';

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
      className="flex h-24 items-center justify-center rounded-overlay border border-border bg-canvas"
    >
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
 * Dismissing means different things on the two paths. Editing follows the rest
 * of the app: Escape and the close button discard. On first visit there is
 * nothing to discard back to, so leaving joins as `DEFAULT_NAME` — the name the
 * empty field has been previewing all along.
 */
export function NameDialog({
  open,
  initialName = '',
  initialColor,
  editing = false,
  colorEditable = true,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  initialName?: string;
  initialColor: string;
  editing?: boolean;
  colorEditable?: boolean;
  onSubmit: (name: string, color: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const submit = () => onSubmit(name.trim() || DEFAULT_NAME, color);

  // Sync internal state to the current identity each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
    }
  }, [open, initialName, initialColor]);

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
      <DialogContent showCloseButton={editing} className="gap-6 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Your identity' : 'Join the board'}
          </DialogTitle>
        </DialogHeader>

        <IdentityPreview name={name.trim() || DEFAULT_NAME} color={color} />

        <div className="flex flex-col gap-4">
          <Input
            aria-label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={DEFAULT_NAME}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {colorEditable && <ColorRow color={color} onChange={setColor} />}
        </div>

        <DialogFooter>
          {editing && (
            <Button variant="secondary" onClick={() => onCancel?.()}>
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={submit}>
            {editing ? 'Save' : 'Join'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
