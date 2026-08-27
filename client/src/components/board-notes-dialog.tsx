import { useEffect, useState } from 'react';
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
      <DialogContent className="gap-5 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Student notes</DialogTitle>
          <DialogDescription>Private — students never see these.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(next) => setTab(next as string)}>
          <TabsList aria-label="Notes sections">
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="errors">Errors</TabsTrigger>
          </TabsList>
          <TabsContent value="notes" className="mt-3">
            <Textarea
              aria-label="Student notes"
              value={value.notes}
              onChange={(e) =>
                setValue((prev) => ({ ...prev, notes: e.target.value }))
              }
              disabled={loading}
              placeholder={loading ? 'Loading…' : 'Notes about this student…'}
              className="min-h-[16rem]"
              autoFocus
            />
          </TabsContent>
          <TabsContent value="errors" className="mt-3">
            <Textarea
              aria-label="Error log"
              value={value.errorLog}
              onChange={(e) =>
                setValue((prev) => ({ ...prev, errorLog: e.target.value }))
              }
              disabled={loading}
              placeholder={
                loading ? 'Loading…' : 'Mistakes to revisit with this student…'
              }
              className="min-h-[16rem]"
            />
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
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
