import { useState } from 'react';
import {
  ChevronDownGlyph,
  ImageGlyph,
  LockGlyph,
  MoreGlyph,
  PlusGlyph,
  StickerGlyph,
  UnitCircleGlyph,
  VideoGlyph,
} from '@/components/ui/glyphs';
import { PanelBottom, PanelLeft } from 'lucide-react';
import { blobUrl } from '@/board/blobs';
import { pickAndAddStickers } from '@/board/custom-stickers';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { gridParts, placePreset, unitCircleParts } from '@/canvas/place-preset';
import { STICKERS, StickerPreview } from '@/canvas/shapes/sticker-catalog';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  COMPACT_MORE_TOOLS,
  CONSTRUCTION_TOOLS,
  HIDE_KEYS,
} from './toolbar-constants';
import { refocusForKeyboard, useToolbarSide } from './toolbar-primitives';
import { ToolKey, toolArt, toolGlyph } from './toolbar-tool-button';

interface CompactMoreMenuProps {
  activeToolId: string;
  onHide: () => void;
  expanded?: boolean;
}

/** The largest blank table the size picker offers, each way. */
const TABLE_MAX = 8;

/**
 * Pick a blank table's size the way a word processor does: point at a cell,
 * and every cell above and left of it lights up as the table to insert.
 */
function TableSizePicker() {
  const [size, setSize] = useState({ rows: 0, cols: 0 });
  const cells = [];
  for (let r = 1; r <= TABLE_MAX; r++) {
    for (let c = 1; c <= TABLE_MAX; c++) {
      const pick = () => setSize({ rows: r, cols: c });
      cells.push(
        <DropdownMenuItem
          key={`${r}x${c}`}
          aria-label={`Table ${r} by ${c}`}
          data-on={r <= size.rows && c <= size.cols}
          onPointerEnter={pick}
          onFocus={pick}
          onClick={() => placePreset(gridParts(r, c))}
          className="size-4 min-h-0 rounded-[3px] border border-border p-0 focus:bg-transparent data-[on=true]:border-tb-sel-bg data-[on=true]:bg-tb-sel-bg"
        />,
      );
    }
  }
  return (
    <div className="px-1 py-1">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${TABLE_MAX}, 1rem)` }}
      >
        {cells}
      </div>
      <p className="pt-1.5 text-center text-xs text-fg-muted tabular-nums">
        {size.rows ? `${size.rows} × ${size.cols}` : 'Table'}
      </p>
    </div>
  );
}

/** A sticker cell: icon-only, so the grid reads as a palette, not a list. */
const STICKER_CELL =
  'size-9 justify-center p-0 aria-[current=true]:bg-tb-sel-bg aria-[current=true]:text-tb-sel-fg';

/**
 * The overflow: every tool that does not earn a key, plus the bar's settings.
 * Nothing the bar already offers is repeated here: polygons live behind the
 * Shapes key, and stickers and images appear only where their keys folded away.
 *
 * A real menu, so it gets menu keyboard handling for free: the tools are one
 * radio group (exactly one tool is on), stickers and templates are submenus,
 * and tool lock is a checkbox item.
 */
export function CompactMoreMenu({
  activeToolId,
  onHide,
  expanded = false,
}: CompactMoreMenuProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const side = useToolbarSide();
  const placement = useCanvasUiStore((state) => state.toolbarPlacement);
  const setPlacement = useCanvasUiStore((state) => state.setToolbarPlacement);

  const setTool = useToolStore((state) => state.setTool);
  const locked = useToolLockStore((state) => state.locked);
  const toggleLock = useToolLockStore((state) => state.toggle);
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );

  const menuTools: readonly string[] = expanded
    ? ['comment', 'equation', ...CONSTRUCTION_TOOLS]
    : COMPACT_MORE_TOOLS;
  // Lit only for a tool with no key of its own.
  const active =
    (!expanded && activeToolId === 'sticker') || menuTools.includes(activeToolId);
  const activeTool = active ? toolRegistry.get(activeToolId) : undefined;
  const label = activeTool ? `More tools, ${activeTool.label} selected` : 'More tools';
  // A tool held from in here shows on the key, or nothing would say which.
  const ActiveIcon = activeTool?.icon;
  const activeArt = activeTool ? toolArt(activeTool.id) : null;
  const activeGlyph = activeTool ? toolGlyph(activeTool.id) : null;

  const pickSticker = (id: string) => {
    setStickerId(id);
    setTool('sticker');
  };

  // Built-ins, then this board's uploads: one grid, one cell.
  const stickers = [
    ...STICKERS.map((def) => ({
      id: def.id,
      label: def.label,
      preview: <StickerPreview def={def} size={20} />,
    })),
    ...boardStickers.map((meta) => ({
      id: meta.id,
      label: meta.label,
      preview: (
        <img
          src={blobUrl(meta.blobId)}
          alt=""
          className="size-5 object-contain"
          draggable={false}
        />
      ),
    })),
  ];

  return (
    <>
      <DropdownMenu>
        <ToolKey
          label={label}
          pressed={active}
          render={<DropdownMenuTrigger />}
          art={activeArt !== null}
        >
          {activeArt ?? activeGlyph ?? (ActiveIcon ? <ActiveIcon /> : <MoreGlyph />)}
        </ToolKey>

        <DropdownMenuContent
          side={side}
          align="end"
          sideOffset={8}
          finalFocus={refocusForKeyboard}
          className="drawer-popup w-56"
        >
          <DropdownMenuRadioGroup value={activeToolId} onValueChange={setTool}>
            {menuTools.map((toolId) => {
              const tool = toolRegistry.get(toolId);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <DropdownMenuRadioItem key={toolId} value={tool.id}>
                  {Icon ? <Icon className="size-4" /> : null}
                  {tool.label}
                  {tool.hotkey ? (
                    <DropdownMenuShortcut className="pointer-coarse:hidden">
                      {tool.hotkey.toUpperCase()}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            {!expanded && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <StickerGlyph className="size-4" />
                  Stickers
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <div className="grid max-h-56 grid-cols-4 gap-0.5 overflow-y-auto">
                    {stickers.map(({ id, label: stickerLabel, preview }) => (
                      <DropdownMenuItem
                        key={id}
                        title={stickerLabel}
                        aria-label={stickerLabel}
                        aria-current={
                          activeToolId === 'sticker' && stickerId === id
                            ? 'true'
                            : undefined
                        }
                        onClick={() => pickSticker(id)}
                        className={STICKER_CELL}
                      >
                        {preview}
                      </DropdownMenuItem>
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void pickAndAddStickers()}>
                    <PlusGlyph className="size-4" />
                    Add sticker
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UnitCircleGlyph className="size-4" />
                Templates
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => placePreset(unitCircleParts())}>
                  <UnitCircleGlyph className="size-4" />
                  Unit circle
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <TableSizePicker />
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {!expanded && (
              <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
                <ImageGlyph className="size-4" />
                Add image
                <DropdownMenuShortcut>U</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setVideoOpen(true)}>
              <VideoGlyph className="size-4" />
              Add YouTube video
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem checked={locked} onCheckedChange={toggleLock}>
              <LockGlyph className="size-4" />
              Tool lock
              <DropdownMenuShortcut>Q</DropdownMenuShortcut>
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              onClick={() =>
                setPlacement(placement === 'left' ? 'bottom' : 'left')
              }
            >
              {placement === 'left' ? (
                <PanelBottom className="size-4" />
              ) : (
                <PanelLeft className="size-4" />
              )}
              {placement === 'left' ? 'Move toolbar to bottom' : 'Move toolbar to side'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHide}>
              <ChevronDownGlyph className="size-4" />
              Hide toolbar
              <DropdownMenuShortcut className="pointer-coarse:hidden">{HIDE_KEYS}</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}
