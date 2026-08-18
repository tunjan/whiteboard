import type { ComponentProps, ComponentType, ReactNode } from 'react';
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
import { Kbd } from '@/components/ui/kbd';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
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

function ControlButton({
  label,
  shortcut,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            {...props}
            data-toolbar-item
            tabIndex={-1}
            aria-label={label}
            aria-keyshortcuts={shortcut}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>{label}</span>
        {shortcut ? <Kbd>{shortcut.replace('Control', 'Ctrl')}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
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
  const toolbar = useRovingToolbar<HTMLDivElement>();

  return (
    <div
      data-ui-layer
      className="absolute right-[env(safe-area-inset-right)] bottom-[env(safe-area-inset-bottom)] z-[var(--z-canvas-hud)] max-sm:bottom-[calc(4rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
    >
      <TooltipProvider delay={300}>
        <Surface
          ref={toolbar.ref}
          role="toolbar"
          aria-label="Canvas view controls"
          aria-orientation="horizontal"
          mode="docked"
          chrome
          onFocusCapture={toolbar.onFocusCapture}
          onKeyDown={toolbar.onKeyDown}
          className="flex items-center gap-0.5 rounded-none rounded-tl-xl border-0 p-1"
        >
          <ControlButton
            variant="ghost"
            size="icon-sm"
            label="Zoom out"
            shortcut="Control+-"
            disabled={disabled}
            onClick={onZoomOut}
          >
            <Minus />
          </ControlButton>
          <ControlButton
            type="button"
            variant="ghost"
            size="sm"
            label="Reset zoom to 100%"
            shortcut="Control+0"
            onClick={onZoomReset}
            className="min-w-12 px-1.5 font-normal text-primary tabular-nums"
            disabled={disabled}
          >
            {Math.round(zoom * 100)}%
          </ControlButton>
          <ControlButton
            variant="ghost"
            size="icon-sm"
            label="Zoom in"
            shortcut="Control++"
            disabled={disabled}
            onClick={onZoomIn}
          >
            <Plus />
          </ControlButton>

          <ControlButton
            variant="ghost"
            size="icon-sm"
            label="Zoom to fit"
            disabled={disabled}
            onClick={onZoomToFit}
          >
            <Maximize2 />
          </ControlButton>

          {equations.length ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          data-toolbar-item
                          tabIndex={-1}
                          aria-label="Find an equation"
                          disabled={disabled}
                        />
                      }
                    />
                  }
                >
                  <Sigma />
                </TooltipTrigger>
                <TooltipContent side="top">Find an equation</TooltipContent>
              </Tooltip>
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
                        <span className="text-xs text-tertiary">Locked</span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-toolbar-item
                        tabIndex={-1}
                        aria-label={`Background: ${BACKGROUND_LABELS[background]}`}
                        disabled={disabled}
                      />
                    }
                  />
                }
              >
                <BackgroundIcon />
              </TooltipTrigger>
              <TooltipContent side="top">
                Background: {BACKGROUND_LABELS[background]}
              </TooltipContent>
            </Tooltip>
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
        </Surface>
      </TooltipProvider>
    </div>
  );
}

const BACKGROUND_ICONS: Record<
  BackgroundType,
  ComponentType<{ className?: string }>
> = {
  blank: Square,
  dot: CircleDot,
  graph: Grid2x2,
  coordinate: Crosshair,
};
