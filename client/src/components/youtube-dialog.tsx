import { useState } from 'react';
import { screenToWorld } from '@/canvas/camera';
import { createYoutubeShape, parseYoutubeId } from '@/canvas/place-video';
import { useCameraStore } from '@/canvas/use-camera-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { useToolStore } from '@/canvas/use-tool-store';
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

/** Prompt for a YouTube URL and drop a video shape at the viewport center. */
export function YouTubeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);

  const close = () => {
    setUrl('');
    setError(false);
    onOpenChange(false);
  };

  const submit = () => {
    const videoId = parseYoutubeId(url);
    if (!videoId) {
      setError(true);
      return;
    }
    const center = screenToWorld(
      { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      useCameraStore.getState().camera,
    );
    const id = createYoutubeShape(videoId, center);
    useToolStore.getState().setTool('select');
    useSelectionStore.getState().setSelection([id]);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add YouTube video</DialogTitle>
          <DialogDescription>
            Paste a YouTube link to embed and play it on the board.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={url}
          placeholder="https://www.youtube.com/watch?v=…"
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          aria-invalid={error}
        />
        {error && (
          <p className="text-xs text-destructive">
            That doesn't look like a YouTube link.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!url.trim()}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
