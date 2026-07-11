import { useEffect, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { DoodleAvatar, randomAvatarSeed } from '@/collab/avatar';
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

const GRID_SIZE = 5;

function makeOptions(include: string): string[] {
  const seeds = [include];
  while (seeds.length < GRID_SIZE) seeds.push(randomAvatarSeed());
  return seeds;
}

/**
 * Prompt for a student's display name and doodle avatar. Used both on first
 * visit and to edit an existing identity (prefilled via `initialName`).
 */
export function NameDialog({
  open,
  initialName = '',
  initialAvatar,
  editing = false,
  onSubmit,
}: {
  open: boolean;
  initialName?: string;
  initialAvatar: string;
  editing?: boolean;
  onSubmit: (name: string, avatar: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [seed, setSeed] = useState(initialAvatar);
  const [options, setOptions] = useState(() => makeOptions(initialAvatar));
  const submit = () => onSubmit(name.trim() || 'Guest', seed);

  // Sync internal state to the current identity each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setSeed(initialAvatar);
      setOptions(makeOptions(initialAvatar));
    }
  }, [open, initialName, initialAvatar]);

  const shuffle = () => {
    const next = randomAvatarSeed();
    setSeed(next);
    setOptions(makeOptions(next));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) submit();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit your icon' : 'Join the board'}</DialogTitle>
          <DialogDescription>
            Pick an icon and a display name so others can see who&apos;s drawing.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel className="sr-only">Choose an icon</FieldLabel>
            <div className="flex items-center gap-2">
              {options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSeed(option)}
                  className={cn(
                    'size-11 shrink-0 overflow-hidden rounded-full border-2 transition-all',
                    option === seed
                      ? 'border-content-emphasis'
                      : 'border-border-subtle hover:border-border',
                  )}
                >
                  <DoodleAvatar seed={option} className="size-full" />
                </button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={shuffle}
                aria-label="Shuffle icons"
                title="Shuffle"
              >
                <Shuffle className="size-4" />
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel className="sr-only">Display name</FieldLabel>
            <Input
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
          <Button onClick={submit}>{editing ? 'Save' : 'Join'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
