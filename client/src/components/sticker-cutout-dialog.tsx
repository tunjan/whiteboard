import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AUTO_CUT_OUT,
  applyCutOut,
  type CutOutOptions,
} from '@/board/remove-background';
import {
  useCustomStickersStore,
  type StickerReview,
} from '@/canvas/use-custom-stickers-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

/** Checkerboard behind the preview, so erased pixels read as transparent. */
const CHECKER = {
  backgroundImage:
    'conic-gradient(var(--color-panel) 25%, var(--color-surface) 0 50%, var(--color-panel) 0 75%, var(--color-surface) 0)',
  backgroundSize: '16px 16px',
};

/**
 * Shown for each uploaded sticker before it is published: the automatic
 * cut-out is a guess, so this is where it gets kept, turned off, loosened or
 * tightened, or re-aimed by clicking the backdrop in the preview.
 */
export function StickerCutOutDialog() {
  const review = useCustomStickersStore((s) => s.review);
  const settle = useCustomStickersStore((s) => s.settleReview);

  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open) settle(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {review ? (
          // Remount per upload so each file starts from the automatic guess.
          <CutOutForm
            key={review.fileName + review.source.width}
            review={review}
            onSubmit={settle}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CutOutForm({
  review,
  onSubmit,
}: {
  review: StickerReview;
  onSubmit: (options: CutOutOptions | null) => void;
}) {
  const { source } = review;
  const switchId = useId();
  const [options, setOptions] = useState<CutOutOptions>(AUTO_CUT_OUT);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preview = useMemo(
    () => applyCutOut(source, options),
    [source, options],
  );

  useEffect(() => {
    canvasRef.current?.getContext('2d')?.putImageData(preview, 0, 0);
  }, [preview]);

  const pick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!options.remove) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(
      ((event.clientX - rect.left) / rect.width) * source.width,
    );
    const y = Math.floor(
      ((event.clientY - rect.top) / rect.height) * source.height,
    );
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
    setOptions((o) => ({ ...o, seed: y * source.width + x }));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New sticker</DialogTitle>
        <DialogDescription>
          {options.remove
            ? 'Click the image to pick the background colour.'
            : 'The image is added as it is.'}
        </DialogDescription>
      </DialogHeader>
      <div
        className="flex items-center justify-center rounded-control p-2"
        style={CHECKER}
      >
        <canvas
          ref={canvasRef}
          width={source.width}
          height={source.height}
          onClick={pick}
          aria-label="Sticker preview"
          className={`max-h-72 max-w-full object-contain ${options.remove ? 'cursor-crosshair' : ''}`}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label
          htmlFor={switchId}
          className="flex h-8 items-center justify-between gap-3"
        >
          <span className="text-sm text-fg-secondary">Remove background</span>
          <Switch
            id={switchId}
            checked={options.remove}
            onCheckedChange={(remove) => setOptions((o) => ({ ...o, remove }))}
          />
        </label>
        {options.remove ? (
          <div className="flex h-8 items-center gap-3">
            <span className="shrink-0 text-sm text-fg-secondary">
              Tolerance
            </span>
            <Slider
              aria-label="Tolerance"
              min={0.02}
              max={0.4}
              step={0.01}
              value={options.tolerance}
              onValueChange={(next) =>
                setOptions((o) => ({
                  ...o,
                  tolerance: Array.isArray(next) ? next[0]! : (next as number),
                }))
              }
            />
            {options.seed !== null ||
            options.tolerance !== AUTO_CUT_OUT.tolerance ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setOptions(AUTO_CUT_OUT)}
              >
                Auto
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onSubmit(null)}>
          Cancel
        </Button>
        <Button autoFocus onClick={() => onSubmit(options)}>
          Add sticker
        </Button>
      </DialogFooter>
    </>
  );
}
