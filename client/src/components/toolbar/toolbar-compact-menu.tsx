import { useState } from 'react';
import {
  ChevronDownGlyph,
  ImageGlyph,
  LockGlyph,
  MoreGlyph,
  PlusGlyph,
  PolygonGlyph,
  StickerGlyph,
  UnitCircleGlyph,
  VideoGlyph,
} from '@/components/ui/glyphs';
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
import type { PolygonKind } from '@whiteboard/shared';
import {
  COMPACT_MORE_TOOLS,
  CONSTRUCTION_TOOLS,
  SHAPE_TOOLS,
  POLYGON_KINDS,
  MiniShape,
} from './toolbar-constants';
import { ToolKey } from './toolbar-tool-button';

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
 *
 * A real menu, so it gets menu keyboard handling for free: the tools are one
 * radio group (exactly one tool is on), polygons and stickers are submenus,
 * and tool lock is a checkbox item.
 */
export function CompactMoreMenu({
  activeToolId,
  onHide,
  expanded = false,
}: CompactMoreMenuProps) {
  const [videoOpen, setVideoOpen] = useState(false);

  const setTool = useToolStore((state) => state.setTool);
  const locked = useToolLockStore((state) => state.locked);
  const toggleLock = useToolLockStore((state) => state.toggle);
  const polygonKind = useStyleStore((state) => state.polygonKind);
  const setPolygonKind = useStyleStore((state) => state.setPolygonKind);
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );

  const menuTools: readonly string[] = expanded
    ? [...SHAPE_TOOLS, 'graph', 'equation', ...CONSTRUCTION_TOOLS]
    : COMPACT_MORE_TOOLS;
  // Polygons get their own submenu.
  const directTools = menuTools.filter((id) => id !== 'polygon');

  // Lit only for a tool with no key of its own: shapes belong to Shapes.
  const active =
    activeToolId === 'sticker' ||
    (menuTools.includes(activeToolId) &&
      !SHAPE_TOOLS.includes(activeToolId as (typeof SHAPE_TOOLS)[number]));
  const activeLabel = toolRegistry.get(activeToolId)?.label;
  const label =
    active && activeLabel ? `More tools, ${activeLabel} selected` : 'More tools';

  const pickSticker = (id: string) => {
    setStickerId(id);
    setTool('sticker');
  };

  return (
    <>
      <DropdownMenu>
        <ToolKey label={label} pressed={active} render={<DropdownMenuTrigger />}>
          <MoreGlyph />
        </ToolKey>

        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
          <DropdownMenuRadioGroup value={activeToolId} onValueChange={setTool}>
            {directTools.map((toolId) => {
              const tool = toolRegistry.get(toolId);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <DropdownMenuRadioItem key={toolId} value={tool.id}>
                  {Icon ? <Icon className="size-4" /> : null}
                  {tool.label}
                  {tool.hotkey ? (
                    <DropdownMenuShortcut>
                      {tool.hotkey.toUpperCase()}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <PolygonGlyph className="size-4" />
                Polygons
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuRadioGroup
                  value={activeToolId === 'polygon' ? polygonKind : null}
                  onValueChange={(kind: PolygonKind) => {
                    setPolygonKind(kind);
                    setTool('polygon');
                  }}
                >
                  {POLYGON_KINDS.map(({ kind, label: polygonLabel }) => (
                    <DropdownMenuRadioItem key={kind} value={kind}>
                      <MiniShape kind={kind} size={16} strokeWidth={1.5} />
                      {polygonLabel}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <StickerGlyph className="size-4" />
                Stickers
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <div className="grid max-h-56 grid-cols-4 gap-0.5 overflow-y-auto">
                  {STICKERS.map((def) => (
                    <DropdownMenuItem
                      key={def.id}
                      title={def.label}
                      aria-label={def.label}
                      aria-current={
                        activeToolId === 'sticker' && stickerId === def.id
                          ? 'true'
                          : undefined
                      }
                      onClick={() => pickSticker(def.id)}
                      className={STICKER_CELL}
                    >
                      <StickerPreview def={def} size={20} />
                    </DropdownMenuItem>
                  ))}
                  {boardStickers.map((meta) => (
                    <DropdownMenuItem
                      key={meta.id}
                      title={meta.label}
                      aria-label={meta.label}
                      aria-current={
                        activeToolId === 'sticker' && stickerId === meta.id
                          ? 'true'
                          : undefined
                      }
                      onClick={() => pickSticker(meta.id)}
                      className={STICKER_CELL}
                    >
                      <img
                        src={blobUrl(meta.blobId)}
                        alt=""
                        className="size-5 object-contain"
                        draggable={false}
                      />
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

            <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
              <ImageGlyph className="size-4" />
              Add image
            </DropdownMenuItem>
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
            <DropdownMenuItem onClick={onHide}>
              <ChevronDownGlyph className="size-4" />
              Hide toolbar
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}
