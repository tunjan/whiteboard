import { useEffect, useId, useState } from 'react';
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

/**
 * Prompt for a student's display name. Used both on first visit and to edit
 * an existing identity (prefilled via `initialName`).
 */
export function NameDialog({
  open,
  initialName = '',
  editing = false,
  onSubmit,
}: {
  open: boolean;
  initialName?: string;
  editing?: boolean;
  onSubmit: (name: string) => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const submit = () => onSubmit(name.trim() || 'Guest');

  // Sync internal state to the current identity each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

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
            Choose a display name so others can see who&apos;s drawing.
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
        </FieldGroup>
        <DialogFooter>
          <Button onClick={submit}>{editing ? 'Save Identity' : 'Join Board'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
