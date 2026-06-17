import { ImagePlus, Lock, LockOpen, Shapes } from 'lucide-react';
import type { PolygonKind } from '@whiteboard/shared';
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
const GROUP_3 = ['text', 'plot'];
const GROUP_4 = ['rectangle', 'ellipse', 'line', 'arrow', 'frame'];

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

function ImageButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={() => void pickAndPlaceImages()}
        aria-label="Add image"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
      >
        <ImagePlus className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>Add image</span>
      </TooltipContent>
    </Tooltip>
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
      <Surface className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 p-2">
        {/* Group 1: Navigation & Selection */}
        <div className="flex items-center gap-1">
          {GROUP_1.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Group 2: Drawing & Annotation */}
        <div className="flex items-center gap-1">
          {GROUP_2.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Group 3: Text & Math */}
        <div className="flex items-center gap-1">
          {GROUP_3.map(renderToolButton)}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Group 4: Basic Shapes */}
        <div className="flex items-center gap-1">
          {GROUP_4.map(renderToolButton)}
          <ShapesMenu active={activeToolId === 'polygon'} />
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Group 5: Media */}
        <div className="flex items-center gap-1">
          <ImageButton />
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Group 6: Tool Lock */}
        <div className="flex items-center gap-1">
          <ToolLockButton />
        </div>
      </Surface>
    </TooltipProvider>
  );
}

