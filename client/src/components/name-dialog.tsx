import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** First-visit prompt for a student's display name. */
export function NameDialog({
  open,
  color,
  onSubmit,
}: {
  open: boolean;
  color: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = () => onSubmit(name.trim() || 'Guest');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) submit();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join the board</DialogTitle>
          <DialogDescription>
            Choose a display name so others can see who&apos;s drawing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit}>Join</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
