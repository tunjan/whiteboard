import { useEffect, useId, useState } from 'react';
import { getBoardNotes, saveBoardNotes } from '@/board/board-notes';
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
import { Textarea } from '@/components/ui/textarea';

export function BoardNotesDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch the latest notes each time the dialog opens — never cached locally.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getBoardNotes(boardId)
      .then((notes) => {
        if (!cancelled) setValue(notes);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveBoardNotes(boardId, value);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Student Notes</DialogTitle>
          <DialogDescription>
            Private to you — students never see these notes.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={inputId}>
              Student Notes
            </FieldLabel>
            <Textarea
              id={inputId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={loading}
              placeholder={
                loading ? 'Loading…' : 'Notes about this student…'
              }
              className="min-h-[12rem]"
              autoFocus
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={loading || saving}>
            Save Notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
