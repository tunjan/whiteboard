import { Maximize2, Minus, Plus, Grid2x2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
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
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Background"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'gap-1.5 bg-card shadow-sm',
          )}
        >
          <Grid2x2 className="size-4" />
          <span className="hidden sm:inline">
            {BACKGROUND_LABELS[background]}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end">
          <DropdownMenuRadioGroup
            value={background}
            onValueChange={(v) => onBackgroundChange(v as BackgroundType)}
          >
            <DropdownMenuLabel>Background</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {BACKGROUND_TYPES.map((t) => (
              <DropdownMenuRadioItem key={t} value={t}>
                {BACKGROUND_LABELS[t]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

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
