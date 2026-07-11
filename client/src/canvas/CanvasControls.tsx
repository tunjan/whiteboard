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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Surface } from '@/components/ui/surface';
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
  const BackgroundIcon = BACKGROUND_ICONS[background];

  return (
    <div
      data-ui-layer
      className="touch-targets absolute right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
    >
      <Surface className="flex h-10 items-center gap-1 p-1 shadow-hover">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={onZoomOut}
            className="rounded-lg"
          >
            <Minus />
          </Button>
          <button
            type="button"
            onClick={onZoomReset}
            className="h-8 min-w-12 rounded-lg px-1.5 text-center font-mono text-xs text-content-subtle tabular-nums transition-colors hover:bg-bg-muted hover:text-content-emphasis"
            aria-label="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            onClick={onZoomIn}
            className="rounded-lg"
          >
            <Plus />
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom to fit"
            onClick={onZoomToFit}
            className="rounded-lg"
          >
            <Maximize2 />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Background: ${BACKGROUND_LABELS[background]}`}
                  className="rounded-lg"
                />
              }
            >
              <BackgroundIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              sideOffset={8}
              className="w-52"
            >
              <DropdownMenuRadioGroup
                value={background}
                onValueChange={(value) =>
                  onBackgroundChange(value as BackgroundType)
                }
              >
                <DropdownMenuLabel>Background</DropdownMenuLabel>
                {BACKGROUND_TYPES.map((type) => {
                  const Icon = BACKGROUND_ICONS[type];
                  return (
                    <DropdownMenuRadioItem key={type} value={type}>
                      <Icon />
                      {BACKGROUND_LABELS[type]}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Surface>
    </div>
  );
}

const BACKGROUND_ICONS: Record<BackgroundType, LucideIcon> = {
  blank: Square,
  dot: CircleDot,
  graph: Grid2x2,
  coordinate: Crosshair,
};
