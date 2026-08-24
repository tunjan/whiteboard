import { useState } from 'react';
import { ImagePlus, Plus, Presentation, X } from 'lucide-react';
import type { CustomStickerMeta } from '@whiteboard/shared';
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
import { removeCustomSticker } from '@/canvas/use-document-store';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  FlyoutCaret,
  TOOL_PRESSED,
  toolButtonClass,
} from './toolbar-constants';

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
        aria-label={meta.label}
        aria-current={selected ? 'true' : undefined}
        onClick={onPick}
        className={cn(
          'w-full rounded-lg transition-colors duration-fast',
          selected ? TOOL_PRESSED : 'hover:bg-panel',
        )}
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
          <X className="size-3 text-fg-muted hover:text-fg" />
        </TooltipTrigger>
        <TooltipContent side="top">Remove for everyone</TooltipContent>
      </Tooltip>
    </div>
  );
}

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
  const TriggerIcon = active && !custom ? SelectedIcon : ImagePlus;

  const label = active
    ? `${custom ? custom.label : selectedSticker.label} sticker selected`
    : 'Insert';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                data-toolbar-item
                tabIndex={active ? 0 : -1}
                aria-label={label}
                aria-current={active ? 'true' : undefined}
                className={toolButtonClass(active)}
              />
            }
          >
            {active && custom ? (
              <img
                src={blobUrl(custom.blobId)}
                alt=""
                className="size-5 object-contain"
                draggable={false}
              />
            ) : (
              <TriggerIcon className="size-4.5" />
            )}
            <FlyoutCaret active={active} />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>{label}</span>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className="w-64"
        >
          <PopoverHeader>
            <PopoverTitle>Insert</PopoverTitle>
            <PopoverDescription>
              Add stickers or media to canvas
            </PopoverDescription>
          </PopoverHeader>

          {/* Preset Stickers */}
          <div
            className="grid grid-cols-4 gap-1"
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
                  className={cn(
                    'size-9 rounded-lg transition-colors duration-fast',
                    isSelected ? TOOL_PRESSED : 'hover:bg-panel',
                  )}
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
                className="grid grid-cols-4 gap-1"
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
              className="w-full justify-start text-sm text-fg-secondary hover:bg-panel hover:text-fg"
              disabled={pending > 0}
              onClick={() => void pickAndAddStickers()}
            >
              <Plus className="mr-1 size-4 text-fg-muted" aria-hidden="true" />
              {pending > 0 ? 'Removing background…' : 'Add PNG sticker'}
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
              className="w-full justify-start text-sm text-fg-secondary hover:bg-panel hover:text-fg"
              onClick={() => {
                setOpen(false);
                void pickAndPlaceImages();
              }}
            >
              <ImagePlus
                className="mr-1 size-4 text-fg-muted"
                aria-hidden="true"
              />
              Add image
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-sm text-fg-secondary hover:bg-panel hover:text-fg"
              onClick={() => {
                setOpen(false);
                setVideoOpen(true);
              }}
            >
              <Presentation
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
