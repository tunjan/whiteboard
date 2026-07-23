import type { ComponentType } from 'react';
import {
  CircleDot,
  Crosshair,
  Grid2x2,
  Maximize2,
  Minus,
  Plus,
  Sigma,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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
  equations: Array<{ id: string; label: string; locked: boolean }>;
  onEquationSelect: (id: string) => void;
  disabled?: boolean;
}

export function CanvasControls({
  zoom,
  background,
  onBackgroundChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomToFit,
  equations,
  onEquationSelect,
  disabled = false,
}: CanvasControlsProps) {
  const BackgroundIcon = BACKGROUND_ICONS[background];

  return (
    <div
      data-ui-layer
      className="touch-targets absolute right-[env(safe-area-inset-right)] bottom-[env(safe-area-inset-bottom)] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
    >
      <Surface className="flex h-10 items-center gap-1 rounded-none rounded-tl-md border-b-0 border-r-0 p-1 shadow-none">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom out"
            disabled={disabled}
            onClick={onZoomOut}
          >
            <Minus />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onZoomReset}
            className="min-w-12 px-1.5 font-mono text-content-subtle tabular-nums"
            aria-label="Reset zoom to 100%"
            disabled={disabled}
          >
            {Math.round(zoom * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom in"
            disabled={disabled}
            onClick={onZoomIn}
          >
            <Plus />
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zoom to fit"
            disabled={disabled}
            onClick={onZoomToFit}
          >
            <Maximize2 />
          </Button>
          {equations.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Find an equation"
                    disabled={disabled}
                  />
                }
              >
                <Sigma />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="max-h-72 w-72 overflow-y-auto"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Equations</DropdownMenuLabel>
                  {equations.map((equation, index) => (
                    <DropdownMenuItem
                      key={equation.id}
                      onClick={() => onEquationSelect(equation.id)}
                    >
                      <Sigma aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {index + 1}. {equation.label}
                      </span>
                      {equation.locked ? (
                        <span className="text-xs text-content-subtle">
                          Locked
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Background: ${BACKGROUND_LABELS[background]}`}
                  disabled={disabled}
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

const BACKGROUND_ICONS: Record<BackgroundType, ComponentType<{ className?: string }>> = {
  blank: Square,
  dot: CircleDot,
  graph: Grid2x2,
  coordinate: Crosshair,
};
