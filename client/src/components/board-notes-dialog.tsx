import { useEffect, useId, useState } from 'react';
import { type BoardNotes, getBoardNotes, saveBoardNotes } from '@/board/board-notes';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const EMPTY: BoardNotes = { notes: '', errorLog: '' };

export function BoardNotesDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notesId = useId();
  const errorLogId = useId();
  const [value, setValue] = useState<BoardNotes>(EMPTY);
  const [tab, setTab] = useState('notes');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch the latest notes each time the dialog opens — never cached locally.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getBoardNotes(boardId)
      .then((next) => {
        if (!cancelled) setValue(next);
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
        <Tabs value={tab} onValueChange={(next) => setTab(next as string)}>
          <TabsList aria-label="Student notes sections">
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="errors">Error Log</TabsTrigger>
          </TabsList>
          <TabsContent value="notes">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={notesId}>Student Notes</FieldLabel>
                <Textarea
                  id={notesId}
                  value={value.notes}
                  onChange={(e) =>
                    setValue((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  disabled={loading}
                  placeholder={loading ? 'Loading…' : 'Notes about this student…'}
                  className="min-h-[12rem]"
                  autoFocus
                />
              </Field>
            </FieldGroup>
          </TabsContent>
          <TabsContent value="errors">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={errorLogId}>Error Log</FieldLabel>
                <Textarea
                  id={errorLogId}
                  value={value.errorLog}
                  onChange={(e) =>
                    setValue((prev) => ({ ...prev, errorLog: e.target.value }))
                  }
                  disabled={loading}
                  placeholder={
                    loading ? 'Loading…' : 'Mistakes to revisit with this student…'
                  }
                  className="min-h-[12rem]"
                />
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>
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
