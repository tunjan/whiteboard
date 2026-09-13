import { useEffect, useMemo, useState } from 'react';
import {
  type BoardNotes,
  type SessionNote,
  deleteSessionNote,
  getBoardNotes,
  getSessionNotes,
  saveBoardNotes,
  saveSessionNote,
  todayKey,
} from '@/board/board-notes';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
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

/** 'YYYY-MM-DD' → local midnight. Not `new Date(key)`, which reads it as UTC. */
function parseDate(date: string): Date | null {
  const [y, m, d] = date.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** 'YYYY-MM-DD' → the tutor's locale, without re-reading it as UTC midnight. */
function formatDate(date: string): string {
  return (
    parseDate(date)?.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) ?? date
  );
}

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
  const [sessions, setSessions] = useState<SessionNote[]>([]);
  // The day the calendar has selected — the note being edited when one exists
  // for it, and the day the Add button would create one for when none does.
  const [selected, setSelected] = useState(todayKey());
  // Edits are only written on Save, so Cancel discards them like the other panes.
  const [dirtyDates, setDirtyDates] = useState<string[]>([]);
  const [removedDates, setRemovedDates] = useState<string[]>([]);
  const [tab, setTab] = useState('notes');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch the latest notes each time the dialog opens — never cached locally.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setDirtyDates([]);
    setRemovedDates([]);
    void Promise.all([getBoardNotes(boardId), getSessionNotes(boardId)])
      .then(([notes, dated]) => {
        if (cancelled) return;
        setValue(notes);
        setSessions(dated);
        // The most recent session is what a tutor opens this pane to re-read.
        setSelected(dated[0]?.date ?? todayKey());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const active = useMemo(
    () => sessions.find((s) => s.date === selected) ?? null,
    [sessions, selected],
  );
  // Days the calendar dots, so the months themselves index the sessions.
  const sessionDays = useMemo(
    () => sessions.map((s) => parseDate(s.date)).filter((d) => d !== null),
    [sessions],
  );
  const selectedDay = useMemo(() => parseDate(selected), [selected]);

  const addSession = () => {
    if (active) return;
    setSessions((prev) =>
      [...prev, { date: selected, body: '' }].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
    );
    setDirtyDates((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
    setRemovedDates((prev) => prev.filter((d) => d !== selected));
  };

  const editSession = (body: string) => {
    if (!active) return;
    setSessions((prev) =>
      prev.map((s) => (s.date === selected ? { ...s, body } : s)),
    );
    setDirtyDates((prev) =>
      prev.includes(selected) ? prev : [...prev, selected],
    );
  };

  const removeSession = () => {
    if (!active) return;
    setSessions((prev) => prev.filter((s) => s.date !== selected));
    setDirtyDates((prev) => prev.filter((d) => d !== selected));
    setRemovedDates((prev) =>
      prev.includes(selected) ? prev : [...prev, selected],
    );
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveBoardNotes(boardId, value);
      await Promise.all(removedDates.map((d) => deleteSessionNote(boardId, d)));
      await Promise.all(
        dirtyDates.map((d) => {
          const note = sessions.find((s) => s.date === d);
          return note ? saveSessionNote(boardId, d, note.body) : undefined;
        }),
      );
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
      <DialogContent className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Student notes</DialogTitle>
          <DialogDescription>Private — students never see these.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(next) => setTab(next as string)}>
          <TabsList aria-label="Notes sections">
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="errors">Errors</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
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
              className="min-h-[19rem]"
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
              className="min-h-[19rem]"
            />
          </TabsContent>
          <TabsContent value="sessions" className="mt-3">
            <div className="flex gap-3">
              {/* Calendar and its Add button share one bordered container so the
                  picker reads as a single control rather than two stacked ones. */}
              <div className="flex shrink-0 flex-col rounded-control border border-border bg-surface">
                <Calendar
                  mode="single"
                  required
                  selected={selectedDay ?? undefined}
                  onSelect={(day) => day && setSelected(todayKey(day))}
                  defaultMonth={selectedDay ?? undefined}
                  disabled={loading}
                  modifiers={{ hasNote: sessionDays }}
                  modifiersClassNames={{
                    // A dot under the numeral, drawn on the day's button so it
                    // is not hidden behind it. `bg-current` so it stays legible
                    // once the day is selected and inverts its foreground.
                    hasNote:
                      '[&>button]:after:absolute [&>button]:after:bottom-1 [&>button]:after:left-1/2 [&>button]:after:size-1 [&>button]:after:-translate-x-1/2 [&>button]:after:rounded-full [&>button]:after:bg-current [&>button]:after:opacity-70',
                  }}
                  className="bg-transparent"
                />
                {/* One live control rather than an Add that goes dead the
                    moment the day has a note: the day either needs adding or
                    it has a note that can be removed. */}
                <div className="border-t border-border p-2">
                  <Button
                    size="sm"
                    variant={active ? 'destructive' : 'subtle'}
                    className="w-full"
                    onClick={active ? removeSession : addSession}
                    disabled={loading}
                  >
                    {active ? 'Delete session' : 'Add session'}
                  </Button>
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="truncate text-xs font-medium text-fg-secondary">
                  {formatDate(selected)}
                </span>
                <Textarea
                  aria-label={`Notes for ${formatDate(selected)}`}
                  value={active?.body ?? ''}
                  onChange={(e) => editSession(e.target.value)}
                  disabled={loading || !active}
                  placeholder={
                    loading
                      ? 'Loading…'
                      : active
                        ? 'What you covered, homework set, tests coming up…'
                        : 'No session on this day — add one to start a note.'
                  }
                  className="min-h-[16.5rem] flex-1"
                />
              </div>
            </div>
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
