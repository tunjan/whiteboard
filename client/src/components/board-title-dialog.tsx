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

export function BoardTitleDialog({
  open,
  heading,
  description,
  initialValue = '',
  submitLabel,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  heading: string;
  description?: string;
  initialValue?: string;
  submitLabel: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => void | Promise<void>;
}) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const trimmed = value.trim();

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={inputId}>
              Whiteboard Title
            </FieldLabel>
            <Input
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Untitled Whiteboard"
              autoFocus
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!trimmed || submitting}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
