import type { CustomStickerMeta } from '@whiteboard/shared';
import { CloseGlyph, PlusGlyph } from '@/components/ui/glyphs';
import { blobUrl } from '@/board/blobs';
import { pickAndAddStickers } from '@/board/custom-stickers';
import { removeCustomSticker } from '@/canvas/board-records';
import { STICKERS, StickerPreview } from '@/canvas/shapes/sticker-catalog';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function CustomStickerItem({
  meta,
  selected,
  onPick,
  radio = false,
}: {
  meta: CustomStickerMeta;
  selected: boolean;
  onPick: () => void;
  /** Mark the choice as a radio, for a strip that is a radiogroup. */
  radio?: boolean;
}) {
  return (
    <div className="group relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        role={radio ? 'radio' : undefined}
        aria-label={meta.label}
        aria-checked={radio ? selected : undefined}
        aria-current={!radio && selected ? 'true' : undefined}
        onClick={onPick}
        className="tbar-item w-full"
      >
        <img
          src={blobUrl(meta.blobId)}
          alt=""
          className="size-6 object-contain"
          draggable={false}
        />
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${meta.label} from this board`}
              onClick={(e) => {
                e.stopPropagation();
                removeCustomSticker(meta.id);
              }}
              className={cn(
                'absolute -top-1 -right-1 size-4 rounded-md border border-border bg-surface p-0',
                'opacity-0 transition-opacity group-hover:opacity-100',
                'focus-visible:opacity-100 motion-reduce:transition-none',
              )}
            />
          }
        >
          <CloseGlyph className="size-3 text-fg-muted hover:text-fg" />
        </TooltipTrigger>
        <TooltipContent side="top">Remove for everyone</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * The sticker tool's palette, on the style plate while the tool is armed: every
 * stamp in colour, the armed one on a neutral pill, so switching is one click
 * and the next canvas click stamps it. Board uploads follow the built-ins, then
 * the key that adds one.
 */
export function StickerStrip() {
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );
  const pending = useCustomStickersStore((state) => state.pending);
  const error = useCustomStickersStore((state) => state.error);

  const addLabel = pending > 0 ? 'Removing background…' : 'Add sticker';

  return (
    <div className="flex items-center gap-0.5">
      <div role="radiogroup" aria-label="Sticker" className="tbar-stickers">
        {STICKERS.map((def) => (
          <Tooltip key={def.id}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  role="radio"
                  aria-label={def.label}
                  aria-checked={def.id === stickerId}
                  onClick={() => setStickerId(def.id)}
                  className="tbar-item"
                />
              }
            >
              <StickerPreview def={def} size={22} />
            </TooltipTrigger>
            <TooltipContent side="top">{def.label}</TooltipContent>
          </Tooltip>
        ))}
        {boardStickers.map((meta) => (
          <CustomStickerItem
            key={meta.id}
            meta={meta}
            radio
            selected={meta.id === stickerId}
            onPick={() => setStickerId(meta.id)}
          />
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={error ? `${addLabel}. ${error}` : addLabel}
              disabled={pending > 0}
              onClick={() => void pickAndAddStickers()}
              className={cn('tbar-item', error && 'text-danger')}
            />
          }
        >
          <PlusGlyph />
        </TooltipTrigger>
        <TooltipContent side="top">{error ?? addLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}
