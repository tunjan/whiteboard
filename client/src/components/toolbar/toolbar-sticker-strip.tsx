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
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { KeyTip } from './toolbar-primitives';

/** A board upload in the strip, with the key that removes it on hover. */
function CustomStickerItem({
  meta,
  selected,
  onPick,
}: {
  meta: CustomStickerMeta;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <div className="group relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        role="radio"
        aria-label={meta.label}
        aria-checked={selected}
        onClick={onPick}
        className="tbar-item w-full"
      >
        <img
          src={blobUrl(meta.blobId)}
          alt=""
          className="object-contain"
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
                'tbar-swatch-remove touch-reveal opacity-0 group-hover:opacity-100',
                'focus-visible:opacity-100 motion-reduce:transition-none',
              )}
            />
          }
        >
          <CloseGlyph />
        </TooltipTrigger>
        <KeyTip label="Remove for everyone" />
      </Tooltip>
    </div>
  );
}

/**
 * The sticker tool's palette, on the style plate while the tool is armed: a
 * sheet of stickers, each drawn as it lands on the board — die-cut halo and
 * drop shadow — and the armed one peeled up off the sheet, the way the bar's
 * tool in hand rises from its slot. Switching is one click and the next canvas
 * click stamps it. The board's uploads continue the same run, scrolling once
 * they outgrow the plate, and end on a blank spot on the sheet that adds one —
 * where the new upload lands.
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
    <div className="tbar-sheet">
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
              <StickerPreview def={def} size={46} />
            </TooltipTrigger>
            <KeyTip label={def.label} />
          </Tooltip>
        ))}
      </div>
      <div className="tbar-stickers">
        <div role="radiogroup" aria-label="Board stickers" className="contents">
          {boardStickers.map((meta) => (
            <CustomStickerItem
              key={meta.id}
              meta={meta}
              selected={meta.id === stickerId}
              onPick={() => setStickerId(meta.id)}
            />
          ))}
        </div>
        {Array.from({ length: pending }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="tbar-item tbar-sticker-pending animate-pulse motion-reduce:animate-none"
          />
        ))}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={error ? `${addLabel}. ${error}` : addLabel}
                disabled={pending > 0}
                onClick={() => void pickAndAddStickers()}
                className="tbar-item tbar-sticker-add"
                data-error={error ? true : undefined}
              />
            }
          >
            <PlusGlyph />
          </TooltipTrigger>
          <KeyTip label={error ?? addLabel} />
        </Tooltip>
      </div>
    </div>
  );
}
