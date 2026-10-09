import { useState } from 'react';
import {
  ArrowGlyph,
  ChevronDownGlyph,
  EllipseGlyph,
  FrameGlyph,
  GraphGlyph,
  ImageGlyph,
  LineGlyph,
  LockGlyph,
  LockOpenGlyph,
  MoreGlyph,
  PlusGlyph,
  PolygonGlyph,
  RectGlyph,
  SigmaGlyph,
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
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { POLYGON_KINDS, MiniShape } from './toolbar-constants';
import { ToolbarItem } from './toolbar-primitives';

interface CalmSpatialMenuProps {
  activeToolId: string;
  onHide: () => void;
  expanded?: boolean;
}

/**
 * Alternative 2: Calm Spatial Tool Palette
 *
 * Hybrid 4x2 Icon Grid + Vertical List Menu:
 * - Group 1: 4x2 grid of icon-first controls for geometric creation tools
 *   (Rectangle, Ellipse, Arrow, Line, Frame, Polygons, Function, Equation).
 *   Each item is 40x40px (`size-10 rounded-[10px]`) with `gap-1` (4px).
 * - Group 2 (Library): Clean vertical rows for Stickers & Media (`h-10 px-2.5 rounded-[10px]`).
 * - Group 3 (Session): Clean vertical rows for Tool Lock & Hide Toolbar (`h-10 px-2.5 rounded-[10px]`).
 *
 * Strictly follows Calm UI rules:
 * - Zero separator lines between peers. Spacing is the ONLY separator (`gap-0.5` inside, `gap-2.5` between).
 * - 47% vertical footprint reduction (288px vs. 542px) with full 40px touch targets.
 */
export function CalmSpatialMenu({
  activeToolId,
  onHide,
}: CalmSpatialMenuProps) {
  const [videoOpen, setVideoOpen] = useState(false);
  const setTool = useToolStore((state) => state.setTool);
  const locked = useToolLockStore((state) => state.locked);
  const toggleLock = useToolLockStore((state) => state.toggle);
  const setPolygonKind = useStyleStore((state) => state.setPolygonKind);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );

  const creationToolIds = [
    'rectangle',
    'ellipse',
    'arrow',
    'line',
    'frame',
    'polygon',
    'graph',
    'equation',
  ] as const;

  const isAnyCreationActive = creationToolIds.includes(
    activeToolId as (typeof creationToolIds)[number],
  );
  const isStickerActive = activeToolId === 'sticker';
  const isActive = isAnyCreationActive || isStickerActive;

  const activeLabel = toolRegistry.get(activeToolId)?.label;
  const triggerLabel =
    isActive && activeLabel
      ? `More tools, ${activeLabel} selected`
      : 'More tools';

  return (
    <>
      <DropdownMenu>
        <ToolbarItem
          label={triggerLabel}
          selected={isActive}
          tabIndex={isActive ? 0 : -1}
          render={<DropdownMenuTrigger />}
        >
          <MoreGlyph />
        </ToolbarItem>

        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          className={cn(
            'w-[192px] p-2.5 rounded-[18px] select-none',
            'bg-[#FBFBF9] dark:bg-[#17171A]',
            'border border-[#E5E3DD] dark:border-[#2A2A2F]',
            'shadow-[0_1px_2px_rgb(0_0_0_/_0.05),_0_14px_34px_rgb(0_0_0_/_0.10)]',
            'flex flex-col gap-2.5',
            'text-[#141414] dark:text-[#FBFBF9]',
          )}
        >
          {/* ================================================================= */}
          {/* GROUP 1: CREATION TOOLS (4x2 SPATIAL GRID)                        */}
          {/* ================================================================= */}
          <div role="group" aria-label="Creation tools" className="flex flex-col">
            <div className="grid grid-cols-4 gap-1" role="presentation">
              {/* 1. Rectangle (R) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('rectangle')}
                aria-label="Rectangle (R)"
                title="Rectangle (R)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'rectangle'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <RectGlyph className="size-5" />
              </button>

              {/* 2. Ellipse (O) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('ellipse')}
                aria-label="Ellipse (O)"
                title="Ellipse (O)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'ellipse'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <EllipseGlyph className="size-5" />
              </button>

              {/* 3. Arrow (A) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('arrow')}
                aria-label="Arrow (A)"
                title="Arrow (A)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'arrow'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <ArrowGlyph className="size-5" />
              </button>

              {/* 4. Line (L) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('line')}
                aria-label="Line (L)"
                title="Line (L)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'line'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <LineGlyph className="size-5" />
              </button>

              {/* 5. Frame (F) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('frame')}
                aria-label="Frame (F)"
                title="Frame (F)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'frame'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <FrameGlyph className="size-5" />
              </button>

              {/* 6. Polygons with Sub-Menu Flyout */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className={cn(
                    'size-10 p-0 rounded-[10px] flex items-center justify-center transition-all duration-150 relative cursor-default',
                    activeToolId === 'polygon'
                      ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                      : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                  )}
                  aria-label="Polygons (P)"
                >
                  <PolygonGlyph className="size-5" />
                  <span className="absolute bottom-1 right-1 size-1 rounded-full bg-[#A09D97] dark:bg-[#97979E]" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  sideOffset={8}
                  className={cn(
                    'w-[184px] p-2.5 rounded-[18px] flex flex-col gap-1',
                    'bg-[#FBFBF9] dark:bg-[#17171A]',
                    'border border-[#E5E3DD] dark:border-[#2A2A2F]',
                    'shadow-[0_1px_2px_rgb(0_0_0_/_0.05),_0_14px_34px_rgb(0_0_0_/_0.10)]',
                  )}
                >
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#A09D97] dark:text-[#97979E]">
                    Polygons
                  </div>
                  {POLYGON_KINDS.map(({ kind, label }) => (
                    <DropdownMenuItem
                      key={kind}
                      onClick={() => {
                        setPolygonKind(kind);
                        setTool('polygon');
                      }}
                      className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2.5 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                    >
                      <MiniShape kind={kind} size={20} />
                      <span>{label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* 7. Function / Graph (G) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('graph')}
                aria-label="Function Graph (G)"
                title="Function Graph (G)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'graph'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <GraphGlyph className="size-5" />
              </button>

              {/* 8. Equation (E) */}
              <button
                type="button"
                role="menuitem"
                onClick={() => setTool('equation')}
                aria-label="LaTeX Equation (E)"
                title="LaTeX Equation (E)"
                className={cn(
                  'size-10 rounded-[10px] flex items-center justify-center transition-all duration-150',
                  activeToolId === 'equation'
                    ? 'bg-[#E0EFE5] dark:bg-[#27604A]/30 text-[#27604A] dark:text-[#52B788] font-semibold'
                    : 'text-[#4A4A4F] dark:text-[#97979E] hover:bg-[#F1F1F2] dark:hover:bg-[#222227] hover:text-[#141414] dark:hover:text-[#FBFBF9]',
                )}
              >
                <SigmaGlyph className="size-5" />
              </button>
            </div>
          </div>

          {/* ================================================================= */}
          {/* GROUP 2: LIBRARY (STICKERS, MEDIA)                                */}
          {/* Clean vertical rows, h-10 px-2.5 rounded-[10px]. Zero dividers.  */}
          {/* ================================================================= */}
          <DropdownMenuGroup className="flex flex-col gap-0.5">
            {/* Row 1: Stickers Sub-Menu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="w-full h-10 px-2.5 rounded-[10px] flex items-center justify-between text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]">
                <div className="flex items-center gap-2 min-w-0">
                  <StickerGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                  <span className="text-xs font-medium">Stickers</span>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={8}
                className={cn(
                  'w-[200px] p-2.5 rounded-[18px] flex flex-col gap-1',
                  'bg-[#FBFBF9] dark:bg-[#17171A]',
                  'border border-[#E5E3DD] dark:border-[#2A2A2F]',
                  'shadow-[0_1px_2px_rgb(0_0_0_/_0.05),_0_14px_34px_rgb(0_0_0_/_0.10)]',
                )}
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#A09D97] dark:text-[#97979E]">
                  Stickers
                </div>
                {STICKERS.map((definition) => {
                  const Icon = definition.Icon;
                  return (
                    <DropdownMenuItem
                      key={definition.id}
                      onClick={() => {
                        setStickerId(definition.id);
                        setTool('sticker');
                      }}
                      className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                    >
                      <Icon className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
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
                    className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                  >
                    <img
                      src={blobUrl(meta.blobId)}
                      alt=""
                      className="size-5 object-contain"
                      draggable={false}
                    />
                    <span>{meta.label}</span>
                  </DropdownMenuItem>
                ))}
                <div className="h-2.5" />
                <DropdownMenuItem
                  onClick={() => void pickAndAddStickers()}
                  className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                >
                  <PlusGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                  <span>Add sticker</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Row 2: Media Sub-Menu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="w-full h-10 px-2.5 rounded-[10px] flex items-center justify-between text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]">
                <div className="flex items-center gap-2 min-w-0">
                  <ImageGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                  <span className="text-xs font-medium">Media</span>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                sideOffset={8}
                className={cn(
                  'w-[200px] p-2.5 rounded-[18px] flex flex-col gap-1',
                  'bg-[#FBFBF9] dark:bg-[#17171A]',
                  'border border-[#E5E3DD] dark:border-[#2A2A2F]',
                  'shadow-[0_1px_2px_rgb(0_0_0_/_0.05),_0_14px_34px_rgb(0_0_0_/_0.10)]',
                )}
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#A09D97] dark:text-[#97979E]">
                  Import Media
                </div>
                <DropdownMenuItem
                  onClick={() => void pickAndPlaceImages()}
                  className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                >
                  <ImageGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                  <span>Add image</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setVideoOpen(true)}
                  className="w-full h-10 px-2.5 rounded-[10px] flex items-center gap-2 text-xs font-medium text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
                >
                  <VideoGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                  <span>Add YouTube video</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>

          {/* ================================================================= */}
          {/* GROUP 3: SESSION (TOOL LOCK, HIDE TOOLBAR)                        */}
          {/* Clean vertical rows, separated by gap-2.5. Zero separator lines.  */}
          {/* ================================================================= */}
          <DropdownMenuGroup className="flex flex-col gap-0.5">
            {/* Tool Lock */}
            <DropdownMenuItem
              onClick={toggleLock}
              className="w-full h-10 px-2.5 rounded-[10px] flex items-center justify-between text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
            >
              <div className="flex items-center gap-2 min-w-0">
                {locked ? (
                  <LockGlyph className="size-5 text-[#27604A] dark:text-[#52B788]" />
                ) : (
                  <LockOpenGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                )}
                <span className="text-xs font-medium">Tool lock</span>
              </div>
              <div className="flex items-center gap-1.5">
                <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-[6px] bg-[#EDECEA] dark:bg-[#2A2A2F] text-[#4A4A4F] dark:text-[#97979E]">
                  Q
                </kbd>
                <div
                  className={cn(
                    'w-7 h-4 rounded-full p-0.5 transition-colors',
                    locked
                      ? 'bg-[#27604A]'
                      : 'bg-[#EDECEA] dark:bg-[#2A2A2F]',
                  )}
                >
                  <div
                    className={cn(
                      'size-3 rounded-full transition-transform',
                      locked
                        ? 'bg-[#FBFBF9] translate-x-3'
                        : 'bg-[#A09D97]',
                    )}
                  />
                </div>
              </div>
            </DropdownMenuItem>

            {/* Hide Toolbar */}
            <DropdownMenuItem
              onClick={onHide}
              className="w-full h-10 px-2.5 rounded-[10px] flex items-center justify-between text-[#141414] dark:text-[#FBFBF9] hover:bg-[#F1F1F2] dark:hover:bg-[#222227]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ChevronDownGlyph className="size-5 text-[#4A4A4F] dark:text-[#97979E]" />
                <span className="text-xs font-medium">Hide toolbar</span>
              </div>
              <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-[6px] bg-[#EDECEA] dark:bg-[#2A2A2F] text-[#4A4A4F] dark:text-[#97979E]">
                ⌘\
              </kbd>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}
