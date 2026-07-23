import { useEffect, useId, useState } from 'react';
import { STUDENT_COLORS } from '@/collab/identity';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const swatchBorder = (color: string) => `color-mix(in srgb, ${color} 75%, #000)`;

/**
 * Prompt for a student's display name and cursor color. Used both on first
 * visit and to edit an existing identity (prefilled via `initialName`/`initialColor`).
 */
export function NameDialog({
  open,
  initialName = '',
  initialColor,
  editing = false,
  colorEditable = true,
  onSubmit,
}: {
  open: boolean;
  initialName?: string;
  initialColor: string;
  editing?: boolean;
  colorEditable?: boolean;
  onSubmit: (name: string, color: string) => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const submit = () => onSubmit(name.trim() || 'Guest', color);

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
      onOpenChange={(o) => {
        if (!o) submit();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Your Identity' : 'Join the Board'}</DialogTitle>
          <DialogDescription>
            Choose a display name and color so others can see who&apos;s drawing.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={inputId}>Display Name</FieldLabel>
            <Input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </Field>
          {colorEditable && (
            <Field>
              <FieldLabel>Favorite Color</FieldLabel>
              <div role="radiogroup" aria-label="Favorite color" className="flex flex-wrap gap-2">
                {STUDENT_COLORS.map((swatch) => {
                  const active = color === swatch;
                  return (
                    <button
                      key={swatch}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={swatch}
                      onClick={() => setColor(swatch)}
                      className="flex size-8 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-95"
                    >
                      <span
                        className={cn(
                          'size-6 rounded-full border',
                          active && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
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
            </Field>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit}>{editing ? 'Save Identity' : 'Join Board'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
