import { useState } from 'react';
import { ImagePlus, Lock, LockOpen, MonitorPlay, Shapes } from 'lucide-react';
import type { PolygonKind } from '@whiteboard/shared';
import { YouTubeDialog } from '@/components/youtube-dialog';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import '@/canvas/tools/register';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';

const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
];

const GROUP_1 = ['select', 'lasso'];
const GROUP_2 = ['draw', 'eraser'];
const GROUP_3 = ['text', 'graph'];
const GROUP_4 = ['rectangle', 'ellipse', 'arrow'];

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
      {Icon ? <Icon className="size-4" /> : null}
      {tool.label}
    </DropdownMenuItem>
  );
}

function ShapesMenu({ active }: { active: boolean }) {
  const setTool = useToolStore((s) => s.setTool);
  const setPolygonKind = useStyleStore((s) => s.setPolygonKind);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More shapes"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          active &&
            'bg-accent-brand text-accent-brand-foreground hover:bg-accent-brand/90 hover:text-accent-brand-foreground',
        )}
      >
        <Shapes className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MediaMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Add media"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
        >
          <ImagePlus className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center">
          <DropdownMenuItem onClick={() => void pickAndPlaceImages()}>
            <ImagePlus className="size-4" />
            Add image
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen(true)}>
            <MonitorPlay className="size-4" />
            Add YouTube video
          </DropdownMenuItem>
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
        onClick={toggle}
        aria-label="Tool Lock"
        aria-pressed={locked}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          locked &&
            'bg-accent-brand text-accent-brand-foreground hover:bg-accent-brand/90 hover:text-accent-brand-foreground',
        )}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>Tool Lock</span>
        <kbd
          data-slot="kbd"
          className="bg-background/15 px-1 font-mono text-[10px] uppercase"
        >
          q
        </kbd>
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
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            active &&
              'bg-accent-brand text-accent-brand-foreground hover:bg-accent-brand/90 hover:text-accent-brand-foreground',
          )}
        >
          {Icon ? <Icon className="size-4" /> : null}
        </TooltipTrigger>
        <TooltipContent side="top">
          <span>{tool.label}</span>
          {tool.hotkey ? (
            <kbd
              data-slot="kbd"
              className="bg-background/15 px-1 font-mono text-[10px] uppercase"
            >
              {tool.hotkey}
            </kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delay={300}>
      <Surface className="touch-targets absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap justify-center items-center gap-1 p-1.5 shadow-[0_14px_42px_rgba(0,0,0,0.14),0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.55),0_4px_14px_rgba(0,0,0,0.35)]">
        {/* Group 1: Navigation & Selection */}
        <div className="flex items-center gap-1">
          {GROUP_1.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Group 2: Drawing & Annotation */}
        <div className="flex items-center gap-1">
          {GROUP_2.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Group 3: Text & Math */}
        <div className="flex items-center gap-1">
          {GROUP_3.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Group 4: Basic Shapes */}
        <div className="flex items-center gap-1">
          {GROUP_4.map(renderToolButton)}
          <ShapesMenu active={SHAPES_MENU_TOOLS.includes(activeToolId)} />
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Group 5: Media */}
        <div className="flex items-center gap-1">
          <MediaMenu />
        </div>

        <div className="w-px h-5 bg-border mx-0.5" />

        {/* Group 6: Tool Lock */}
        <div className="flex items-center gap-1">
          <ToolLockButton />
        </div>
      </Surface>
    </TooltipProvider>
  );
}
