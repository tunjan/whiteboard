import type { ComponentProps, ComponentType, ReactNode } from 'react';
import {
  CircleDot,
  Crosshair,
  Grid2x2,
  Lock,
  Map,
  Maximize,
  Minus,
  Plus,
  Sigma,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import {
  INSTRUMENT,
  INSTRUMENT_KEY,
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

function KeyTooltip({
  label,
  shortcut,
  trigger,
  children,
}: {
  label: string;
  shortcut?: string;
  trigger: ComponentProps<typeof TooltipTrigger>['render'];
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipContent side="top">
        <span>{label}</span>
        {shortcut ? <Kbd>{shortcut.replace('Control', 'Ctrl')}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
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
    <KeyTooltip
      label={label}
      shortcut={shortcut}
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          {...props}
          className={cn(INSTRUMENT_KEY, className)}
          data-toolbar-item
          tabIndex={-1}
          aria-label={label}
          aria-keyshortcuts={shortcut}
        />
      }
    >
      {children}
    </KeyTooltip>
  );
}

/** A key that opens a menu above it. */
function MenuKey({
  label,
  tooltip,
  disabled,
  children,
}: {
  label: string;
  tooltip: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <KeyTooltip
      label={tooltip}
      trigger={
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={INSTRUMENT_KEY}
              data-toolbar-item
              tabIndex={-1}
              aria-label={label}
              disabled={disabled}
            />
          }
        />
      }
    >
      {children}
    </KeyTooltip>
  );
}

/**
 * The view instrument. Three groups, read from the board's centre out to its
 * corner: what is on the page (its ground, its equations), how big it is, and
 * where you are on it. The overview key sits in the corner because the
 * overview docks directly above it.
 */
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
      data-arrive="up"
      style={{ '--arrive-i': 3 } as React.CSSProperties}
      className="absolute right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.75rem+var(--wb-inset-bottom))] z-[var(--z-canvas-hud)] max-sm:bottom-[calc(4.75rem+var(--wb-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7.75rem+var(--wb-inset-bottom))] select-none"
    >
      <TooltipProvider delay={300}>
        <Surface
          ref={toolbar.ref}
          role="toolbar"
          aria-label="View"
          aria-orientation="horizontal"
          mode="docked"
          chrome
          onFocusCapture={toolbar.onFocusCapture}
          onKeyDown={toolbar.onKeyDown}
          // The overview docks onto this plate, so while it is up the two are
          // one object and the plate has to be under it.
          data-awake={minimapVisible ? '' : undefined}
          // `--tb-item` sizes the group rule to these 32px keys.
          className={cn('relative [--tb-item:2rem]', INSTRUMENT)}
        >
          <div role="group" aria-label="Page" className="flex gap-0.5">
            <DropdownMenu>
              <MenuKey
                label={`Background: ${BACKGROUND_LABELS[background]}`}
                tooltip="Background"
                disabled={disabled}
              >
                <BackgroundIcon />
              </MenuKey>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-52"
              >
                <DropdownMenuRadioGroup
                  value={background}
                  onValueChange={(value) =>
                    onBackgroundChange(value as BackgroundType)
                  }
                >
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

            {equations.length ? (
              <DropdownMenu>
                <MenuKey
                  label="Equations"
                  tooltip="Equations"
                  disabled={disabled}
                >
                  <Sigma />
                </MenuKey>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="max-h-72 w-72 overflow-y-auto"
                >
                  {equations.map((equation, index) => (
                    <DropdownMenuItem
                      key={equation.id}
                      onClick={() => onEquationSelect(equation.id)}
                    >
                      <span className="w-4 shrink-0 text-right text-xs text-fg-muted tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {equation.label}
                      </span>
                      {equation.locked ? (
                        <Lock aria-label="Locked" className="text-fg-muted" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>


          <div role="group" aria-label="Zoom" className="flex gap-0.5">
            <ControlButton
              label="Zoom out"
              shortcut="Control+-"
              disabled={disabled}
              onClick={onZoomOut}
            >
              <Minus />
            </ControlButton>
            <ControlButton
              size="sm"
              label="Reset to 100%"
              shortcut="Control+0"
              disabled={disabled}
              onClick={onZoomReset}
              className="w-12 px-0 text-fg tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </ControlButton>
            <ControlButton
              label="Zoom in"
              shortcut="Control++"
              disabled={disabled}
              onClick={onZoomIn}
            >
              <Plus />
            </ControlButton>
          </div>


          <div role="group" aria-label="Position" className="flex gap-0.5">
            <ControlButton
              label="Zoom to fit"
              shortcut="Shift+1"
              disabled={disabled}
              onClick={onZoomToFit}
            >
              <Maximize />
            </ControlButton>
            <ControlButton
              label="Overview"
              // On is the "you are here" tint the toolbar marks its held tool
              // with: a change of fill, never a lift.
              className="aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg aria-pressed:hover:bg-tb-sel-bg-hover"
              aria-pressed={minimapVisible}
              disabled={disabled}
              onClick={onMinimapToggle}
            >
              <Map />
            </ControlButton>
          </div>
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
