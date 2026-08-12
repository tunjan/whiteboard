import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Lock,
  MoreHorizontal,
  Plus,
  Presentation,
  Shapes,
  Sticker,
  Unlock as LockOpen,
  X,
} from 'lucide-react';
import type { CustomStickerMeta, PolygonKind } from '@whiteboard/shared';
import { blobUrl } from '@/board/blobs';
import { pickAndAddStickers } from '@/board/custom-stickers';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';
import {
  getSticker,
  STICKERS,
  StickerPreview,
} from '@/canvas/shapes/sticker-catalog';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import '@/canvas/tools/register';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { removeCustomSticker } from '@/canvas/use-document-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { YouTubeDialog } from '@/components/youtube-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
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
import { Kbd } from '@/components/ui/kbd';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_CONTROLS, Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Toggle } from '@/components/ui/toggle';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
import { cn } from '@/lib/utils';

const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
];

const NAVIGATION_TOOLS = ['select', 'hand'];
const DRAW_TOOLS = ['draw', 'wand', 'eraser', 'laser'];
const CONTENT_TOOLS = ['text', 'comment', 'graph', 'equation'];
const SHAPE_TOOLS = ['rectangle', 'ellipse', 'arrow', 'line', 'frame', 'polygon'];
const COMPACT_PRIMARY_TOOLS = ['select', 'draw', 'eraser', 'text'];
const COMPACT_MORE_TOOLS = ['hand', 'wand', 'laser', 'comment', 'graph', 'equation'];

/**
 * Two states, two idioms, applied the same way everywhere in the chrome:
 *
 * SELECTED (exactly one of N — which tool is active) is a solid ink chip. It
 * is the strongest mark the chrome can make, and only one control can wear it
 * at a time, so it stays legible without colour. It resolves through the
 * inverse tokens, so it is near-black on light and near-white on dark.
 *
 * PRESSED (an independent on/off — tool lock, music, follow) is a recessed
 * fill with a hairline. Several can be on at once, so it has to be quieter
 * than selection or the bar turns into a row of competing chips.
 *
 * Neither uses hue. Colour in this chrome is reserved for conditions that
 * want attention (a muted mic, a failing connection), so a coloured pixel
 * always means "look here" rather than "this is on".
 */
const TOOL_ACTIVE =
  'border-transparent bg-inverse text-fg-inverse hover:bg-inverse-hover hover:text-fg-inverse';
const TOOL_PRESSED = 'border-border bg-panel text-primary hover:bg-panel';
const TOOL_IDLE =
  'border-transparent bg-transparent text-secondary hover:bg-panel hover:text-primary';
const TOOL_GEOMETRY = 'size-10 min-w-10 rounded-lg p-0';

/**
 * The whole recipe for a tool-bar button. Four call sites built this string by
 * hand and had already drifted on which parts they included.
 *
 * `icon-md` rather than a bare size class: the box comes from TOOL_GEOMETRY,
 * but the variant is also what sizes the glyph inside (18px), and the two have
 * to be changed together or the icons rattle around in a larger button.
 */
function toolButtonClass(active: boolean) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    active ? TOOL_ACTIVE : TOOL_IDLE,
  );
}

/**
 * Drawn at 14px to sit on the same optical line as the lucide icons in the
 * rows above it — at 16px the polygons stood visibly larger than the
 * rectangle and ellipse they share a menu with.
 */
function MiniShape({ kind }: { kind: PolygonKind }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
      <polygon
        points={polygonPointsForBox(kind, 2, 2, 12, 12)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolMenuItem({
  toolId,
  onSelect,
}: {
  toolId: string;
  onSelect?: (toolId: string) => void;
}) {
  const setTool = useToolStore((state) => state.setTool);
  const tool = toolRegistry.get(toolId);
  if (!tool) return null;
  const Icon = tool.icon;
  return (
    <DropdownMenuItem
      onClick={() => {
        onSelect?.(tool.id);
        setTool(tool.id);
      }}
    >
      {Icon ? <Icon /> : null}
      {tool.label}
      {tool.hotkey ? (
        <DropdownMenuShortcut>{tool.hotkey.toUpperCase()}</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

function ShapeMenu({
  activeToolId,
  lastShapeId,
  onLastShapeChange,
}: {
  activeToolId: string;
  lastShapeId: string;
  onLastShapeChange: (toolId: string) => void;
}) {
  const setTool = useToolStore((state) => state.setTool);
  const setPolygonKind = useStyleStore((state) => state.setPolygonKind);
  const active = SHAPE_TOOLS.includes(activeToolId);
  const displayedTool = toolRegistry.get(active ? activeToolId : lastShapeId);
  const DisplayIcon = displayedTool?.icon ?? Shapes;
  const label = active ? `${displayedTool?.label ?? 'Shape'} selected` : 'Shapes';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              data-toolbar-item
              tabIndex={active ? 0 : -1}
              aria-label={label}
              aria-pressed={active}
              className={toolButtonClass(active)}
            />
          }
        >
          <DisplayIcon />
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" sideOffset={8} className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shapes</DropdownMenuLabel>
          {['rectangle', 'ellipse', 'arrow', 'line', 'frame'].map((toolId) => (
            <ToolMenuItem
              key={toolId}
              toolId={toolId}
              onSelect={onLastShapeChange}
            />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Polygons</DropdownMenuLabel>
          {POLYGON_KINDS.map(({ kind, label: polygonLabel }) => (
            <DropdownMenuItem
              key={kind}
              onClick={() => {
                setPolygonKind(kind);
                onLastShapeChange('polygon');
                setTool('polygon');
              }}
            >
              <MiniShape kind={kind} />
              {polygonLabel}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One uploaded sticker in the picker: the stamp button, plus a remove control
 * that stays hidden until the cell is hovered or focused. Two sibling buttons
 * rather than one nested in the other, which no browser allows.
 */
function CustomStickerCell({
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
        aria-pressed={selected}
        onClick={onPick}
        className={cn('w-full rounded-md', selected && TOOL_PRESSED)}
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
              onClick={() => removeCustomSticker(meta.id)}
              className={cn(
                'absolute -top-1 -right-1 size-4 rounded-full border bg-background p-0',
                'opacity-0 transition-opacity group-hover:opacity-100',
                'focus-visible:opacity-100 motion-reduce:transition-none',
              )}
            />
          }
        >
          <X className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="top">Remove for everyone</TooltipContent>
      </Tooltip>
    </div>
  );
}

function InsertMenu({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const setTool = useToolStore((state) => state.setTool);
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const customStickers = useCustomStickersStore((state) => state.stickers);
  const pending = useCustomStickersStore((state) => state.pending);
  const uploadError = useCustomStickersStore((state) => state.error);
  const custom = customStickers[stickerId];
  const board = sortedCustomStickers(customStickers);
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
                aria-pressed={active}
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
              <TriggerIcon />
            )}
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={8}
          className={cn(CHROME_CONTROLS, 'w-60')}
        >
          <PopoverHeader>
            <PopoverTitle>Insert</PopoverTitle>
            <PopoverDescription>Add a sticker or media to the board.</PopoverDescription>
          </PopoverHeader>
          <div className="grid grid-cols-4 gap-1" aria-label="Stickers">
            {STICKERS.map((definition) => (
              <Button
                key={definition.id}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={definition.label}
                aria-pressed={active && definition.id === stickerId}
                onClick={() => {
                  setStickerId(definition.id);
                  setTool('sticker');
                  setOpen(false);
                }}
                className={cn(
                  'rounded-md',
                  // Picker cell, not the tool bar: the chosen sticker takes the
                  // quieter pressed idiom, since the trigger icon above already
                  // carries the selection.
                  active && definition.id === stickerId && TOOL_PRESSED,
                )}
              >
                <StickerPreview def={definition} size={24} />
              </Button>
            ))}
          </div>
          {board.length > 0 && (
            <div className="grid grid-cols-4 gap-1" aria-label="Board stickers">
              {board.map((meta) => (
                <CustomStickerCell
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
          )}
          <div className="grid gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              disabled={pending > 0}
              onClick={() => void pickAndAddStickers()}
            >
              <Plus aria-hidden="true" />
              {pending > 0 ? 'Removing background…' : 'Add PNG sticker'}
            </Button>
            {uploadError && (
              <p role="alert" className="px-2 text-xs text-danger">
                {uploadError}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                void pickAndPlaceImages();
              }}
            >
              <ImagePlus aria-hidden="true" />
              Add image
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false);
                setVideoOpen(true);
              }}
            >
              <Presentation aria-hidden="true" />
              Add YouTube video
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}

function ToolLockButton() {
  const locked = useToolLockStore((state) => state.locked);
  const toggle = useToolLockStore((state) => state.toggle);
  const Icon = locked ? Lock : LockOpen;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            data-toolbar-item
            tabIndex={-1}
            pressed={locked}
            onPressedChange={toggle}
            aria-label={locked ? 'Disable tool lock' : 'Enable tool lock'}
            aria-keyshortcuts="Q"
            size="lg"
            className={cn(
              'border',
              TOOL_GEOMETRY,
              locked ? TOOL_PRESSED : TOOL_IDLE,
            )}
          />
        }
      >
        {/* Explicit size: Toggle's own cva pins icons at 16px, and its rule
            skips any svg that already carries a size class. Without this the
            lock sits 2px smaller than every lucide icon beside it. */}
        <Icon className="size-4.5" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>{locked ? 'Disable tool lock' : 'Enable tool lock'}</span>
        <Kbd className="font-mono uppercase">Q</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

function CompactMoreMenu({
  activeToolId,
  onHide,
}: {
  activeToolId: string;
  onHide: () => void;
}) {
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
  const label = active && activeLabel ? `More tools, ${activeLabel} selected` : 'More tools';

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
                aria-pressed={active}
                className={toolButtonClass(active)}
              />
            }
          >
            <MoreHorizontal />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>More tools</DropdownMenuLabel>
            {COMPACT_MORE_TOOLS.map((toolId) => (
              <ToolMenuItem key={toolId} toolId={toolId} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Sticker />
              Stickers
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
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
                    <Icon />
                    {definition.label}
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
                  {meta.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void pickAndAddStickers()}>
                <Plus />
                Add PNG sticker
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ImagePlus />
              Media
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48">
              <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
                <ImagePlus />
                Add image
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setVideoOpen(true)}>
                <Presentation />
                Add YouTube video
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={locked} onCheckedChange={toggleLock}>
            {locked ? <Lock /> : <LockOpen />}
            Tool lock
            <DropdownMenuShortcut>Q</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem onClick={onHide}>
            <ChevronDown />
            Hide toolbar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <YouTubeDialog open={videoOpen} onOpenChange={setVideoOpen} />
    </>
  );
}

export function Toolbar() {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  const [hidden, setHidden] = useState(false);
  const [lastShapeId, setLastShapeId] = useState('rectangle');
  const showButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbar = useRovingToolbar<HTMLDivElement>();

  useEffect(() => {
    if (SHAPE_TOOLS.includes(activeToolId)) setLastShapeId(activeToolId);
  }, [activeToolId]);

  const hideToolbar = () => {
    setHidden(true);
    requestAnimationFrame(() => showButtonRef.current?.focus());
  };

  const showToolbar = () => {
    setHidden(false);
    requestAnimationFrame(() => {
      const visibleItems = [
        ...(toolbar.ref.current?.querySelectorAll<HTMLElement>(
          '[data-toolbar-item]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length > 0);
      const active = visibleItems.find(
        (item) => item.getAttribute('aria-pressed') === 'true',
      );
      (active ?? visibleItems[0])?.focus();
    });
  };

  const renderToolButton = (toolId: string) => {
    const tool = toolRegistry.get(toolId);
    if (!tool) return null;
    const Icon = tool.icon;
    const active = tool.id === activeToolId;
    return (
      <Tooltip key={tool.id}>
        <TooltipTrigger
          render={
            <Button
              data-toolbar-item
              variant="ghost"
              size="icon-md"
              tabIndex={active ? 0 : -1}
              onClick={() => setTool(tool.id)}
              aria-label={tool.label}
              aria-pressed={active}
              aria-keyshortcuts={tool.hotkey?.toUpperCase()}
              className={cn(
                toolButtonClass(active),
                tool.id === 'draw' && 'pencil-draw-trigger',
              )}
            />
          }
        >
          {Icon ? (
            <Icon className={cn(tool.id === 'draw' && 'pencil-draw-icon')} />
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>{tool.label}</span>
          {tool.hotkey ? (
            <Kbd className="font-mono uppercase">{tool.hotkey}</Kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  };

  const group = (label: string, tools: string[]) => (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {tools.map(renderToolButton)}
    </div>
  );

  return (
    <TooltipProvider delay={300}>
      <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2">
        <Surface
          ref={toolbar.ref}
          mode="floating"
          chrome
          role="toolbar"
          aria-label="Canvas tools"
          aria-orientation="horizontal"
          aria-hidden={hidden}
          inert={hidden}
          onKeyDown={toolbar.onKeyDown}
          onFocusCapture={toolbar.onFocusCapture}
          className={cn(
            'relative flex w-max max-w-[calc(100vw-1rem)] items-center rounded-2xl p-1.5',
            'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
            'motion-reduce:transition-none',
            hidden && 'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0',
          )}
        >
          <div className="hidden items-center gap-0.5 sm:flex">
            {group('Navigate', NAVIGATION_TOOLS)}
            {group('Draw', DRAW_TOOLS)}
            {group('Content', CONTENT_TOOLS)}
            <div role="group" aria-label="Insert" className="flex items-center gap-0.5">
              <ShapeMenu
                activeToolId={activeToolId}
                lastShapeId={lastShapeId}
                onLastShapeChange={setLastShapeId}
              />
              <InsertMenu active={activeToolId === 'sticker'} />
            </div>
            <div role="group" aria-label="Utilities" className="flex items-center gap-0.5">
              <ToolLockButton />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      data-toolbar-item
                      variant="ghost"
                      size="icon-md"
                      tabIndex={-1}
                      aria-label="Hide toolbar"
                      onClick={hideToolbar}
                      className={cn(TOOL_GEOMETRY, TOOL_IDLE)}
                    />
                  }
                >
                  <ChevronDown />
                </TooltipTrigger>
                <TooltipContent side="top">Hide toolbar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div role="group" aria-label="Compact canvas tools" className="flex items-center gap-0.5 sm:hidden">
            {COMPACT_PRIMARY_TOOLS.map(renderToolButton)}
            <ShapeMenu
              activeToolId={activeToolId}
              lastShapeId={lastShapeId}
              onLastShapeChange={setLastShapeId}
            />
            <CompactMoreMenu activeToolId={activeToolId} onHide={hideToolbar} />
          </div>
        </Surface>

        <Tooltip>
          <TooltipTrigger
            ref={showButtonRef}
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-md"
                onClick={showToolbar}
                aria-label="Show toolbar"
                aria-hidden={!hidden}
                tabIndex={hidden ? 0 : -1}
                className={cn(
                  'absolute bottom-0 left-1/2 -translate-x-1/2 rounded-lg',
                  'transition-[opacity,transform] duration-base ease-out-quart motion-reduce:transition-none',
                  hidden
                    ? 'translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0',
                )}
              />
            }
          >
            <ChevronUp />
          </TooltipTrigger>
          <TooltipContent side="top">Show toolbar</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
