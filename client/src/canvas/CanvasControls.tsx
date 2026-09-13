import type { ComponentProps, ComponentType, ReactNode } from 'react';
import {
  CircleDot,
  Crosshair,
  Grid2x2,
  Map,
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
import {
  CHROME_KEY_ON_BOARD,
  CHROME_ON_BOARD,
  Surface,
} from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
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
  minimapVisible: boolean;
  onMinimapToggle: () => void;
  equations: Array<{ id: string; label: string; locked: boolean }>;
  onEquationSelect: (id: string) => void;
  disabled?: boolean;
}

function ControlButton({
  label,
  shortcut,
  children,
  className,
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
            className={cn(CHROME_KEY_ON_BOARD, className)}
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
  minimapVisible,
  onMinimapToggle,
  equations,
  onEquationSelect,
  disabled = false,
}: CanvasControlsProps) {
  const BackgroundIcon = BACKGROUND_ICONS[background];
  const toolbar = useRovingToolbar<HTMLDivElement>();

  return (
    <div
      data-ui-layer
      className="absolute right-[env(safe-area-inset-right)] bottom-[var(--wb-inset-bottom)] z-[var(--z-canvas-hud)] max-sm:bottom-[calc(4rem+var(--wb-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+var(--wb-inset-bottom))] select-none"
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
          className={cn(
            // Mirror of the history HUD opposite it: no card, and the corner
            // turned in on whichever sides are not flush to a viewport edge.
            'relative flex items-center gap-0.5 rounded-none rounded-tl-xl p-1',
            'wb-chrome-blur max-sm:rounded-bl-xl [@media(pointer:coarse)]:rounded-bl-xl',
            CHROME_ON_BOARD,
          )}
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
            className="min-w-12 rounded-full px-1.5 font-normal text-fg tabular-nums"
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
            shortcut="Shift+1"
            disabled={disabled}
            onClick={onZoomToFit}
          >
            <Maximize2 />
          </ControlButton>

          <ControlButton
            variant="ghost"
            size="icon-sm"
            label={minimapVisible ? 'Hide overview' : 'Show overview'}
            // Pressed reads as a fill, never as a lift: chrome on the board has
            // no relief to add to.
            className="aria-pressed:bg-tb-track aria-pressed:text-fg"
            aria-pressed={minimapVisible}
            disabled={disabled}
            onClick={onMinimapToggle}
          >
            <Map />
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
                          className={CHROME_KEY_ON_BOARD}
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
                        <span className="text-xs text-fg-muted">Locked</span>
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
                        className={CHROME_KEY_ON_BOARD}
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
