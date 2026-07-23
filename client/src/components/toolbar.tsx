import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Lock,
  Presentation,
  Shapes,
  Unlock as LockOpen,
} from 'lucide-react';
import type { PolygonKind } from '@whiteboard/shared';
import { YouTubeDialog } from '@/components/youtube-dialog';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Surface } from '@/components/ui/surface';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import '@/canvas/tools/register';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { useAnimationStore } from '@/animation/use-animation-store';

const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
];

const GROUP_1 = ['select', 'hand'];
const GROUP_2 = ['draw', 'eraser', 'laser'];
const GROUP_3 = ['text', 'graph', 'equation', 'comment'];
const GROUP_4 = ['rectangle', 'ellipse', 'arrow'];
const ACTIVE_TOOL_CLASS =
  'border-transparent bg-bg-info text-content-info hover:bg-bg-info hover:text-content-info';
const ROW_CLASS = 'flex shrink-0 items-center gap-1.5';

// Less-frequent shape tools folded into the Shapes overflow menu to keep the
// bar to a single row on narrow (e.g. iPad) screens.
const SHAPES_MENU_TOOLS = ['line', 'frame', 'polygon'];

function MiniShape({ kind }: { kind: PolygonKind }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <polygon
        points={polygonPointsForBox(kind, 2, 2, 12, 12)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolMenuItem({ toolId }: { toolId: string }) {
  const setTool = useToolStore((s) => s.setTool);
  const tool = toolRegistry.get(toolId);
  if (!tool) return null;
  const Icon = tool.icon;
  return (
    <DropdownMenuItem onClick={() => setTool(tool.id)}>
      {Icon ? <Icon /> : null}
      {tool.label}
    </DropdownMenuItem>
  );
}

function ShapesMenu({ active }: { active: boolean }) {
  const setTool = useToolStore((s) => s.setTool);
  const setPolygonKind = useStyleStore((s) => s.setPolygonKind);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              aria-label="More shapes"
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
                active && ACTIVE_TOOL_CLASS,
              )}
            />
          }
        >
          <Shapes />
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>More Shapes</span>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" sideOffset={8}>
        <DropdownMenuGroup>
          <ToolMenuItem toolId="line" />
          <ToolMenuItem toolId="frame" />
          {POLYGON_KINDS.map(({ kind, label }) => (
            <DropdownMenuItem
              key={kind}
              onClick={() => {
                setPolygonKind(kind);
                setTool('polygon');
              }}
            >
              <MiniShape kind={kind} />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MediaMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                aria-label="Add media"
                className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
              />
            }
          >
            <ImagePlus />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Add Media</span>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="top"
          align="center"
          sideOffset={8}
          className="w-48"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
              <ImagePlus />
              Add image
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <Presentation />
              Add YouTube video
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <YouTubeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ToolLockButton() {
  const locked = useToolLockStore((s) => s.locked);
  const toggle = useToolLockStore((s) => s.toggle);
  const Icon = locked ? Lock : LockOpen;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            pressed={locked}
            onPressedChange={toggle}
            aria-label="Tool lock"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              locked && ACTIVE_TOOL_CLASS,
            )}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>Tool Lock</span>
        <Kbd className="font-mono uppercase">q</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Bottom-centered, registry-driven toolbar grouped into logical segments.
 */
export function Toolbar() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const setTool = useToolStore((s) => s.setTool);
  const [hidden, setHidden] = useState(false);
  const playbackActive = useAnimationStore((s) => s.playbackActive);

  const renderToolButton = (toolId: string) => {
    const tool = toolRegistry.get(toolId);
    if (!tool) return null;
    const Icon = tool.icon;
    const active = tool.id === activeToolId;
    return (
      <Tooltip key={tool.id}>
        <TooltipTrigger
          onClick={() => setTool(tool.id)}
          aria-label={tool.label}
          aria-pressed={active}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
            tool.id === 'draw' && 'pencil-draw-trigger',
            active && ACTIVE_TOOL_CLASS,
          )}
        >
          {Icon ? (
            <Icon
              className={tool.id === 'draw' ? 'pencil-draw-icon' : undefined}
            />
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

  return (
    <TooltipProvider delay={300}>
      {/* Centering anchor. The toolbar and the collapsed "show" button both live
          here and cross-fade/slide so hiding and reopening is animated rather
          than an instant DOM swap. */}
      <div className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-20 -translate-x-1/2">
        <Surface
          role="toolbar"
          aria-label="Canvas tools"
          aria-hidden={hidden}
          inert={hidden || playbackActive}
          aria-disabled={playbackActive}
          className={cn(
            ROW_CLASS,
            'scrollbar-none touch-targets min-w-0 w-max max-w-[calc(100vw-1rem)] origin-bottom flex-nowrap overflow-x-auto overflow-y-hidden p-1.5 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            hidden &&
              'pointer-events-none translate-y-[calc(100%+1rem)] opacity-0',
            playbackActive && 'pointer-events-none opacity-40',
          )}
        >
          {/* Group 1: Navigation & Selection */}
          <div className={ROW_CLASS}>{GROUP_1.map(renderToolButton)}</div>

          {/* Group 2: Drawing & Annotation */}
          <div className={ROW_CLASS}>{GROUP_2.map(renderToolButton)}</div>

          {/* Group 3: Text & Math */}
          <div className={ROW_CLASS}>{GROUP_3.map(renderToolButton)}</div>

          {/* Group 4: Shapes & Media */}
          <div className={ROW_CLASS}>
            {GROUP_4.map(renderToolButton)}
            <ShapesMenu active={SHAPES_MENU_TOOLS.includes(activeToolId)} />
            <MediaMenu />
          </div>

          {/* Group 5: Utilities (tool lock + hide) */}
          <div className={ROW_CLASS}>
            <ToolLockButton />
            <Tooltip>
              <TooltipTrigger
                onClick={() => setHidden(true)}
                aria-label="Hide toolbar"
                className={buttonVariants({ variant: 'ghost', size: 'icon-lg' })}
              >
                <ChevronDown />
              </TooltipTrigger>
              <TooltipContent side="top">
                <span>Hide Toolbar</span>
              </TooltipContent>
            </Tooltip>
          </div>
        </Surface>

        {/* Collapsed state: sits at the same bottom-center spot and fades/slides
            in as the toolbar slides away. */}
        <Tooltip>
          <TooltipTrigger
            onClick={() => setHidden(false)}
            aria-label="Show toolbar"
            aria-hidden={!hidden}
            disabled={playbackActive}
            tabIndex={hidden ? 0 : -1}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'icon-lg' }),
              'touch-targets absolute bottom-0 left-1/2 -translate-x-1/2 rounded-xl border transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
              hidden
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-2 opacity-0',
            )}
          >
            <ChevronUp />
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Show Toolbar</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
