import { useState } from 'react';
import {
  ChevronDownGlyph,
  ImageGlyph,
  LockGlyph,
  LockOpenGlyph,
  MoreGlyph,
  PlusGlyph,
  StickerGlyph,
  VideoGlyph,
} from '@/components/ui/glyphs';
import { blobUrl } from '@/board/blobs';
import { pickAndAddStickers } from '@/board/custom-stickers';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { STICKERS } from '@/canvas/shapes/sticker-catalog';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { YouTubeDialog } from '@/components/youtube-dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  COMPACT_MORE_TOOLS,
  hueVars,
  toolKeyClass,
  TOOL_ICON,
} from './toolbar-constants';

interface CompactMoreMenuProps {
  activeToolId: string;
  onHide: () => void;
}

export function CompactMoreMenu({
  activeToolId,
  onHide,
}: CompactMoreMenuProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const setTool = useToolStore((state) => state.setTool);
  const locked = useToolLockStore((state) => state.locked);
  const toggleLock = useToolLockStore((state) => state.toggle);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );

  const active = [...COMPACT_MORE_TOOLS, 'sticker'].includes(activeToolId);
  const activeLabel = toolRegistry.get(activeToolId)?.label;
  const label =
    active && activeLabel
      ? `More tools, ${activeLabel} selected`
      : 'More tools';

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                data-toolbar-item
                tabIndex={active ? 0 : -1}
                aria-label={label}
                aria-current={active ? 'true' : undefined}
                style={hueVars(active ? activeToolId : undefined)}
                className={toolKeyClass()}
              />
            }
          >
            <MoreGlyph className={TOOL_ICON} />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>{label}</span>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className="w-52"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>More tools</DropdownMenuLabel>
            {COMPACT_MORE_TOOLS.map((toolId) => {
              const tool = toolRegistry.get(toolId);
              if (!tool) return null;
              const Icon = tool.icon;
              const isSelected = tool.id === activeToolId;

              return (
                <DropdownMenuItem
                  key={toolId}
                  onClick={() => setTool(tool.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={cn(isSelected && 'bg-panel font-medium text-fg')}
                >
                  {Icon ? <Icon className="size-4" /> : null}
                  <span>{tool.label}</span>
                  {tool.hotkey && (
                    <DropdownMenuShortcut>
                      {tool.hotkey.toUpperCase()}
                    </DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <StickerGlyph className="size-4" />
              <span>Stickers</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {STICKERS.map((definition) => {
                const Icon = definition.Icon;
                return (
                  <DropdownMenuItem
                    key={definition.id}
                    onClick={() => {
                      setStickerId(definition.id);
                      setTool('sticker');
                    }}
                  >
                    <Icon className="size-4" />
                    <span>{definition.label}</span>
                  </DropdownMenuItem>
                );
              })}
              {boardStickers.map((meta) => (
                <DropdownMenuItem
                  key={meta.id}
                  onClick={() => {
                    setStickerId(meta.id);
                    setTool('sticker');
                  }}
                >
                  <img
                    src={blobUrl(meta.blobId)}
                    alt=""
                    className="size-4 object-contain"
                    draggable={false}
                  />
                  <span>{meta.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void pickAndAddStickers()}>
                <PlusGlyph className="size-4" />
                <span>Add PNG sticker</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ImageGlyph className="size-4" />
              <span>Media</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
                <ImageGlyph className="size-4" />
                <span>Add image</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVideoOpen(true)}>
                <VideoGlyph className="size-4" />
                <span>Add YouTube video</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuCheckboxItem
            checked={locked}
            onCheckedChange={toggleLock}
          >
            {locked ? (
              <LockGlyph className="size-4" />
            ) : (
              <LockOpenGlyph className="size-4" />
            )}
            <span>Tool lock</span>
            <DropdownMenuShortcut>Q</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>

          <DropdownMenuItem onClick={onHide}>
            <ChevronDownGlyph className="size-4" />
            <span>Hide toolbar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}
