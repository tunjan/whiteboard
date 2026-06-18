import {
  CircleDot,
  Crosshair,
  Grid2x2,
  Maximize2,
  Minus,
  Plus,
  Square,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type BackgroundType,
  BACKGROUND_LABELS,
  BACKGROUND_TYPES,
} from './grid';

interface CanvasControlsProps {
  zoom: number;
  background: BackgroundType;
  onBackgroundChange: (background: BackgroundType) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomToFit: () => void;
}

export function CanvasControls({
  zoom,
  background,
  onBackgroundChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomToFit,
}: CanvasControlsProps) {
  return (
    <div
      data-ui-layer
      className="absolute right-3 bottom-3 flex items-center gap-2 select-none"
    >
      <TooltipProvider delay={300}>
        <ToggleGroup
          aria-label="Background"
          className="w-auto bg-card shadow-sm"
          value={[background]}
          onValueChange={(v) => {
            if (v[0]) onBackgroundChange(v[0] as BackgroundType);
          }}
        >
          {BACKGROUND_TYPES.map((t) => {
            const Icon = BACKGROUND_ICONS[t];
            return (
              <Tooltip key={t}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      aria-label={BACKGROUND_LABELS[t]}
                      className="size-7 flex-none p-0 [&_svg]:size-4"
                      value={t}
                    />
                  }
                >
                  <Icon />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>{BACKGROUND_LABELS[t]}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </TooltipProvider>

      <div className="flex items-center rounded-md border border-border bg-card shadow-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={onZoomOut}
        >
          <Minus />
        </Button>
        <button
          type="button"
          onClick={onZoomReset}
          className="h-7 min-w-13 px-1 text-center font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground"
          aria-label="Reset zoom to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={onZoomIn}
        >
          <Plus />
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom to fit"
          onClick={onZoomToFit}
        >
          <Maximize2 />
        </Button>
      </div>
    </div>
  );
}

const BACKGROUND_ICONS: Record<BackgroundType, LucideIcon> = {
  blank: Square,
  dot: CircleDot,
  graph: Grid2x2,
  coordinate: Crosshair,
};
