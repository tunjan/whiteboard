import { useState } from 'react';
import {
  ImageGlyph,
  PlusGlyph,
  VideoGlyph,
} from '@/components/ui/glyphs';
import { blobUrl } from '@/board/blobs';
import { pickAndAddStickers } from '@/board/custom-stickers';
import { pickAndPlaceImages } from '@/canvas/place-image';
import {
  getSticker,
  STICKERS,
  StickerPreview,
} from '@/canvas/shapes/sticker-catalog';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { YouTubeDialog } from '@/components/youtube-dialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { TOOL_FLYOUT } from './toolbar-constants';
import { CustomStickerItem } from './toolbar-sticker-strip';
import { ToolbarItem } from './toolbar-primitives';

interface InsertMenuProps {
  active: boolean;
}

export function InsertMenu({ active }: InsertMenuProps) {
  const [open, setOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const setTool = useToolStore((state) => state.setTool);
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const customStickers = useCustomStickersStore((state) => state.stickers);
  const pending = useCustomStickersStore((state) => state.pending);
  const uploadError = useCustomStickersStore((state) => state.error);
  const custom = customStickers[stickerId];
  const boardStickers = sortedCustomStickers(customStickers);
  const selectedSticker = getSticker(stickerId);
  const SelectedIcon = selectedSticker.Icon;

  const label = active
    ? `${custom ? custom.label : selectedSticker.label} sticker selected`
    : 'Insert';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <ToolbarItem
          label={label}
          selected={active}
          caret
          tabIndex={active ? 0 : -1}
          render={<PopoverTrigger />}
        >
          {active && custom ? (
            <img
              src={blobUrl(custom.blobId)}
              alt=""
              className="size-5 object-contain"
              draggable={false}
            />
          ) : active ? (
            <SelectedIcon />
          ) : (
            <ImageGlyph />
          )}
        </ToolbarItem>

        <PopoverContent
          side="top"
          align="center"
          sideOffset={6}
          className={cn(TOOL_FLYOUT, 'w-64 gap-2')}
        >
          <PopoverHeader>
            <PopoverTitle>Insert</PopoverTitle>
            <PopoverDescription>
              Add stickers or media to canvas
            </PopoverDescription>
          </PopoverHeader>

          {/* Preset Stickers */}
          <div
            className="grid grid-cols-4 gap-0.5"
            role="group"
            aria-label="Preset Stickers"
          >
            {STICKERS.map((definition) => {
              const isSelected = active && definition.id === stickerId;
              return (
                <Button
                  key={definition.id}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={definition.label}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => {
                    setStickerId(definition.id);
                    setTool('sticker');
                    setOpen(false);
                  }}
                  className="tbar-item"
                >
                  <StickerPreview def={definition} size={22} />
                </Button>
              );
            })}
          </div>

          {/* Custom Board Stickers */}
          {boardStickers.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-sm font-medium text-fg-muted">
                Board stickers
              </div>
              <div
                className="grid grid-cols-4 gap-0.5"
                role="group"
                aria-label="Board stickers"
              >
                {boardStickers.map((meta) => (
                  <CustomStickerItem
                    key={meta.id}
                    meta={meta}
                    selected={active && meta.id === stickerId}
                    onPick={() => {
                      setStickerId(meta.id);
                      setTool('sticker');
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Media Action List */}
          <div className="grid gap-1 border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-control text-sm text-fg-secondary hover:bg-tb-track hover:text-fg"
              disabled={pending > 0}
              onClick={() => void pickAndAddStickers()}
            >
              <PlusGlyph className="mr-1 size-4 text-fg-muted" aria-hidden="true" />
              {pending > 0 ? 'Removing background…' : 'Add sticker'}
            </Button>
            {uploadError && (
              <p role="alert" className="px-2 text-2xs text-danger">
                {uploadError}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-control text-sm text-fg-secondary hover:bg-tb-track hover:text-fg"
              onClick={() => {
                setOpen(false);
                void pickAndPlaceImages();
              }}
            >
              <ImageGlyph
                className="mr-1 size-4 text-fg-muted"
                aria-hidden="true"
              />
              Add image
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-control text-sm text-fg-secondary hover:bg-tb-track hover:text-fg"
              onClick={() => {
                setOpen(false);
                setVideoOpen(true);
              }}
            >
              <VideoGlyph
                className="mr-1 size-4 text-fg-muted"
                aria-hidden="true"
              />
              Add YouTube video
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}
